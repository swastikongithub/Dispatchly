using Dispatchly.Application.Abstractions;
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

    public async Task<LiveCounts> LiveCountsAsync(DateTimeOffset deliveredSince, CancellationToken ct)
    {
        var ridersOnline = await db.Riders.CountAsync(r => r.Status != RiderStatus.Offline, ct);
        var byStatus = await Active
            .GroupBy(o => new { o.Status, Late = o.EstimatedDeliveryAt > o.PromisedBy })
            .Select(g => new { g.Key.Status, g.Key.Late, Count = g.Count() })
            .ToListAsync(ct);
        var averageMinutes = await db.Database
            .SqlQueryRaw<double?>(
                """
                SELECT avg(extract(epoch FROM delivered_at - created_at)) / 60 AS "Value"
                FROM orders
                WHERE status = 'Delivered' AND delivered_at >= {0}
                """,
                deliveredSince)
            .SingleAsync(ct);
        return new LiveCounts(
            ridersOnline,
            byStatus.Sum(g => g.Count),
            byStatus.Where(g => g.Status == OrderStatus.Searching).Sum(g => g.Count),
            byStatus.Where(g => g.Late).Sum(g => g.Count),
            averageMinutes);
    }
}
