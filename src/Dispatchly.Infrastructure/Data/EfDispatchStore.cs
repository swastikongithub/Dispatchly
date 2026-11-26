using Dispatchly.Application.Abstractions;
using Dispatchly.Domain.Customers;
using Dispatchly.Domain.Geo;
using Dispatchly.Domain.Orders;
using Dispatchly.Domain.Restaurants;
using Dispatchly.Domain.Riders;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Dispatchly.Infrastructure.Data;

internal sealed class EfDispatchStore(DispatchlyDbContext db) : IDispatchStore
{
    // Raw SQL returns every mapped column; xmin is a system column, so SELECT * leaves it out.
    private const string OrderColumns = "o.*, o.xmin";
    private const string RiderColumns = "r.*, r.xmin";
    private const string ActiveStatuses = "('Assigned', 'PickedUp', 'InTransit')";

    /// <summary>
    /// How many of the nearest riders one assignment considers. Only riders being assigned by other
    /// transactions at this instant are skipped, so this bounds the concurrency, not the search.
    /// </summary>
    private const int CandidateLimit = 100;

    /// <summary>Identity ids start at 1, so "exclude rider 0" excludes nobody.</summary>
    private const int NoRider = 0;

    public async Task<IStoreTransaction> BeginTransactionAsync(CancellationToken ct) =>
        new EfTransaction(await db.Database.BeginTransactionAsync(ct));

    public Task SaveChangesAsync(CancellationToken ct) => db.SaveChangesAsync(ct);

    public void Add(Order order) => db.Orders.Add(order);

    public Task<int> NextOrderNumberAsync(CancellationToken ct) =>
        db.Database
            .SqlQueryRaw<int>($"""SELECT nextval('{DispatchlyDbContext.OrderNumberSequence}')::int AS "Value" """)
            .SingleAsync(ct);

    public async Task<Restaurant?> FindRestaurantAsync(int id, CancellationToken ct) =>
        await db.Restaurants.FindAsync([id], ct);

    public async Task<Customer?> FindCustomerAsync(int id, CancellationToken ct) =>
        await db.Customers.FindAsync([id], ct);

    public async Task<Order?> LockOrderAsync(int id, bool skipLocked, CancellationToken ct)
    {
        var orders = skipLocked
            ? db.Orders.FromSqlRaw($"SELECT {OrderColumns} FROM orders o WHERE o.id = {{0}} FOR UPDATE SKIP LOCKED", id)
            : db.Orders.FromSqlRaw($"SELECT {OrderColumns} FROM orders o WHERE o.id = {{0}} FOR UPDATE", id);
        return await WithRestaurantAndLockedRiderAsync((await orders.ToListAsync(ct)).SingleOrDefault(), ct);
    }

    public async Task<Order?> LockOrderAsync(string code, CancellationToken ct)
    {
        var orders = await db.Orders
            .FromSqlRaw($"SELECT {OrderColumns} FROM orders o WHERE o.code = {{0}} FOR UPDATE", code)
            .ToListAsync(ct);
        return await WithRestaurantAndLockedRiderAsync(orders.SingleOrDefault(), ct);
    }

    public async Task<(Rider Rider, Order? Task)?> LockRiderWithTaskAsync(int riderId, CancellationToken ct)
    {
        // Order first, then rider: the same lock order as every other path.
        var tasks = await db.Orders
            .FromSqlRaw($"SELECT {OrderColumns} FROM orders o WHERE o.rider_id = {{0}} AND o.status IN {ActiveStatuses} FOR UPDATE", riderId)
            .ToListAsync(ct);
        var task = tasks.SingleOrDefault();
        if (task is not null)
        {
            await db.Entry(task).Reference(o => o.Restaurant).LoadAsync(ct);
            await db.Entry(task).Reference(o => o.Customer).LoadAsync(ct);
        }
        var rider = await LockRiderAsync(riderId, ct);
        return rider is null ? null : (rider, task);
    }

    public async Task<RiderCandidate?> LockNearestAvailableRiderAsync(
        GeoPoint near, int radiusMeters, int? excludingRiderId, CancellationToken ct)
    {
        // The nearest Available riders by KNN (<->) on the GiST index, then lock the first one that
        // nobody else holds: SKIP LOCKED passes over riders another transaction is assigning right
        // now, so concurrent orders each lock a different rider. The KNN search and the lock are
        // separate steps because PostgreSQL can't lock rows straight from a KNN index scan whose
        // distances need rechecking (geography): "attempted to lock invisible tuple".
        // status is checked again after the lock, against the row as committed.
        var riders = await db.Riders
            .FromSqlRaw(
                $$"""
                WITH candidates AS MATERIALIZED (
                    SELECT id, location <-> ST_SetSRID(ST_MakePoint({0}, {1}), 4326)::geography AS distance
                    FROM riders
                    WHERE status = 'Available'
                      AND ST_DWithin(location, ST_SetSRID(ST_MakePoint({0}, {1}), 4326)::geography, {2})
                      AND id <> {3}
                    ORDER BY distance
                    LIMIT {{CandidateLimit}}
                )
                SELECT {{RiderColumns}}
                FROM riders r
                JOIN candidates c ON c.id = r.id
                WHERE r.status = 'Available'
                ORDER BY c.distance
                LIMIT 1
                FOR UPDATE OF r SKIP LOCKED
                """,
                near.Lng, near.Lat, (double)radiusMeters, excludingRiderId ?? NoRider)
            .ToListAsync(ct);
        var rider = riders.SingleOrDefault();
        return rider is null ? null : new RiderCandidate(rider, rider.Location.DistanceTo(near));
    }

    public Task<int> CountAvailableRidersAsync(GeoPoint near, int radiusMeters, int? excludingRiderId, CancellationToken ct) =>
        db.Database
            .SqlQueryRaw<int>(
                """
                SELECT count(*)::int AS "Value"
                FROM riders r
                WHERE r.status = 'Available'
                  AND ST_DWithin(r.location, ST_SetSRID(ST_MakePoint({0}, {1}), 4326)::geography, {2})
                  AND r.id <> {3}
                """,
                near.Lng, near.Lat, (double)radiusMeters, excludingRiderId ?? NoRider)
            .SingleAsync(ct);

    public async Task<IReadOnlyList<int>> SearchingOrderIdsAsync(int max, CancellationToken ct) =>
        await db.Orders
            .Where(o => o.Status == OrderStatus.Searching)
            .OrderBy(o => o.CreatedAt)
            .Select(o => o.Id)
            .Take(max)
            .ToListAsync(ct);

    private async Task<Rider?> LockRiderAsync(int riderId, CancellationToken ct) =>
        (await db.Riders
            .FromSqlRaw($"SELECT {RiderColumns} FROM riders r WHERE r.id = {{0}} FOR UPDATE", riderId)
            .ToListAsync(ct))
        .SingleOrDefault();

    private async Task<Order?> WithRestaurantAndLockedRiderAsync(Order? order, CancellationToken ct)
    {
        if (order is null)
        {
            return null;
        }
        await db.Entry(order).Reference(o => o.Restaurant).LoadAsync(ct);
        if (order.RiderId is { } riderId)
        {
            // Fix-up sets order.Rider to the tracked, locked rider.
            await LockRiderAsync(riderId, ct);
        }
        return order;
    }

    private sealed class EfTransaction(IDbContextTransaction transaction) : IStoreTransaction
    {
        public Task CommitAsync(CancellationToken ct) => transaction.CommitAsync(ct);

        public ValueTask DisposeAsync() => transaction.DisposeAsync();
    }
}
