using System.Net;
using Dispatchly.Application;
using Dispatchly.Domain.Orders;
using Dispatchly.Domain.Riders;
using Dispatchly.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace Dispatchly.IntegrationTests;

/// <summary>POST /orders/{code}/reassign.</summary>
public sealed class ReassignTests(PostgisServer postgis)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Reassigning_hands_the_order_to_the_next_nearest_free_rider_and_frees_the_first()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.None);
        var world = new World(app);
        var restaurant = await world.RestaurantAsync();
        var customer = await world.CustomerAsync();
        var first = await world.RiderAsync(restaurant.Location, 300);
        var second = await world.RiderAsync(restaurant.Location, 4_000, bearing: 180);
        var placed = await (await app.Customer(customer.Id).PostJsonAsync("/api/v1/orders", World.OrderFrom(restaurant)))
            .ReadAsync<OrderDetails>(HttpStatusCode.Created);
        Assert.Equal(first.Id, placed.Rider?.Id);

        var order = await (await app.Dispatcher().PostJsonAsync($"/api/v1/orders/{placed.Code}/reassign")).ReadAsync<OrderDetails>();

        // Reassignment looks as far as the widest radius (5 km).
        Assert.Equal(OrderStatus.Assigned, order.Status);
        Assert.Equal(second.Id, order.Rider?.Id);
        var reassigned = order.Timeline[^1];
        Assert.Equal(OrderEventType.Reassigned, reassigned.Type);
        Assert.Equal(second.Id, reassigned.RiderId);
        Assert.Equal(first.Id, reassigned.PreviousRiderId);
        Assert.Equal(first.Name, reassigned.PreviousRiderName);
        Assert.Equal(1, reassigned.FreeRiders);
        Assert.InRange(reassigned.DistanceMeters!.Value, 3_995, 4_005);
        Assert.Equal(
            new Dictionary<int, RiderStatus> { [first.Id] = RiderStatus.Available, [second.Id] = RiderStatus.Assigned },
            await app.QueryAsync(db => db.Riders.ToDictionaryAsync(r => r.Id, r => r.Status, Ct)));
        Assert.Null((await app.Rider(first.Id).GetJsonAsync<RiderTaskView>("/api/v1/rider/task")).Task);
        Assert.Equal(placed.Code, (await app.Rider(second.Id).GetJsonAsync<RiderTaskView>("/api/v1/rider/task")).Task?.Code);
    }

    [Fact]
    public async Task Reassigning_needs_another_free_rider()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.None);
        var world = new World(app);
        var restaurant = await world.RestaurantAsync();
        var customer = await world.CustomerAsync();
        var only = await world.RiderAsync(restaurant.Location, 300);
        await world.RiderAsync(restaurant.Location, 6_000);
        var placed = await (await app.Customer(customer.Id).PostJsonAsync("/api/v1/orders", World.OrderFrom(restaurant)))
            .ReadAsync<OrderDetails>(HttpStatusCode.Created);

        var response = await app.Dispatcher().PostJsonAsync($"/api/v1/orders/{placed.Code}/reassign");

        await response.AssertProblemAsync(HttpStatusCode.Conflict, "no_free_rider");
        var order = await app.Dispatcher().GetJsonAsync<OrderDetails>($"/api/v1/orders/{placed.Code}");
        Assert.Equal(only.Id, order.Rider?.Id);
        Assert.DoesNotContain(order.Timeline, e => e.Type == OrderEventType.Reassigned);
    }

    [Fact]
    public async Task Only_assigned_orders_that_havent_been_picked_up_can_be_reassigned()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.None);
        var world = new World(app);
        var restaurant = await world.RestaurantAsync();
        var customer = await world.CustomerAsync();
        var rider = await world.RiderAsync(restaurant.Location, 300);
        await world.RiderAsync(restaurant.Location, 6_000);
        var client = app.Customer(customer.Id);
        var assigned = await (await client.PostJsonAsync("/api/v1/orders", World.OrderFrom(restaurant))).ReadAsync<OrderDetails>(HttpStatusCode.Created);
        var searching = await (await client.PostJsonAsync("/api/v1/orders", World.OrderFrom(restaurant))).ReadAsync<OrderDetails>(HttpStatusCode.Created);
        Assert.Equal(OrderStatus.Searching, searching.Status);
        await (await app.Rider(rider.Id).PostJsonAsync("/api/v1/rider/task/pickup")).ReadAsync<RiderTaskView>();
        var dispatcher = app.Dispatcher();

        await (await dispatcher.PostJsonAsync($"/api/v1/orders/{assigned.Code}/reassign")).AssertProblemAsync(HttpStatusCode.Conflict, "order_not_reassignable");
        await (await dispatcher.PostJsonAsync($"/api/v1/orders/{searching.Code}/reassign")).AssertProblemAsync(HttpStatusCode.Conflict, "order_not_reassignable");
        await (await dispatcher.PostJsonAsync("/api/v1/orders/DL-9999/reassign")).AssertProblemAsync(HttpStatusCode.NotFound, "not_found");
    }
}
