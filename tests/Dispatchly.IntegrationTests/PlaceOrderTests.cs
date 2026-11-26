using System.Net;
using Dispatchly.Application;
using Dispatchly.Domain.Orders;
using Dispatchly.Domain.Riders;
using Dispatchly.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace Dispatchly.IntegrationTests;

/// <summary>POST /orders and the first assignment attempt (PLAN.md §3.5).</summary>
public sealed class PlaceOrderTests(PostgisServer postgis)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Placing_an_order_assigns_the_nearest_free_rider()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.None);
        var world = new World(app);
        var restaurant = await world.RestaurantAsync();
        var customer = await world.CustomerAsync();
        var nearest = await world.RiderAsync(restaurant.Location, 300, bearing: 90);
        var second = await world.RiderAsync(restaurant.Location, 800, bearing: 200);
        await world.RiderAsync(restaurant.Location, 1_200, bearing: 300);
        await world.RiderAsync(restaurant.Location, 100, online: false);
        await world.RiderAsync(restaurant.Location, 2_000, bearing: 45);
        var client = app.Customer(customer.Id);

        var response = await client.PostJsonAsync("/api/v1/orders", World.OrderFrom(restaurant));
        var order = await response.ReadAsync<OrderDetails>(HttpStatusCode.Created);

        Assert.Equal($"/api/v1/orders/{order.Code}", response.Headers.Location?.AbsolutePath);
        Assert.Matches("^DL-[0-9]+$", order.Code);
        Assert.Equal(OrderStatus.Assigned, order.Status);
        Assert.Equal(nearest.Id, order.Rider?.Id);
        Assert.Equal(1_500, order.SearchRadiusMeters);
        var assigned = Assert.Single(order.Timeline, e => e.Type == OrderEventType.Assigned);
        // "Nearest of 3 free riders, 300 m": the offline rider and the one 2 km out don't count.
        Assert.Equal(3, assigned.FreeRiders);
        Assert.InRange(assigned.DistanceMeters!.Value, 298, 302);
        Assert.Equal(OrderEventType.Placed, order.Timeline[0].Type);

        // Prices come from the menu on the server: 2 × ₹220 + ₹180.
        Assert.Equal(62_000, order.TotalPaise);
        Assert.Equal([("cold-brew", 2, 22_000), ("croissant", 1, 18_000)], order.Items.Select(i => (i.MenuItemId, i.Quantity, i.UnitPricePaise)));
        Assert.Matches("^[0-9]{4}$", order.DeliveryCode);
        Assert.Equal("Priya", order.Drop.CustomerFirstName);
        Assert.Equal("Home", order.Drop.Label);
        Assert.InRange(order.DistanceMeters, 2_490, 2_510);
        Assert.True(order.PromisedBy > order.CreatedAt);
        Assert.True(order.EstimatedDeliveryAt <= order.PromisedBy);
        Assert.Equal(RiderStatus.Assigned, await app.QueryAsync(db => db.Riders.Where(r => r.Id == nearest.Id).Select(r => r.Status).SingleAsync(Ct)));

        // The nearest rider is busy now, so the next order goes to the next nearest.
        var next = await (await client.PostJsonAsync("/api/v1/orders", World.OrderFrom(restaurant))).ReadAsync<OrderDetails>(HttpStatusCode.Created);
        Assert.Equal(second.Id, next.Rider?.Id);
        Assert.Equal(2, next.Timeline.Single(e => e.Type == OrderEventType.Assigned).FreeRiders);
        Assert.NotEqual(order.Code, next.Code);
    }

    [Fact]
    public async Task With_nobody_free_in_range_the_order_waits_for_a_rider()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.None);
        var world = new World(app);
        var restaurant = await world.RestaurantAsync();
        var customer = await world.CustomerAsync();
        await world.RiderAsync(restaurant.Location, 2_000);

        var order = await (await app.Customer(customer.Id).PostJsonAsync("/api/v1/orders", World.OrderFrom(restaurant)))
            .ReadAsync<OrderDetails>(HttpStatusCode.Created);

        Assert.Equal(OrderStatus.Searching, order.Status);
        Assert.Null(order.Rider);
        Assert.Null(order.AssignedAt);
        Assert.Equal(1_500, order.SearchRadiusMeters);
        Assert.Equal([OrderEventType.Placed], order.Timeline.Select(e => e.Type));
        var queue = await app.Dispatcher().GetJsonAsync<List<OrderSummary>>("/api/v1/orders");
        Assert.Equal(order.Code, Assert.Single(queue).Code);
    }

    [Fact]
    public async Task Invalid_orders_are_rejected_and_nothing_is_placed()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.None);
        var world = new World(app);
        var restaurant = await world.RestaurantAsync();
        var customer = await world.CustomerAsync();
        await world.RiderAsync(restaurant.Location, 300);
        var client = app.Customer(customer.Id);
        var valid = World.OrderFrom(restaurant);

        (PlaceOrderRequest Request, string? Code)[] invalid =
        [
            (valid with { Items = [new PlaceOrderLine("espresso-tonic", 1)] }, "unknown_menu_item"),
            (valid with { RestaurantId = restaurant.Id + 1 }, "unknown_restaurant"),
            (World.OrderFrom(restaurant, drop: restaurant.Location.Move(0, 9_000)), "drop_too_far"),
            (valid with { Items = [] }, null),
            (valid with { Items = [new PlaceOrderLine("cold-brew", 0)] }, null),
            (valid with { Items = [new PlaceOrderLine("cold-brew", Order.MaxQuantity + 1)] }, null),
            (valid with { Items = [.. Enumerable.Repeat(new PlaceOrderLine("cold-brew", 1), Order.MaxLines + 1)] }, null),
            (valid with { Drop = valid.Drop with { Lat = 95 } }, null),
            (valid with { Drop = valid.Drop with { Address = "" } }, null),
            (valid with { RestaurantId = 0 }, null),
        ];
        foreach (var (request, code) in invalid)
        {
            await (await client.PostJsonAsync("/api/v1/orders", request)).AssertProblemAsync(HttpStatusCode.BadRequest, code);
        }

        Assert.Equal(0, await app.QueryAsync(db => db.Orders.CountAsync(Ct)));
        Assert.Equal(0, await app.QueryAsync(db => db.Riders.CountAsync(r => r.Status == RiderStatus.Assigned, Ct)));
    }
}
