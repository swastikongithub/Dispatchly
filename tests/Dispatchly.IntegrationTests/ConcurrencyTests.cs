using System.Net;
using Dispatchly.Application;
using Dispatchly.Domain.Orders;
using Dispatchly.Domain.Riders;
using Dispatchly.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace Dispatchly.IntegrationTests;

/// <summary>
/// The assignment path under contention (PLAN.md §3.5, CLAUDE.md): however many orders race,
/// a rider is never given two orders, and no free rider is left idle while orders wait.
/// </summary>
public sealed class ConcurrencyTests(PostgisServer postgis)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Fifty_concurrent_orders_with_twenty_free_riders_never_share_a_rider()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.None);
        var world = new World(app);
        var restaurant = await world.RestaurantAsync();
        var customer = await world.CustomerAsync();
        var free = await world.RidersAsync(20, i => restaurant.Location.Move(i * 18, 100 + i * 60));
        var offline = await world.RidersAsync(5, i => restaurant.Location.Move(i * 72, 50), online: false);
        var outOfRange = await world.RiderAsync(restaurant.Location, 6_000);
        var client = app.Customer(customer.Id);
        using var start = new SemaphoreSlim(0);

        var requests = Enumerable.Range(0, 50).Select(async _ =>
        {
            await start.WaitAsync(Ct);
            return await client.PostJsonAsync("/api/v1/orders", World.OrderFrom(restaurant));
        }).ToList();
        start.Release(requests.Count);
        var responses = await Task.WhenAll(requests);

        var orders = new List<OrderDetails>();
        foreach (var response in responses)
        {
            orders.Add(await response.ReadAsync<OrderDetails>(HttpStatusCode.Created));
        }
        Assert.Equal(50, orders.Select(o => o.Code).Distinct().Count());
        var assigned = orders.Where(o => o.Status == OrderStatus.Assigned).ToList();
        Assert.Equal(20, assigned.Count);
        Assert.Equal(30, orders.Count(o => o.Status == OrderStatus.Searching));
        // Every free rider got exactly one order.
        Assert.Equal(free.Select(r => r.Id).Order(), assigned.Select(o => o.Rider!.Id).Order());
        Assert.All(assigned, o => Assert.Single(o.Timeline, e => e.Type == OrderEventType.Assigned));

        // And the database agrees.
        var riders = await app.QueryAsync(db => db.Riders.ToDictionaryAsync(r => r.Id, r => r.Status, Ct));
        Assert.All(free, r => Assert.Equal(RiderStatus.Assigned, riders[r.Id]));
        Assert.All(offline, r => Assert.Equal(RiderStatus.Offline, riders[r.Id]));
        Assert.Equal(RiderStatus.Available, riders[outOfRange.Id]);
        Assert.Empty(await RidersWithMoreThanOneActiveOrderAsync(app));
        Assert.Equal(20, await app.QueryAsync(db => db.OrderEvents.CountAsync(e => e.Type == OrderEventType.Assigned, Ct)));
    }

    [Fact]
    public async Task Two_api_instances_retrying_the_same_waiting_orders_never_share_a_rider()
    {
        var retry = new Dictionary<string, string?>
        {
            ["Workers:AssignmentRetry"] = "true",
            ["Dispatch:RetryInterval"] = "00:00:00.200",
        };
        await using var first = await TestApp.StartAsync(postgis, Seed.None);
        var world = new World(first);
        var restaurant = await world.RestaurantAsync();
        var customer = await world.CustomerAsync();
        var client = first.Customer(customer.Id);
        for (var i = 0; i < 30; i++)
        {
            var order = await (await client.PostJsonAsync("/api/v1/orders", World.OrderFrom(restaurant))).ReadAsync<OrderDetails>(HttpStatusCode.Created);
            Assert.Equal(OrderStatus.Searching, order.Status);
        }
        var riders = await world.RidersAsync(10, i => restaurant.Location.Move(i * 36, 200 + i * 100), online: false);

        // Two instances retry every 200 ms while all ten riders come online at once.
        await using var a = TestApp.Start(first.ConnectionString, retry);
        await using var b = TestApp.Start(first.ConnectionString, retry);
        await Task.WhenAll(riders.Select((r, i) => (i % 2 == 0 ? a : b).Rider(r.Id).PutJsonAsync("/api/v1/rider/status", new { online = true })));

        var deadline = DateTime.UtcNow.AddSeconds(20);
        List<Order> orders;
        do
        {
            await Task.Delay(200, Ct);
            orders = await first.QueryAsync(db => db.Orders.AsNoTracking().ToListAsync(Ct));
        }
        while (orders.Count(o => o.Status == OrderStatus.Assigned) < riders.Count && DateTime.UtcNow < deadline);
        // A few more passes, to catch anything that would double up late.
        await Task.Delay(1_000, Ct);
        orders = await first.QueryAsync(db => db.Orders.AsNoTracking().ToListAsync(Ct));

        var assigned = orders.Where(o => o.Status == OrderStatus.Assigned).ToList();
        Assert.Equal(riders.Select(r => r.Id).Order(), assigned.Select(o => o.RiderId!.Value).Order());
        Assert.Equal(20, orders.Count(o => o.Status == OrderStatus.Searching));
        Assert.Empty(await RidersWithMoreThanOneActiveOrderAsync(first));
        Assert.Equal(10, await first.QueryAsync(db => db.OrderEvents.CountAsync(e => e.Type == OrderEventType.Assigned, Ct)));
    }

    private static Task<List<int>> RidersWithMoreThanOneActiveOrderAsync(TestApp app) =>
        app.QueryAsync(db => db.Orders
            .Where(o => o.RiderId != null && o.Status != OrderStatus.Delivered && o.Status != OrderStatus.Cancelled)
            .GroupBy(o => o.RiderId!.Value)
            .Where(g => g.Count() > 1)
            .Select(g => g.Key)
            .ToListAsync(Ct));
}
