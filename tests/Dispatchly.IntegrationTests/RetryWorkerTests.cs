using System.Net;
using Dispatchly.Application;
using Dispatchly.Domain.Orders;
using Dispatchly.Domain.Riders;
using Dispatchly.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace Dispatchly.IntegrationTests;

/// <summary>
/// The retry worker (PLAN.md §3.5 step 3): orders still searching are tried again on every pass,
/// with the radius widening from 1.5 to 3 to 5 km as they wait. Each test sets up its world with
/// the worker off, then starts an instance with the worker on, so the first pass sees all of it.
/// </summary>
public sealed class RetryWorkerTests(PostgisServer postgis)
{
    private static readonly Dictionary<string, string?> Retry = new()
    {
        ["Workers:AssignmentRetry"] = "true",
        ["Dispatch:RetryInterval"] = "00:00:00.300",
    };

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task A_waiting_order_widens_its_search_until_it_reaches_a_rider()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.None);
        var world = new World(app);
        var restaurant = await world.RestaurantAsync();
        var customer = await world.CustomerAsync();
        var rider = await world.RiderAsync(restaurant.Location, 2_200);
        var placed = await PlaceAsync(app, restaurant, customer.Id);
        Assert.Equal(OrderStatus.Searching, placed.Status);
        Assert.Equal(1_500, placed.SearchRadiusMeters);

        await using var worker = TestApp.Start(app.ConnectionString, Retry);
        var order = await WaitForAsync(app, placed.Code, o => o.Status == OrderStatus.Assigned);

        Assert.Equal(rider.Id, order.Rider?.Id);
        Assert.True(order.SearchRadiusMeters >= 3_000);
        var assigned = Assert.Single(order.Timeline, e => e.Type == OrderEventType.Assigned);
        Assert.Equal(1, assigned.FreeRiders);
        Assert.InRange(assigned.DistanceMeters!.Value, 2_195, 2_205);
    }

    [Fact]
    public async Task A_rider_beyond_the_widest_radius_is_never_offered_the_order()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.None);
        var world = new World(app);
        var restaurant = await world.RestaurantAsync();
        var customer = await world.CustomerAsync();
        var rider = await world.RiderAsync(restaurant.Location, 5_300);
        var placed = await PlaceAsync(app, restaurant, customer.Id);

        await using var worker = TestApp.Start(app.ConnectionString, Retry);
        await WaitForAsync(app, placed.Code, o => o.SearchRadiusMeters == 5_000);
        // A few more passes at the widest radius.
        await Task.Delay(1_000, Ct);
        var order = await app.Dispatcher().GetJsonAsync<OrderDetails>($"/api/v1/orders/{placed.Code}");

        Assert.Equal(OrderStatus.Searching, order.Status);
        Assert.Equal(5_000, order.SearchRadiusMeters);
        Assert.Null(order.Rider);
        Assert.Equal([OrderEventType.Placed], order.Timeline.Select(e => e.Type));
        Assert.Equal(RiderStatus.Available, await app.QueryAsync(db => db.Riders.Where(r => r.Id == rider.Id).Select(r => r.Status).SingleAsync(Ct)));
    }

    [Fact]
    public async Task A_rider_coming_online_takes_the_order_that_has_waited_longest()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.None);
        var world = new World(app);
        var restaurant = await world.RestaurantAsync();
        var customer = await world.CustomerAsync();
        var rider = await world.RiderAsync(restaurant.Location, 300, online: false);
        var older = await PlaceAsync(app, restaurant, customer.Id);
        var newer = await PlaceAsync(app, restaurant, customer.Id);
        Assert.Equal(OrderStatus.Searching, older.Status);
        Assert.Equal(OrderStatus.Searching, newer.Status);
        var online = await (await app.Rider(rider.Id).PutJsonAsync("/api/v1/rider/status", new { online = true })).ReadAsync<RiderTaskView>();
        Assert.Equal(RiderStatus.Available, online.Rider.Status);

        await using var worker = TestApp.Start(app.ConnectionString, Retry);
        var order = await WaitForAsync(app, older.Code, o => o.Status == OrderStatus.Assigned);

        Assert.Equal(rider.Id, order.Rider?.Id);
        Assert.InRange(order.Timeline.Single(e => e.Type == OrderEventType.Assigned).DistanceMeters!.Value, 298, 302);
        Assert.Equal(older.Code, (await app.Rider(rider.Id).GetJsonAsync<RiderTaskView>("/api/v1/rider/task")).Task?.Code);
        Assert.Equal(OrderStatus.Searching, (await app.Dispatcher().GetJsonAsync<OrderDetails>($"/api/v1/orders/{newer.Code}")).Status);
    }

    private static async Task<OrderDetails> PlaceAsync(TestApp app, Domain.Restaurants.Restaurant restaurant, int customerId) =>
        await (await app.Customer(customerId).PostJsonAsync("/api/v1/orders", World.OrderFrom(restaurant)))
            .ReadAsync<OrderDetails>(HttpStatusCode.Created);

    private static async Task<OrderDetails> WaitForAsync(TestApp app, string code, Func<OrderDetails, bool> condition)
    {
        var dispatcher = app.Dispatcher();
        var deadline = DateTime.UtcNow.AddSeconds(15);
        while (true)
        {
            var order = await dispatcher.GetJsonAsync<OrderDetails>($"/api/v1/orders/{code}");
            if (condition(order))
            {
                return order;
            }
            Assert.True(DateTime.UtcNow < deadline, $"Order {code} is still {order.Status} within {order.SearchRadiusMeters} m after 15 s.");
            await Task.Delay(100, Ct);
        }
    }
}
