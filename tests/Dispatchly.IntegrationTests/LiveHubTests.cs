using System.Net;
using System.Text.Json;
using Dispatchly.Api.Live;
using Dispatchly.Application;
using Dispatchly.Application.Abstractions;
using Dispatchly.Application.Live;
using Dispatchly.Domain.Geo;
using Dispatchly.Domain.Orders;
using Dispatchly.Domain.Riders;
using Dispatchly.IntegrationTests.Support;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Extensions.DependencyInjection;

namespace Dispatchly.IntegrationTests;

/// <summary>The live hub (PLAN.md §3.6, docs/realtime.md): who may join what, and who hears about what.</summary>
public sealed class LiveHubTests(PostgisServer postgis)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Dispatchers_and_visitors_get_every_rider_on_shift_every_two_seconds()
    {
        // The real cadence, with the simulator moving the demo city.
        await using var app = await TestApp.StartAsync(postgis, Seed.DemoCity, new Dictionary<string, string?>
        {
            ["Workers:LiveBroadcast"] = "true",
            ["Simulator:Enabled"] = "true",
            ["Simulator:OrdersPerMinute"] = "0",
        });
        await using var dispatcher = await LiveClient.ConnectAsync(app, app.Token(Role.Dispatcher));
        await dispatcher.InvokeAsync("JoinDispatch");
        await using var visitor = await LiveClient.ConnectAsync(app);
        await visitor.InvokeAsync("JoinPublic");

        var batches = await dispatcher.WaitForCountAsync(LiveMessages.RidersBatch, 4, TimeSpan.FromSeconds(12));

        // One message per tick, 2 s apart by the server's clock and as they arrive. A tick that
        // starts late (a busy test machine) doesn't push the next one back, so the span is exact.
        Assert.InRange((batches[3].At - batches[0].At).TotalSeconds, 5.7, 6.3);
        Assert.InRange((batches[3].ReceivedAt - batches[0].ReceivedAt).TotalSeconds, 5.4, 6.6);
        for (var i = 1; i < batches.Count; i++)
        {
            Assert.InRange((batches[i].At - batches[i - 1].At).TotalSeconds, 1.0, 3.0);
        }
        var riders = batches.Select(b => b.Payload<RidersBatch>().Riders).ToList();
        Assert.All(riders, batch =>
        {
            Assert.True(batch.Count > 100, $"Only {batch.Count} riders in a batch.");
            Assert.Equal(batch.Count, batch.Select(r => r.Id).Distinct().Count());
            Assert.DoesNotContain(batch, r => r.Status == RiderStatus.Offline);
            Assert.All(batch, r => Assert.InRange(r.Bearing, 0, 359));
        });
        // The simulator moves riders between ticks.
        var first = riders[0].ToDictionary(r => r.Id);
        Assert.Contains(riders[^1], r => first.TryGetValue(r.Id, out var before) && (before.Lat, before.Lng) != (r.Lat, r.Lng));
        // Compact on the wire: [id, lat, lng, bearing, "Status"].
        var point = batches[0].Arguments[0].GetProperty("riders")[0];
        Assert.Equal(JsonValueKind.Array, point.ValueKind);
        Assert.Equal(5, point.GetArrayLength());
        Assert.Equal(JsonValueKind.String, point[4].ValueKind);

        // Visitors get the same batches.
        var seen = await visitor.WaitForCountAsync(LiveMessages.RidersBatch, 2, TimeSpan.FromSeconds(6));
        Assert.Contains(seen, m => batches.Any(b => b.At == m.At));
        Assert.Empty(visitor.Received(LiveMessages.OrderChanged));
    }

    [Fact]
    public async Task Joining_a_group_checks_who_is_asking()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.None);
        var world = new World(app);
        var restaurant = await world.RestaurantAsync();
        var owner = await world.CustomerAsync();
        var stranger = await world.CustomerAsync();
        var rider = await world.RiderAsync(restaurant.Location, 300);
        var order = await PlaceAsync(app, World.OrderFrom(restaurant), owner.Id);

        await using var anonymous = await LiveClient.ConnectAsync(app);
        await anonymous.InvokeAsync("JoinPublic");
        await AssertFailsAsync(anonymous, LiveErrors.Unauthorized, "JoinDispatch");
        await AssertFailsAsync(anonymous, LiveErrors.Unauthorized, "JoinOrder", order.Code);
        await AssertFailsAsync(anonymous, LiveErrors.Unauthorized, "JoinRider");

        // A bad token is no token.
        await using var forged = await LiveClient.ConnectAsync(app, "not-a-jwt");
        await AssertFailsAsync(forged, LiveErrors.Unauthorized, "JoinDispatch");

        await using var someoneElse = await LiveClient.ConnectAsync(app, app.Token(Role.Customer, customerId: stranger.Id));
        await AssertFailsAsync(someoneElse, LiveErrors.Forbidden, "JoinDispatch");
        await AssertFailsAsync(someoneElse, LiveErrors.Forbidden, "JoinRider");
        await AssertFailsAsync(someoneElse, LiveErrors.NotFound, "JoinOrder", order.Code);
        await AssertFailsAsync(someoneElse, LiveErrors.NotFound, "JoinOrder", "DL-999999");
        await AssertFailsAsync(someoneElse, LiveErrors.NotFound, "JoinOrder", "order:dispatch");

        await using var customer = await LiveClient.ConnectAsync(app, app.Token(Role.Customer, customerId: owner.Id));
        await customer.InvokeAsync("JoinOrder", order.Code);
        await customer.InvokeAsync("LeaveOrder", order.Code);
        await customer.InvokeAsync("JoinPublic");

        await using var dispatcher = await LiveClient.ConnectAsync(app, app.Token(Role.Dispatcher));
        await dispatcher.InvokeAsync("JoinDispatch");
        // The order group carries the delivery code: it's the customer's alone.
        await AssertFailsAsync(dispatcher, LiveErrors.Forbidden, "JoinOrder", order.Code);
        await AssertFailsAsync(dispatcher, LiveErrors.Forbidden, "JoinRider");

        await using var riderClient = await LiveClient.ConnectAsync(app, app.Token(Role.Rider, riderId: rider.Id));
        await riderClient.InvokeAsync("JoinRider");
        await AssertFailsAsync(riderClient, LiveErrors.Forbidden, "JoinDispatch");
    }

    [Fact]
    public async Task An_order_s_lifecycle_reaches_the_dispatchers_the_customer_and_the_rider()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.None);
        var world = new World(app);
        var restaurant = await world.RestaurantAsync();
        var customerAccount = await world.CustomerAsync();
        var riderAccount = await world.RiderAsync(restaurant.Location, 300);
        await using var dispatch = await LiveClient.ConnectAsync(app, app.Token(Role.Dispatcher));
        await dispatch.InvokeAsync("JoinDispatch");
        await using var rider = await LiveClient.ConnectAsync(app, app.Token(Role.Rider, riderId: riderAccount.Id));
        await rider.InvokeAsync("JoinRider");

        var placed = await PlaceAsync(app, World.OrderFrom(restaurant), customerAccount.Id);
        var code = placed.Code;

        // Placed, then assigned: the queue row changes twice, and the rider gets the task.
        var searching = await dispatch.WaitForAsync(LiveMessages.OrderChanged, m => Is(m, code, OrderStatus.Searching));
        var assigned = await dispatch.WaitForAsync(LiveMessages.OrderChanged, m => Is(m, code, OrderStatus.Assigned));
        Assert.True(assigned.At >= searching.At);
        Assert.Equal(riderAccount.Id, assigned.Payload<OrderSummary>().RiderId);
        var task = (await rider.WaitForAsync(LiveMessages.TaskAssigned)).Payload<RiderTaskView>();
        Assert.Equal(code, task.Task?.Code);
        Assert.Equal(RiderStatus.Assigned, task.Rider.Status);

        await using var customer = await LiveClient.ConnectAsync(app, app.Token(Role.Customer, customerId: customerAccount.Id));
        await customer.InvokeAsync("JoinOrder", code);
        var riderApp = app.Rider(riderAccount.Id);

        // At the restaurant.
        var restaurantPosition = restaurant.Location.Move(90, 20);
        await PostLocationAsync(riderApp, restaurantPosition.Lat, restaurantPosition.Lng);
        await customer.WaitForAsync(LiveMessages.OrderChanged, m => m.Payload<OrderDetails>().Timeline.Any(e => e.Type == OrderEventType.ArrivedAtRestaurant));
        Assert.Equal(RiderStatus.AtRestaurant, (await rider.WaitForAsync(LiveMessages.TaskChanged, m => m.Payload<RiderTaskView>().Rider.Status == RiderStatus.AtRestaurant)).Payload<RiderTaskView>().Rider.Status);

        // Picked up: the customer's details carry the delivery code; nobody else's do.
        (await riderApp.PostJsonAsync("/api/v1/rider/task/pickup")).EnsureSuccessStatusCode();
        var pickedUp = (await customer.WaitForAsync(LiveMessages.OrderChanged, m => m.Payload<OrderDetails>().Status == OrderStatus.PickedUp)).Payload<OrderDetails>();
        Assert.Equal(await app.DeliveryCodeAsync(code), pickedUp.DeliveryCode);
        // "Call Aman": the customer gets the rider's (made-up demo) number.
        Assert.StartsWith("+91 00000 ", pickedUp.Rider?.Phone);
        await dispatch.WaitForAsync(LiveMessages.OrderChanged, m => Is(m, code, OrderStatus.PickedUp));
        await rider.WaitForAsync(LiveMessages.TaskChanged, m => m.Payload<RiderTaskView>().Task?.Status == OrderStatus.PickedUp);

        // On the way.
        var away = restaurant.Location.Move(180, 400);
        await PostLocationAsync(riderApp, away.Lat, away.Lng);
        await customer.WaitForAsync(LiveMessages.OrderChanged, m => m.Payload<OrderDetails>().Status == OrderStatus.InTransit);
        await dispatch.WaitForAsync(LiveMessages.OrderChanged, m => Is(m, code, OrderStatus.InTransit));

        // Delivered: the rider's task is gone and today's tally counts it.
        await (await riderApp.PostJsonAsync("/api/v1/rider/task/deliver", new DeliverRequest(pickedUp.DeliveryCode!))).ReadAsync<DeliveryResult>();
        var delivered = (await customer.WaitForAsync(LiveMessages.OrderChanged, m => m.Payload<OrderDetails>().Status == OrderStatus.Delivered)).Payload<OrderDetails>();
        Assert.NotNull(delivered.DeliveredAt);
        await dispatch.WaitForAsync(LiveMessages.OrderChanged, m => Is(m, code, OrderStatus.Delivered));
        var done = (await rider.WaitForAsync(LiveMessages.TaskChanged, m => m.Payload<RiderTaskView>().Task is null)).Payload<RiderTaskView>();
        Assert.Equal(RiderStatus.Available, done.Rider.Status);
        Assert.Equal(1, done.Rider.TripsToday);

        // Each group gets its own kind of message only.
        Assert.Empty(dispatch.Received(LiveMessages.TaskAssigned));
        Assert.Empty(customer.Received(LiveMessages.TaskChanged));
        Assert.Empty(rider.Received(LiveMessages.OrderChanged));
        Assert.All(dispatch.Received(LiveMessages.OrderChanged), m => Assert.False(m.Arguments[0].TryGetProperty("deliveryCode", out _)));
    }

    [Fact]
    public async Task Reassigning_takes_the_task_from_one_rider_and_gives_it_to_the_next()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.None);
        var world = new World(app);
        var restaurant = await world.RestaurantAsync();
        var customer = await world.CustomerAsync();
        var first = await world.RiderAsync(restaurant.Location, 300);
        var second = await world.RiderAsync(restaurant.Location, 900);
        var placed = await PlaceAsync(app, World.OrderFrom(restaurant), customer.Id);
        Assert.Equal(first.Id, placed.Rider?.Id);
        await using var firstApp = await LiveClient.ConnectAsync(app, app.Token(Role.Rider, riderId: first.Id));
        await firstApp.InvokeAsync("JoinRider");
        await using var secondApp = await LiveClient.ConnectAsync(app, app.Token(Role.Rider, riderId: second.Id));
        await secondApp.InvokeAsync("JoinRider");

        (await app.Dispatcher().PostJsonAsync($"/api/v1/orders/{placed.Code}/reassign")).EnsureSuccessStatusCode();

        var takenAway = (await firstApp.WaitForAsync(LiveMessages.TaskChanged)).Payload<RiderTaskView>();
        Assert.Null(takenAway.Task);
        Assert.Equal(RiderStatus.Available, takenAway.Rider.Status);
        var given = (await secondApp.WaitForAsync(LiveMessages.TaskAssigned)).Payload<RiderTaskView>();
        Assert.Equal(placed.Code, given.Task?.Code);
        Assert.Empty(firstApp.Received(LiveMessages.TaskAssigned));
    }

    [Fact]
    public async Task Each_tick_the_customer_sees_their_rider_and_any_new_eta_and_everyone_sees_the_stats()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.None, new Dictionary<string, string?>
        {
            ["Workers:LiveBroadcast"] = "true",
            ["Live:BatchInterval"] = "00:00:00.300",
        });
        // Watching before anything happens: stats:changed only goes out when a number changes.
        await using var dispatch = await LiveClient.ConnectAsync(app, app.Token(Role.Dispatcher));
        await dispatch.InvokeAsync("JoinDispatch");
        await using var visitor = await LiveClient.ConnectAsync(app);
        await visitor.InvokeAsync("JoinPublic");
        var world = new World(app);
        var restaurant = await world.RestaurantAsync(prepMinutes: 0);
        var mine = await world.CustomerAsync();
        var theirs = await world.CustomerAsync();
        var riderAccount = await world.RiderAsync(restaurant.Location, 300);
        await world.RiderAsync(restaurant.Location, 600);
        var request = World.OrderFrom(restaurant);
        var placed = await PlaceAsync(app, request, mine.Id);
        var other = await PlaceAsync(app, request, theirs.Id);
        Assert.Equal(riderAccount.Id, placed.Rider?.Id);
        await using var customer = await LiveClient.ConnectAsync(app, app.Token(Role.Customer, customerId: mine.Id));
        await customer.InvokeAsync("JoinOrder", placed.Code);

        // Their rider, every tick: 300 m to the restaurant, then 2.5 km to the door.
        var position = (await customer.WaitForAsync(LiveMessages.RiderPosition)).Payload<RiderPosition>();
        Assert.Equal(placed.Code, position.Code);
        Assert.Equal(riderAccount.Id, position.RiderId);
        Assert.InRange(position.RemainingMeters!.Value, 2_780, 2_820);
        // …and the street they're on, for "riding down Mathura Road".
        var streets = app.Services.GetRequiredService<IStreetNames>();
        Assert.Equal(streets.Near(new GeoPoint(position.Location.Lat, position.Location.Lng)), position.Street);

        // The rider heads the wrong way: the ETA jumps past the promise, so the customer and the
        // dispatchers' queue hear about it on the next tick.
        var riderApp = app.Rider(riderAccount.Id);
        var wrongWay = restaurant.Location.Move(0, 3_500);
        await PostLocationAsync(riderApp, wrongWay.Lat, wrongWay.Lng);
        var late = (await customer.WaitForAsync(LiveMessages.EtaChanged, m => m.Payload<EtaChanged>().IsLate)).Payload<EtaChanged>();
        var details = await app.Dispatcher().GetJsonAsync<OrderDetails>($"/api/v1/orders/{placed.Code}");
        Assert.Equal(placed.Code, late.Code);
        Assert.Equal(details.EstimatedDeliveryAt, late.EstimatedDeliveryAt);
        Assert.Equal(details.MinutesLate, late.MinutesLate);
        Assert.InRange(late.MinutesLate, 1, 3);
        await dispatch.WaitForAsync(LiveMessages.OrderChanged, m => m.Payload<OrderSummary>() is { IsLate: true } s && s.Code == placed.Code);

        // An ETA still in the same minute isn't news.
        var etas = customer.Received(LiveMessages.EtaChanged).Count;
        var positions = customer.Received(LiveMessages.RiderPosition).Count;
        await customer.WaitForCountAsync(LiveMessages.RiderPosition, positions + 3, TimeSpan.FromSeconds(5));
        Assert.Equal(etas, customer.Received(LiveMessages.EtaChanged).Count);
        // Only their own order, never the other one.
        Assert.All(customer.Received(LiveMessages.RiderPosition), m => Assert.Equal(placed.Code, m.Payload<RiderPosition>().Code));
        Assert.All(customer.Received(LiveMessages.EtaChanged), m => Assert.Equal(placed.Code, m.Payload<EtaChanged>().Code));
        Assert.NotEqual(placed.Code, other.Code);

        // Dispatchers and visitors get the same stats when a number changes, and not otherwise.
        var expected = new LiveStats(2, 2, null, RunningLate: 1, NeedsRider: 0, RidersFree: 0, RidersOnDelivery: 2, DeliveredToday: 0);
        await dispatch.WaitForAsync(LiveMessages.StatsChanged, m => m.Payload<LiveStats>() == expected);
        await visitor.WaitForAsync(LiveMessages.StatsChanged, m => m.Payload<LiveStats>() == expected);
        var sent = dispatch.Received(LiveMessages.StatsChanged).Count;
        var batches = dispatch.Received(LiveMessages.RidersBatch).Count;
        await dispatch.WaitForCountAsync(LiveMessages.RidersBatch, batches + 3, TimeSpan.FromSeconds(5));
        Assert.Equal(sent, dispatch.Received(LiveMessages.StatsChanged).Count);
        Assert.Equal(expected, dispatch.Received(LiveMessages.StatsChanged)[^1].Payload<LiveStats>());

        // Delivered: the numbers move on the next tick.
        await PostLocationAsync(riderApp, restaurant.Location.Lat, restaurant.Location.Lng);
        (await riderApp.PostJsonAsync("/api/v1/rider/task/pickup")).EnsureSuccessStatusCode();
        await PostLocationAsync(riderApp, request.Drop.Lat, request.Drop.Lng);
        await (await riderApp.PostJsonAsync("/api/v1/rider/task/deliver", new DeliverRequest(await app.DeliveryCodeAsync(placed.Code)))).ReadAsync<DeliveryResult>();
        var after = (await dispatch.WaitForAsync(LiveMessages.StatsChanged, m => m.Payload<LiveStats>().DeliveredToday == 1)).Payload<LiveStats>();
        Assert.Equal(1, after.ActiveOrders);
        Assert.Equal(1, after.RidersFree);
        Assert.Equal(0, after.RunningLate);
        Assert.NotNull(after.AverageDeliveryMinutes);

        // Visitors never get orders or anyone's position.
        Assert.Empty(visitor.Received(LiveMessages.OrderChanged));
        Assert.Empty(visitor.Received(LiveMessages.RiderPosition));
        Assert.Empty(visitor.Received(LiveMessages.EtaChanged));
    }

    private static bool Is(LiveMessage message, string code, OrderStatus status) =>
        message.Payload<OrderSummary>() is var summary && summary.Code == code && summary.Status == status;

    private static async Task AssertFailsAsync(LiveClient client, string reason, string method, params object?[] args)
    {
        var error = await Assert.ThrowsAsync<HubException>(() => client.InvokeAsync(method, args));
        Assert.EndsWith($"HubException: {reason}", error.Message);
    }

    private static async Task<OrderDetails> PlaceAsync(TestApp app, PlaceOrderRequest request, int customerId) =>
        await (await app.Customer(customerId).PostJsonAsync("/api/v1/orders", request)).ReadAsync<OrderDetails>(HttpStatusCode.Created);

    private static async Task PostLocationAsync(HttpClient rider, double lat, double lng) =>
        Assert.Equal(HttpStatusCode.NoContent, (await rider.PostJsonAsync("/api/v1/rider/location", new LocationUpdate(lat, lng, null))).StatusCode);
}
