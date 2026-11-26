using System.Net;
using Dispatchly.Application;
using Dispatchly.Domain.Dispatch;
using Dispatchly.Domain.Geo;
using Dispatchly.Domain.Orders;
using Dispatchly.Domain.Riders;
using Dispatchly.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Dispatchly.IntegrationTests;

/// <summary>GET /restaurants?near= and GET /stats/live.</summary>
public sealed class RestaurantAndStatsTests(PostgisServer postgis)
{
    private static readonly GeoPoint ConnaughtPlace = new(28.6315, 77.2167);

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task Nearby_restaurants_come_closest_first_with_their_menus()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.DemoCity);

        var restaurants = await app.Customer(await app.DemoCustomerIdAsync())
            .GetJsonAsync<List<NearbyRestaurant>>("/api/v1/restaurants?near=28.6315,77.2167");

        Assert.Equal(RestaurantQueries.NearbyLimit, restaurants.Count);
        Assert.Equal(restaurants.Count, restaurants.Select(r => r.Id).Distinct().Count());
        var distances = restaurants.Select(r => r.DistanceMeters).ToList();
        Assert.Equal(distances.Order(), distances);
        Assert.All(restaurants, r =>
        {
            Assert.NotEmpty(r.Menu);
            Assert.All(r.Menu, m => Assert.True(m.PricePaise > 0));
            // PostGIS measures on the spheroid, the domain on a sphere: within half a percent.
            var haversine = ConnaughtPlace.DistanceTo(new GeoPoint(r.Location.Lat, r.Location.Lng));
            Assert.InRange(r.DistanceMeters, haversine * 0.995 - 1, haversine * 1.005 + 1);
        });
        // Nothing nearer was left out.
        var returned = restaurants.Select(r => r.Id).ToList();
        var others = await app.QueryAsync(db => db.Restaurants.Where(r => !returned.Contains(r.Id)).Select(r => r.Location).ToListAsync(Ct));
        Assert.NotEmpty(others);
        Assert.All(others, l => Assert.True(ConnaughtPlace.DistanceTo(l) * 1.005 + 1 >= distances[^1]));
    }

    [Theory]
    [InlineData("?near=")]
    [InlineData("")]
    [InlineData("?near=abc")]
    [InlineData("?near=28.6")]
    [InlineData("?near=28.6,77.2,1")]
    [InlineData("?near=91,77.2")]
    [InlineData("?near=28.6,181")]
    [InlineData("?near=28.6;77.2")]
    public async Task Nearby_needs_a_valid_lat_lng(string query)
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.DemoCity);

        var response = await app.Customer(await app.DemoCustomerIdAsync()).GetAsync($"/api/v1/restaurants{query}", Ct);

        await response.AssertProblemAsync(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Live_stats_match_the_database()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.DemoCity);

        var stats = await app.Dispatcher().GetJsonAsync<LiveStats>("/api/v1/stats/live");

        var riders = await app.QueryAsync(db => db.Riders.Select(r => r.Status).ToListAsync(Ct));
        var active = await app.QueryAsync(db => db.Orders
            .Where(o => o.Status != OrderStatus.Delivered && o.Status != OrderStatus.Cancelled)
            .ToListAsync(Ct));
        var since = DateTimeOffset.UtcNow - StatsQueries.AverageWindow;
        var delivered = await app.QueryAsync(db => db.Orders
            .Where(o => o.Status == OrderStatus.Delivered && o.DeliveredAt >= since)
            .Select(o => new { o.CreatedAt, o.DeliveredAt })
            .ToListAsync(Ct));
        var today = app.Services.GetRequiredService<DispatchPolicy>().StartOfCityDay(DateTimeOffset.UtcNow);
        var deliveredToday = await app.QueryAsync(db => db.Orders.CountAsync(o => o.Status == OrderStatus.Delivered && o.DeliveredAt >= today, Ct));
        Assert.Equal(riders.Count(s => s != RiderStatus.Offline), stats.RidersOnline);
        Assert.Equal(riders.Count(s => s == RiderStatus.Available), stats.RidersFree);
        Assert.Equal(riders.Count(s => s is RiderStatus.Assigned or RiderStatus.AtRestaurant or RiderStatus.Delivering), stats.RidersOnDelivery);
        Assert.True(stats.RidersFree > 0 && stats.RidersOnDelivery > 0);
        Assert.Equal(deliveredToday, stats.DeliveredToday);
        Assert.Equal(active.Count, stats.ActiveOrders);
        Assert.Equal(active.Count(o => o.Status == OrderStatus.Searching), stats.NeedsRider);
        Assert.Equal(active.Count(o => o.IsLate), stats.RunningLate);
        Assert.NotEmpty(delivered);
        var average = delivered.Average(o => (o.DeliveredAt!.Value - o.CreatedAt).TotalMinutes);
        Assert.InRange(stats.AverageDeliveryMinutes!.Value, Math.Round(average) - 1, Math.Round(average) + 1);
    }

    [Fact]
    public async Task Live_stats_follow_new_orders()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.None);
        var world = new World(app);
        var restaurant = await world.RestaurantAsync();
        var customer = await world.CustomerAsync();
        await world.RiderAsync(restaurant.Location, 300);
        await world.RiderAsync(restaurant.Location, 300, online: false);
        var dispatcher = app.Dispatcher();
        Assert.Equal(new LiveStats(1, 0, null, 0, 0, RidersFree: 1, RidersOnDelivery: 0, DeliveredToday: 0), await dispatcher.GetJsonAsync<LiveStats>("/api/v1/stats/live"));

        var client = app.Customer(customer.Id);
        await (await client.PostJsonAsync("/api/v1/orders", World.OrderFrom(restaurant))).ReadAsync<OrderDetails>(HttpStatusCode.Created);
        await (await client.PostJsonAsync("/api/v1/orders", World.OrderFrom(restaurant))).ReadAsync<OrderDetails>(HttpStatusCode.Created);

        // One assigned (the rider stays online, now busy) and one needing a rider.
        Assert.Equal(new LiveStats(1, 2, null, 0, 1, RidersFree: 0, RidersOnDelivery: 1, DeliveredToday: 0), await dispatcher.GetJsonAsync<LiveStats>("/api/v1/stats/live"));
    }
}
