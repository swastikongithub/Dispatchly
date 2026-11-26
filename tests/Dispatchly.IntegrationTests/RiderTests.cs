using System.Net;
using Dispatchly.Api.Controllers;
using Dispatchly.Application;
using Dispatchly.Domain.Geo;
using Dispatchly.Domain.Orders;
using Dispatchly.Domain.Riders;
using Dispatchly.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace Dispatchly.IntegrationTests;

/// <summary>The rider app's endpoints (/rider/...), on the demo city.</summary>
public sealed class RiderTests(PostgisServer postgis)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task The_demo_rider_takes_DL_4810_from_the_cafe_to_the_door()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.DemoCity);
        var session = await (await app.Client().PostJsonAsync("/api/v1/auth/demo", new { role = Role.Rider })).ReadAsync<DemoSession>();
        var rider = app.Client(session.Token);
        var dispatcher = app.Dispatcher();

        // Heading to the café.
        var start = await rider.GetJsonAsync<RiderTaskView>("/api/v1/rider/task");
        var task = start.Task!;
        Assert.Equal("DL-4810", task.Code);
        Assert.Equal(OrderStatus.Assigned, task.Status);
        Assert.Equal(RiderStatus.Assigned, start.Rider.Status);
        Assert.Equal("Second Pour Café", task.Restaurant.Name);
        Assert.NotEmpty(task.Items);
        Assert.True(task.DropRideMinutes > 0);
        Assert.True(task.RiderPayPaise >= 3_000);
        Assert.Equal(0, task.RiderPayPaise % 100);
        await (await rider.PostJsonAsync("/api/v1/rider/task/deliver", new { code = "0000" })).AssertProblemAsync(HttpStatusCode.Conflict, "order_not_picked_up");

        // Arriving: within 50 m of the café.
        await PostLocationAsync(rider, task.Restaurant.Location.Lat, task.Restaurant.Location.Lng);
        Assert.Equal(RiderStatus.AtRestaurant, (await rider.GetJsonAsync<RiderTaskView>("/api/v1/rider/task")).Rider.Status);
        Assert.Equal(OrderEventType.ArrivedAtRestaurant, (await LastEventAsync(dispatcher, task.Code)).Type);

        // "Picked up · Start ride".
        var pickedUp = await (await rider.PostJsonAsync("/api/v1/rider/task/pickup")).ReadAsync<RiderTaskView>();
        Assert.Equal(OrderStatus.PickedUp, pickedUp.Task?.Status);
        Assert.Equal(RiderStatus.Delivering, pickedUp.Rider.Status);

        // Leaving the café with the food.
        var cafe = new GeoPoint(task.Restaurant.Location.Lat, task.Restaurant.Location.Lng);
        var drop = new GeoPoint(task.Drop.Location.Lat, task.Drop.Location.Lng);
        var onTheWay = cafe.Move(cafe.BearingTo(drop), 300);
        await PostLocationAsync(rider, onTheWay.Lat, onTheWay.Lng);
        var riding = await rider.GetJsonAsync<RiderTaskView>("/api/v1/rider/task");
        Assert.Equal(OrderStatus.InTransit, riding.Task?.Status);
        Assert.Equal(OrderEventType.OnTheWay, (await LastEventAsync(dispatcher, task.Code)).Type);
        var moved = await app.QueryAsync(db => db.Riders.Where(r => r.Id == session.RiderId).Select(r => new { r.Location, r.Bearing }).SingleAsync(Ct));
        Assert.True(moved.Location.DistanceTo(onTheWay) < 1);
        Assert.InRange(moved.Bearing, cafe.BearingTo(drop) - 1, cafe.BearingTo(drop) + 1);

        // At the door: a wrong code changes nothing, the right one completes the delivery.
        var code = await app.DeliveryCodeAsync(task.Code);
        var wrong = code == "0000" ? "0001" : "0000";
        await (await rider.PostJsonAsync("/api/v1/rider/task/deliver", new { code = wrong })).AssertProblemAsync(HttpStatusCode.UnprocessableEntity, "wrong_delivery_code");
        Assert.Equal(OrderStatus.InTransit, (await rider.GetJsonAsync<RiderTaskView>("/api/v1/rider/task")).Task?.Status);

        var delivered = await (await rider.PostJsonAsync("/api/v1/rider/task/deliver", new { code })).ReadAsync<DeliveryResult>();

        Assert.Equal(task.Code, delivered.Code);
        Assert.Equal(task.RiderPayPaise, delivered.EarnedPaise);
        Assert.Equal(RiderStatus.Available, delivered.Rider.Status);
        Assert.Equal(start.Rider.TripsToday + 1, delivered.Rider.TripsToday);
        Assert.Equal(start.Rider.EarnedTodayPaise + task.RiderPayPaise, delivered.Rider.EarnedTodayPaise);
        var order = await dispatcher.GetJsonAsync<OrderDetails>($"/api/v1/orders/{task.Code}");
        Assert.Equal(OrderStatus.Delivered, order.Status);
        Assert.NotNull(order.DeliveredAt);
        Assert.Equal(OrderEventType.Delivered, order.Timeline[^1].Type);
        Assert.Null((await rider.GetJsonAsync<RiderTaskView>("/api/v1/rider/task")).Task);
        await (await rider.PostJsonAsync("/api/v1/rider/task/pickup")).AssertProblemAsync(HttpStatusCode.Conflict, "no_task");
        await (await rider.PostJsonAsync("/api/v1/rider/task/deliver", new { code })).AssertProblemAsync(HttpStatusCode.Conflict, "no_task");
    }

    [Fact]
    public async Task Riders_go_online_and_offline_but_not_in_the_middle_of_a_task()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.DemoCity);
        var busy = app.Rider(await app.DemoRiderIdAsync());
        var freeId = await app.QueryAsync(db => db.Riders.Where(r => r.Status == RiderStatus.Available).OrderBy(r => r.Id).Select(r => r.Id).FirstAsync(Ct));
        var free = app.Rider(freeId);

        await (await busy.PutJsonAsync("/api/v1/rider/status", new { online = false })).AssertProblemAsync(HttpStatusCode.Conflict, "rider_busy");
        Assert.Equal(RiderStatus.Assigned, (await busy.GetJsonAsync<RiderTaskView>("/api/v1/rider/task")).Rider.Status);

        var idle = await free.GetJsonAsync<RiderTaskView>("/api/v1/rider/task");
        Assert.Null(idle.Task);
        Assert.Equal(RiderStatus.Available, idle.Rider.Status);

        var offline = await (await free.PutJsonAsync("/api/v1/rider/status", new { online = false })).ReadAsync<RiderTaskView>();
        Assert.Equal(RiderStatus.Offline, offline.Rider.Status);
        Assert.Null(offline.Rider.OnlineSince);

        var before = DateTimeOffset.UtcNow;
        var online = await (await free.PutJsonAsync("/api/v1/rider/status", new { online = true })).ReadAsync<RiderTaskView>();
        Assert.Equal(RiderStatus.Available, online.Rider.Status);
        Assert.InRange(online.Rider.OnlineSince!.Value, before.AddSeconds(-1), DateTimeOffset.UtcNow.AddSeconds(1));
    }

    [Fact]
    public async Task Bad_rider_input_is_rejected()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.DemoCity);
        var rider = app.Rider(await app.DemoRiderIdAsync());

        foreach (var update in new object[] { new { lat = 91, lng = 77.2 }, new { lat = 28.6, lng = -181 }, new { lat = 28.6, lng = 77.2, bearing = 400 }, new { lat = "28.6", lng = 77.2 } })
        {
            await (await rider.PostJsonAsync("/api/v1/rider/location", update)).AssertProblemAsync(HttpStatusCode.BadRequest);
        }
        foreach (var code in new[] { "12", "12345", "abcd", "" })
        {
            await (await rider.PostJsonAsync("/api/v1/rider/task/deliver", new { code })).AssertProblemAsync(HttpStatusCode.BadRequest);
        }
        // A rider who isn't in the database (a token for a deleted rider).
        await (await app.Rider(999_999).GetAsync("/api/v1/rider/task", Ct)).AssertProblemAsync(HttpStatusCode.NotFound, "not_found");
    }

    private static async Task PostLocationAsync(HttpClient rider, double lat, double lng)
    {
        var response = await rider.PostJsonAsync("/api/v1/rider/location", new { lat, lng });
        Assert.Equal(HttpStatusCode.NoContent, response.StatusCode);
    }

    private static async Task<TimelineEntry> LastEventAsync(HttpClient dispatcher, string code) =>
        (await dispatcher.GetJsonAsync<OrderDetails>($"/api/v1/orders/{code}")).Timeline[^1];
}
