using System.Net;
using System.Text.Json;
using Dispatchly.Application;
using Dispatchly.Domain.Orders;
using Dispatchly.Domain.Riders;
using Dispatchly.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace Dispatchly.IntegrationTests;

/// <summary>GET /live/snapshot and GET /live/public: what live clients start from and come back to.</summary>
public sealed class LiveSnapshotTests(PostgisServer postgis)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task The_dashboard_snapshot_has_every_rider_on_shift_the_queue_and_the_stats()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.DemoCity);
        var dispatcher = app.Dispatcher();
        var before = DateTimeOffset.UtcNow;

        var snapshot = await dispatcher.GetJsonAsync<LiveSnapshot>("/api/v1/live/snapshot");

        Assert.InRange(snapshot.At, before.AddSeconds(-1), DateTimeOffset.UtcNow.AddSeconds(1));
        var onShift = await app.QueryAsync(db => db.Riders.Where(r => r.Status != RiderStatus.Offline).OrderBy(r => r.Id).ToListAsync(Ct));
        Assert.Equal(onShift.Select(r => r.Id), snapshot.Riders.Select(r => r.Id));
        var aman = Assert.Single(snapshot.Riders, r => r.Name == "Aman Verma");
        Assert.Equal("DL-4817", aman.OrderCode);
        Assert.Equal("DL 3S CK 2041", aman.Plate);
        Assert.NotEmpty(aman.Phone);
        Assert.Equal(RiderStatus.Delivering, aman.Status);
        Assert.All(snapshot.Riders.Where(r => r.Status == RiderStatus.Available), r => Assert.Null(r.OrderCode));
        Assert.All(snapshot.Riders.Where(r => r.Status != RiderStatus.Available), r => Assert.NotNull(r.OrderCode));
        // The same queue, in the same order, as GET /orders, and the same stats as GET /stats/live.
        var queue = await dispatcher.GetJsonAsync<List<OrderSummary>>("/api/v1/orders");
        Assert.Equal(queue, snapshot.Orders);
        Assert.Equal(OrderStatus.Searching, snapshot.Orders[0].Status);
        Assert.Equal(await dispatcher.GetJsonAsync<LiveStats>("/api/v1/stats/live"), snapshot.Stats);
    }

    [Fact]
    public async Task The_landing_page_snapshot_has_positions_and_numbers_but_no_names_or_orders()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.DemoCity);
        var visitor = app.Client();

        var response = await visitor.GetAsync("/api/v1/live/public", Ct);
        var body = await response.Content.ReadAsStringAsync(Ct);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var json = JsonDocument.Parse(body);
        Assert.Equal(["at", "riders", "stats"], json.RootElement.EnumerateObject().Select(p => p.Name));
        Assert.All(json.RootElement.GetProperty("riders").EnumerateArray(), point =>
        {
            Assert.Equal(JsonValueKind.Array, point.ValueKind);
            Assert.Equal(5, point.GetArrayLength());
        });
        Assert.DoesNotContain("Aman", body, StringComparison.Ordinal);
        Assert.DoesNotContain("DL-48", body, StringComparison.Ordinal);
        Assert.DoesNotContain("+91", body, StringComparison.Ordinal);

        var snapshot = JsonSerializer.Deserialize<PublicSnapshot>(body, Http.Json)!;
        var dashboard = await app.Dispatcher().GetJsonAsync<LiveSnapshot>("/api/v1/live/snapshot");
        Assert.Equal(dashboard.Riders.Select(r => r.Id), snapshot.Riders.Select(r => r.Id));
        var aman = dashboard.Riders.Single(r => r.Name == "Aman Verma");
        var point = snapshot.Riders.Single(r => r.Id == aman.Id);
        Assert.Equal(Math.Round(aman.Location.Lat, 5), point.Lat);
        Assert.Equal(Math.Round(aman.Location.Lng, 5), point.Lng);
        Assert.Equal((int)Math.Round(aman.Bearing) % 360, point.Bearing);
        Assert.Equal(aman.Status, point.Status);
        Assert.Equal(dashboard.Stats, snapshot.Stats);
    }

    [Fact]
    public async Task Only_dispatchers_get_the_dashboard_snapshot()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.DemoCity);

        Assert.Equal(HttpStatusCode.Unauthorized, (await app.Client().GetAsync("/api/v1/live/snapshot", Ct)).StatusCode);
        var customer = app.Customer(await app.DemoCustomerIdAsync());
        Assert.Equal(HttpStatusCode.Forbidden, (await customer.GetAsync("/api/v1/live/snapshot", Ct)).StatusCode);
        var rider = app.Rider(await app.DemoRiderIdAsync());
        Assert.Equal(HttpStatusCode.Forbidden, (await rider.GetAsync("/api/v1/live/snapshot", Ct)).StatusCode);
    }
}
