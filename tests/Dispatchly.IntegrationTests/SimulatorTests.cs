using System.Globalization;
using System.Net;
using Dispatchly.Application;
using Dispatchly.Domain.Geo;
using Dispatchly.Domain.Orders;
using Dispatchly.Domain.Restaurants;
using Dispatchly.Domain.Riders;
using Dispatchly.Infrastructure.Seeding;
using Dispatchly.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace Dispatchly.IntegrationTests;

/// <summary>
/// The city simulator (PLAN.md §3.7) on the real use cases: orders go from the kitchen to the door
/// with nobody touching them. Each test builds its world with the simulator off, then starts an
/// instance with it on, 100× faster, so its first tick sees the whole world. Kitchens take no time
/// (prep 0), because the multiplier doesn't shorten a kitchen's promise.
/// </summary>
public sealed class SimulatorTests(PostgisServer postgis)
{
    private static readonly IReadOnlyList<OrderEventType> FullTimeline =
    [
        OrderEventType.Placed,
        OrderEventType.Assigned,
        OrderEventType.ArrivedAtRestaurant,
        OrderEventType.PickedUp,
        OrderEventType.OnTheWay,
        OrderEventType.Delivered,
    ];

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task A_rider_takes_an_order_from_the_kitchen_to_the_door_by_themself()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.None);
        var world = new World(app);
        var restaurant = await world.RestaurantAsync(prepMinutes: 0);
        var customer = await world.CustomerAsync();
        var rider = await world.RiderAsync(restaurant.Location, 300);
        var placed = await PlaceAsync(app, restaurant, customer.Id);
        Assert.Equal(rider.Id, placed.Rider?.Id);

        await using var simulator = TestApp.Start(app.ConnectionString, Simulator());
        var order = await WaitForAsync(app, placed.Code, o => o.Status == OrderStatus.Delivered, TimeSpan.FromSeconds(60));

        Assert.Equal(FullTimeline, order.Timeline.Select(e => e.Type));
        Assert.All(order.Timeline.Skip(1), e => Assert.Equal(rider.Id, e.RiderId));
        Assert.True(order.PickedUpAt >= order.ReadyAt, "Picked up before the food was ready.");
        var rides = await app.QueryAsync(db => db.Riders.Where(r => r.Id == rider.Id).Select(r => new { r.Status }).SingleAsync(Ct));
        Assert.NotEqual(RiderStatus.Assigned, rides.Status);
        Assert.NotEqual(RiderStatus.Delivering, rides.Status);
    }

    [Fact]
    public async Task The_city_orders_by_itself_from_its_restaurants_to_places_near_the_others()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.None);
        var world = new World(app);
        Restaurant[] restaurants =
        [
            await world.RestaurantAsync(World.KhanMarket, prepMinutes: 0),
            await world.RestaurantAsync(World.KhanMarket.Move(90, 2_000), prepMinutes: 0),
            await world.RestaurantAsync(World.KhanMarket.Move(200, 3_500), prepMinutes: 0),
        ];
        int[] customers = [(await world.CustomerAsync()).Id, (await world.CustomerAsync()).Id];
        foreach (var restaurant in restaurants)
        {
            await world.RiderAsync(restaurant.Location, 200);
            await world.RiderAsync(restaurant.Location, 400, bearing: 180);
        }

        // 1 to 8 orders a second, depending on the hour in Delhi. Riders that are busy leave orders
        // searching, so the retry worker hands them out as riders come free.
        var settings = Simulator(ordersPerMinute: 240);
        settings["Workers:AssignmentRetry"] = "true";
        settings["Dispatch:RetryInterval"] = "00:00:00.300";
        await using (TestApp.Start(app.ConnectionString, settings))
        {
            await WaitUntilAsync(app, db => db.Orders.CountAsync(o => o.Status == OrderStatus.Delivered, Ct), n => n >= 3, TimeSpan.FromSeconds(60));
        }

        var dispatcher = app.Dispatcher();
        var codes = await app.QueryAsync(db => db.Orders.OrderBy(o => o.Id).Select(o => new { o.Code, o.CustomerId }).ToListAsync(Ct));
        Assert.True(codes.Count >= 3);
        Assert.All(codes, o => Assert.Contains(o.CustomerId, customers));
        foreach (var code in codes.Select(o => o.Code).Take(20))
        {
            var order = await dispatcher.GetJsonAsync<OrderDetails>($"/api/v1/orders/{code}");
            var from = Assert.Single(restaurants, r => r.Id == order.Restaurant.Id);
            var drop = new GeoPoint(order.Drop.Location.Lat, order.Drop.Location.Lng);
            // Near one of the other restaurants, which are all 0.8–5.5 km from each other here.
            Assert.Contains(restaurants, r => r.Id != from.Id && r.Location.DistanceTo(drop) <= 601);
            Assert.InRange(order.Items.Count, 1, 2);
            Assert.All(order.Items, line =>
            {
                Assert.Contains(line.MenuItemId, new[] { "cold-brew", "croissant" });
                Assert.InRange(line.Quantity, 1, 2);
            });
            Assert.Equal(order.Items.Count, order.Items.Select(l => l.MenuItemId).Distinct().Count());
            Assert.False(string.IsNullOrWhiteSpace(order.Drop.Address));
            if (order.Status == OrderStatus.Delivered)
            {
                Assert.Equal(FullTimeline, order.Timeline.Select(e => e.Type));
            }
        }
    }

    [Fact]
    public async Task The_demo_rider_waits_for_the_visitor_then_slides_by_herself()
    {
        var patience = TimeSpan.FromSeconds(3);
        await using var app = await TestApp.StartAsync(postgis, Seed.None);
        var world = new World(app);
        var restaurant = await world.RestaurantAsync(prepMinutes: 0);
        var customer = await world.CustomerAsync();
        var neha = await world.RiderAsync(restaurant.Location, 300, name: DemoSeeder.DemoRiderName);
        var placed = await PlaceAsync(app, restaurant, customer.Id);
        Assert.Equal(neha.Id, placed.Rider?.Id);

        await using var simulator = TestApp.Start(app.ConnectionString, Simulator(patience: patience));
        var order = await WaitForAsync(app, placed.Code, o => o.Status == OrderStatus.Delivered, TimeSpan.FromSeconds(60));

        Assert.Equal(FullTimeline, order.Timeline.Select(e => e.Type));
        // At the café and at the door she gives the visitor this long to slide first. A little
        // under it, because each event's time is taken when its request runs, after the tick began.
        var at = order.Timeline.ToDictionary(e => e.Type, e => e.At);
        Assert.InRange(at[OrderEventType.PickedUp] - at[OrderEventType.ArrivedAtRestaurant], patience * 0.9, patience + TimeSpan.FromSeconds(10));
        Assert.True(at[OrderEventType.Delivered] - at[OrderEventType.OnTheWay] >= patience * 0.9);

        // Free again, she waits where she is for the visitor's next order: no drifting, no break.
        var after = await RiderAsync(app, neha.Id);
        await Task.Delay(1_500, Ct);
        var later = await RiderAsync(app, neha.Id);
        Assert.Equal(RiderStatus.Available, later.Status);
        Assert.Equal(after.Location, later.Location);
    }

    [Fact]
    public async Task The_demo_rider_moves_by_herself_but_leaves_the_slides_to_the_visitor()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.None);
        var world = new World(app);
        var restaurant = await world.RestaurantAsync(prepMinutes: 0);
        var customer = await world.CustomerAsync();
        var neha = await world.RiderAsync(restaurant.Location, 300, name: DemoSeeder.DemoRiderName);
        var placed = await PlaceAsync(app, restaurant, customer.Id);
        var visitor = app.Rider(neha.Id);

        await using var simulator = TestApp.Start(app.ConnectionString, Simulator(patience: TimeSpan.FromMinutes(10)));

        // She rides to the café and waits there.
        await WaitUntilAsync(app, db => RiderAsync(db, neha.Id), r => r.Location.DistanceTo(restaurant.Location) <= 1, TimeSpan.FromSeconds(30));
        await Task.Delay(1_000, Ct);
        var waiting = await visitor.GetJsonAsync<RiderTaskView>("/api/v1/rider/task");
        Assert.Equal(RiderStatus.AtRestaurant, waiting.Rider.Status);
        Assert.Equal(OrderStatus.Assigned, waiting.Task?.Status);

        // The visitor slides "Picked up · Start ride"; she rides to the door and waits again.
        var pickedUp = await (await visitor.PostJsonAsync("/api/v1/rider/task/pickup")).ReadAsync<RiderTaskView>();
        Assert.Equal(OrderStatus.PickedUp, pickedUp.Task?.Status);
        var drop = new GeoPoint(placed.Drop.Location.Lat, placed.Drop.Location.Lng);
        await WaitUntilAsync(app, db => RiderAsync(db, neha.Id), r => r.Location.DistanceTo(drop) <= 1, TimeSpan.FromSeconds(30));
        await Task.Delay(1_000, Ct);
        Assert.Equal(OrderStatus.InTransit, (await visitor.GetJsonAsync<RiderTaskView>("/api/v1/rider/task")).Task?.Status);

        // The visitor slides "Delivered" with the code the customer reads out.
        var code = await app.DeliveryCodeAsync(placed.Code);
        var delivered = await (await visitor.PostJsonAsync("/api/v1/rider/task/deliver", new { code })).ReadAsync<DeliveryResult>();

        Assert.Equal(RiderStatus.Available, delivered.Rider.Status);
        var order = await app.Dispatcher().GetJsonAsync<OrderDetails>($"/api/v1/orders/{placed.Code}");
        Assert.Equal(FullTimeline, order.Timeline.Select(e => e.Type));
    }

    /// <summary>The simulator on, 100× faster and ticking every 250 ms. No new orders unless asked.</summary>
    private static Dictionary<string, string?> Simulator(double ordersPerMinute = 0, TimeSpan? patience = null) => new()
    {
        ["Simulator:Enabled"] = "true",
        ["Simulator:TickInterval"] = "00:00:00.250",
        ["Simulator:SpeedMultiplier"] = "100",
        ["Simulator:OrdersPerMinute"] = ordersPerMinute.ToString(CultureInfo.InvariantCulture),
        ["Simulator:DemoRiderPatience"] = (patience ?? TimeSpan.FromMinutes(2)).ToString("c", CultureInfo.InvariantCulture),
    };

    private static async Task<OrderDetails> PlaceAsync(TestApp app, Restaurant restaurant, int customerId) =>
        await (await app.Customer(customerId).PostJsonAsync("/api/v1/orders", World.OrderFrom(restaurant)))
            .ReadAsync<OrderDetails>(HttpStatusCode.Created);

    private static async Task<OrderDetails> WaitForAsync(TestApp app, string code, Func<OrderDetails, bool> condition, TimeSpan timeout)
    {
        var dispatcher = app.Dispatcher();
        var deadline = DateTime.UtcNow + timeout;
        while (true)
        {
            var order = await dispatcher.GetJsonAsync<OrderDetails>($"/api/v1/orders/{code}");
            if (condition(order))
            {
                return order;
            }
            Assert.True(DateTime.UtcNow < deadline, $"Order {code} is still {order.Status} after {timeout.TotalSeconds:0} s: {string.Join(", ", order.Timeline.Select(e => e.Type))}.");
            await Task.Delay(100, Ct);
        }
    }

    private static async Task<T> WaitUntilAsync<T>(
        TestApp app,
        Func<Infrastructure.Data.DispatchlyDbContext, Task<T>> query,
        Func<T, bool> condition,
        TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (true)
        {
            var value = await app.QueryAsync(query);
            if (condition(value))
            {
                return value;
            }
            Assert.True(DateTime.UtcNow < deadline, $"Still {value} after {timeout.TotalSeconds:0} s.");
            await Task.Delay(100, Ct);
        }
    }

    private static Task<Rider> RiderAsync(TestApp app, int id) => app.QueryAsync(db => RiderAsync(db, id));

    private static Task<Rider> RiderAsync(Infrastructure.Data.DispatchlyDbContext db, int id) =>
        db.Riders.AsNoTracking().SingleAsync(r => r.Id == id, Ct);
}
