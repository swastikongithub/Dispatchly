using System.Net;
using Dispatchly.Application;
using Dispatchly.Domain.Orders;
using Dispatchly.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;

namespace Dispatchly.IntegrationTests;

/// <summary>GET /orders and GET /orders/{code} on the demo city.</summary>
public sealed class OrderQueryTests(PostgisServer postgis)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task The_queue_lists_active_orders_needing_a_rider_first_then_late_then_by_eta()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.DemoCity);

        var queue = await app.Dispatcher().GetJsonAsync<List<OrderSummary>>("/api/v1/orders");

        var active = await app.QueryAsync(db => db.Orders
            .Where(o => o.Status != OrderStatus.Delivered && o.Status != OrderStatus.Cancelled)
            .Select(o => o.Code)
            .ToListAsync(Ct));
        Assert.Equal(active.Order(), queue.Select(o => o.Code).Order());
        // Needs rider first, the one that has waited longest on top (as in the dashboard design).
        Assert.Equal(["DL-4823", "DL-4822"], queue.Take(2).Select(o => o.Code));
        Assert.All(queue.Take(2), o => Assert.Equal(OrderStatus.Searching, o.Status));
        var ranks = queue.Select(o => o.Status == OrderStatus.Searching ? 0 : o.IsLate ? 1 : 2).ToList();
        Assert.Equal(ranks.Order(), ranks);
        foreach (var rank in new[] { 1, 2 })
        {
            var etas = queue.Where((_, i) => ranks[i] == rank).Select(o => o.EstimatedDeliveryAt).ToList();
            Assert.Equal(etas.Order(), etas);
        }
        Assert.Contains(queue, o => o is { Code: "DL-4812", IsLate: true } && o.MinutesLate > 0);
    }

    [Fact]
    public async Task The_queue_filters_by_status_and_lateness()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.DemoCity);
        var dispatcher = app.Dispatcher();

        var searching = await dispatcher.GetJsonAsync<List<OrderSummary>>("/api/v1/orders?status=Searching");
        var late = await dispatcher.GetJsonAsync<List<OrderSummary>>("/api/v1/orders?late=true");
        var onTime = await dispatcher.GetJsonAsync<List<OrderSummary>>("/api/v1/orders?late=false");
        var delivered = await dispatcher.GetJsonAsync<List<OrderSummary>>("/api/v1/orders?status=Delivered");

        Assert.Equal(["DL-4823", "DL-4822"], searching.Select(o => o.Code));
        Assert.All(searching, o => Assert.Null(o.RiderId));
        Assert.NotEmpty(late);
        Assert.All(late, o => Assert.True(o.IsLate));
        Assert.NotEmpty(onTime);
        Assert.All(onTime, o => Assert.False(o.IsLate));
        // The queue is for live orders; history isn't in it.
        Assert.Empty(delivered);
        await (await dispatcher.GetAsync("/api/v1/orders?status=Lost", Ct)).AssertProblemAsync(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task The_customer_sees_their_order_with_its_delivery_code()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.DemoCity);

        var hero = await app.Customer(await app.DemoCustomerIdAsync()).GetJsonAsync<OrderDetails>("/api/v1/orders/DL-4817");

        Assert.Equal(OrderStatus.InTransit, hero.Status);
        Assert.Equal("4821", hero.DeliveryCode);
        Assert.Equal("Saffron & Smoke", hero.Restaurant.Name);
        Assert.Equal("Priya", hero.Drop.CustomerFirstName);
        Assert.Equal("Aman Verma", hero.Rider?.Name);
        // "Call Aman": the demo's made-up numbers, which can't reach anyone.
        Assert.StartsWith("+91 00000 ", hero.Rider?.Phone);
        Assert.Equal(
            [OrderEventType.Placed, OrderEventType.Assigned, OrderEventType.ArrivedAtRestaurant, OrderEventType.PickedUp, OrderEventType.OnTheWay],
            hero.Timeline.Select(e => e.Type));
        var assigned = hero.Timeline[1];
        Assert.Equal(4, assigned.FreeRiders);
        Assert.Equal(600, assigned.DistanceMeters);
        Assert.Equal(hero.Items.Sum(i => i.Quantity * i.UnitPricePaise), hero.TotalPaise);
        Assert.True(hero.RemainingMeters > 0);
    }

    [Fact]
    public async Task Dispatchers_see_any_order_and_the_riders_phone_but_not_the_code()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.DemoCity);

        var order = await app.Dispatcher().GetJsonAsync<OrderDetails>("/api/v1/orders/DL-4810");

        Assert.Equal(OrderStatus.Assigned, order.Status);
        Assert.Equal("Neha Gupta", order.Rider?.Name);
        Assert.NotNull(order.Rider?.Phone);
        Assert.Null(order.DeliveryCode);
    }

    [Fact]
    public async Task The_customer_sees_which_street_their_rider_is_on()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.DemoCity);
        var customer = app.Customer(await app.DemoCustomerIdAsync());
        var aman = await app.QueryAsync(db => db.Riders.Where(r => r.Name == "Aman Verma").Select(r => r.Id).SingleAsync(Ct));

        // By Sundar Nagar, on Mathura Road (OpenStreetMap).
        var onMathuraRoad = await app.Rider(aman).PostJsonAsync("/api/v1/rider/location", new { lat = 28.592765, lng = 77.244095 });
        Assert.Equal(HttpStatusCode.NoContent, onMathuraRoad.StatusCode);
        var hero = await customer.GetJsonAsync<OrderDetails>("/api/v1/orders/DL-4817");
        Assert.Equal("Mathura Road", hero.Rider?.Street);

        // Far from any main road, no street is named.
        var offRoad = await app.Rider(aman).PostJsonAsync("/api/v1/rider/location", new { lat = 28.0, lng = 77.0 });
        Assert.Equal(HttpStatusCode.NoContent, offRoad.StatusCode);
        hero = await customer.GetJsonAsync<OrderDetails>("/api/v1/orders/DL-4817");
        Assert.Null(hero.Rider?.Street);
    }

    [Theory]
    [InlineData("DL-4817")] // someone else's order
    [InlineData("DL-9999")]
    [InlineData("4817")]
    [InlineData("DL-48a7")]
    public async Task Orders_that_arent_yours_or_dont_exist_are_not_found(string code)
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.DemoCity);
        var priya = await app.DemoCustomerIdAsync();
        var someoneElse = await app.QueryAsync(db => db.Customers.Where(c => c.Id != priya).Select(c => c.Id).FirstAsync(Ct));

        var response = await app.Customer(someoneElse).GetAsync($"/api/v1/orders/{code}", Ct);

        // The same answer either way, so order codes can't be probed.
        await response.AssertProblemAsync(HttpStatusCode.NotFound, "not_found");
        if (code != "DL-4817")
        {
            await (await app.Dispatcher().GetAsync($"/api/v1/orders/{code}", Ct)).AssertProblemAsync(HttpStatusCode.NotFound, "not_found");
        }
    }
}
