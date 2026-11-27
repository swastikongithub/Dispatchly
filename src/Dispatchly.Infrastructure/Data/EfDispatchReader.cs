using Dispatchly.Application.Abstractions;
using Dispatchly.Domain.Customers;
using Dispatchly.Domain.Geo;
using Dispatchly.Domain.Orders;
using Dispatchly.Domain.Restaurants;
using Dispatchly.Domain.Riders;
using Microsoft.EntityFrameworkCore;

namespace Dispatchly.Infrastructure.Data;

internal sealed class EfDispatchReader(DispatchlyDbContext db) : IDispatchReader
{
    private IQueryable<Order> Active => db.Orders
        .AsNoTracking()
        .Where(o => o.Status != OrderStatus.Delivered && o.Status != OrderStatus.Cancelled);

    public async Task<IReadOnlyList<Order>> ActiveOrdersAsync(OrderStatus? status, bool? late, CancellationToken ct)
    {
        var orders = Active.Include(o => o.Restaurant).Include(o => o.Rider).AsQueryable();
        if (status is { } only)
        {
            orders = orders.Where(o => o.Status == only);
        }
        if (late is { } isLate)
        {
            orders = isLate
                ? orders.Where(o => o.EstimatedDeliveryAt > o.PromisedBy)
                : orders.Where(o => o.EstimatedDeliveryAt <= o.PromisedBy);
        }
        return await orders.AsSplitQuery().ToListAsync(ct);
    }

    public Task<Order?> OrderAsync(string code, CancellationToken ct) =>
        db.Orders
            .AsNoTracking()
            .Include(o => o.Restaurant)
            .Include(o => o.Customer)
            .Include(o => o.Rider)
            .Include(o => o.Events)
            .AsSplitQuery()
            .SingleOrDefaultAsync(o => o.Code == code, ct);

    public async Task<IReadOnlyList<(Restaurant Restaurant, double DistanceMeters)>> RestaurantsNearAsync(
        GeoPoint near, int take, CancellationToken ct)
    {
        var restaurants = await db.Restaurants
            .FromSqlRaw(
                """
                SELECT r.*
                FROM restaurants r
                ORDER BY r.location <-> ST_SetSRID(ST_MakePoint({0}, {1}), 4326)::geography
                LIMIT {2}
                """,
                near.Lng, near.Lat, take)
            .AsNoTracking()
            .ToListAsync(ct);
        return [.. restaurants.Select(r => (r, r.Location.DistanceTo(near)))];
    }

    public Task<Rider?> RiderAsync(int id, CancellationToken ct) =>
        db.Riders.AsNoTracking().SingleOrDefaultAsync(r => r.Id == id, ct);

    public Task<Customer?> CustomerAsync(int id, CancellationToken ct) =>
        db.Customers.AsNoTracking().SingleOrDefaultAsync(c => c.Id == id, ct);

    public Task<Order?> RiderTaskAsync(int riderId, CancellationToken ct) =>
        Active
            .Include(o => o.Restaurant)
            .Include(o => o.Customer)
            .Include(o => o.Rider)
            .AsSplitQuery()
            .SingleOrDefaultAsync(o => o.RiderId == riderId, ct);

    public async Task<(int Trips, int EarnedPaise)> RiderEarningsAsync(int riderId, DateTimeOffset since, CancellationToken ct)
    {
        var pay = await db.Orders
            .Where(o => o.RiderId == riderId && o.Status == OrderStatus.Delivered && o.DeliveredAt >= since)
            .Select(o => o.RiderPayPaise)
            .ToListAsync(ct);
        return (pay.Count, pay.Sum());
    }

    public async Task<IReadOnlyList<Rider>> OnShiftRidersAsync(CancellationToken ct) =>
        await db.Riders
            .AsNoTracking()
            .Where(r => r.Status != RiderStatus.Offline)
            .OrderBy(r => r.Id)
            .ToListAsync(ct);

    public async Task<IReadOnlyDictionary<int, int>> DeliveriesByRiderAsync(DateTimeOffset since, CancellationToken ct) =>
        await db.Orders
            .Where(o => o.RiderId != null && o.Status == OrderStatus.Delivered && o.DeliveredAt >= since)
            .GroupBy(o => o.RiderId!.Value)
            .Select(g => new { RiderId = g.Key, Count = g.Count() })
            .ToDictionaryAsync(g => g.RiderId, g => g.Count, ct);

    public async Task<IReadOnlyList<Restaurant>> RestaurantsAsync(CancellationToken ct) =>
        await db.Restaurants.AsNoTracking().OrderBy(r => r.Id).ToListAsync(ct);

    public async Task<IReadOnlyList<(Rider Rider, double DistanceMeters)>> NearestAvailableRidersAsync(
        GeoPoint near, int radiusMeters, int? excludingRiderId, int take, CancellationToken ct)
    {
        // KNN (<->) on the GiST index, as the assignment does, but without locking: this only shows
        // who an assignment would choose from.
        var riders = await db.Riders
            .FromSqlRaw(
                """
                SELECT r.*, r.xmin
                FROM riders r
                WHERE r.status = 'Available'
                  AND ST_DWithin(r.location, ST_SetSRID(ST_MakePoint({0}, {1}), 4326)::geography, {2})
                  AND r.id <> {3}
                ORDER BY r.location <-> ST_SetSRID(ST_MakePoint({0}, {1}), 4326)::geography
                LIMIT {4}
                """,
                near.Lng, near.Lat, (double)radiusMeters, excludingRiderId ?? 0, take)
            .AsNoTracking()
            .ToListAsync(ct);
        return [.. riders.Select(r => (r, r.Location.DistanceTo(near))).OrderBy(c => c.Item2)];
    }

    public async Task<LiveCounts> LiveCountsAsync(DateTimeOffset averageSince, DateTimeOffset startOfDay, CancellationToken ct)
    {
        var riders = await db.Riders
            .GroupBy(r => r.Status)
            .Select(g => new { Status = g.Key, Count = g.Count() })
            .ToListAsync(ct);
        var orders = await Active
            .GroupBy(o => new { o.Status, Late = o.EstimatedDeliveryAt > o.PromisedBy })
            .Select(g => new { g.Key.Status, g.Key.Late, Count = g.Count() })
            .ToListAsync(ct);
        var delivered = await db.Database
            .SqlQueryRaw<DeliveredCounts>(
                """
                SELECT
                    (SELECT avg(extract(epoch FROM delivered_at - created_at)) / 60
                     FROM orders WHERE status = 'Delivered' AND delivered_at >= {0}) AS "AverageMinutes",
                    (SELECT count(*)::int
                     FROM orders WHERE status = 'Delivered' AND delivered_at >= {1}) AS "Today"
                """,
                averageSince,
                startOfDay)
            .SingleAsync(ct);
        int RidersWhere(Func<RiderStatus, bool> status) => riders.Where(g => status(g.Status)).Sum(g => g.Count);
        return new LiveCounts(
            RidersOnline: RidersWhere(s => s != RiderStatus.Offline),
            RidersFree: RidersWhere(s => s == RiderStatus.Available),
            RidersOnDelivery: RidersWhere(s => s is RiderStatus.Assigned or RiderStatus.AtRestaurant or RiderStatus.Delivering),
            ActiveOrders: orders.Sum(g => g.Count),
            NeedsRider: orders.Where(g => g.Status == OrderStatus.Searching).Sum(g => g.Count),
            RunningLate: orders.Where(g => g.Late).Sum(g => g.Count),
            AverageDeliveryMinutes: delivered.AverageMinutes,
            DeliveredToday: delivered.Today);
    }

    private sealed class DeliveredCounts
    {
        public double? AverageMinutes { get; init; }
        public int Today { get; init; }
    }
}
