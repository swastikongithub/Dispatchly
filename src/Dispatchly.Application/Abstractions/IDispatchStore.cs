using Dispatchly.Domain.Customers;
using Dispatchly.Domain.Geo;
using Dispatchly.Domain.Orders;
using Dispatchly.Domain.Restaurants;
using Dispatchly.Domain.Riders;

namespace Dispatchly.Application.Abstractions;

/// <summary>
/// Write side: tracked entities, row locks and transactions. Locks are always taken order first,
/// then rider, so two use cases can never wait on each other in a cycle.
/// </summary>
public interface IDispatchStore
{
    Task<IStoreTransaction> BeginTransactionAsync(CancellationToken ct);

    Task SaveChangesAsync(CancellationToken ct);

    void Add(Order order);

    Task<int> NextOrderNumberAsync(CancellationToken ct);

    Task<Restaurant?> FindRestaurantAsync(int id, CancellationToken ct);

    Task<Customer?> FindCustomerAsync(int id, CancellationToken ct);

    /// <summary>
    /// Locks the order (FOR UPDATE) and loads its restaurant and rider. With <paramref name="skipLocked"/>,
    /// returns null instead of waiting when another transaction holds it.
    /// </summary>
    Task<Order?> LockOrderAsync(int id, bool skipLocked, CancellationToken ct);

    /// <inheritdoc cref="LockOrderAsync(int, bool, CancellationToken)"/>
    Task<Order?> LockOrderAsync(string code, CancellationToken ct);

    /// <summary>Locks the rider's active order, if any, then the rider. Null when the rider doesn't exist.</summary>
    Task<(Rider Rider, Order? Task)?> LockRiderWithTaskAsync(int riderId, CancellationToken ct);

    /// <summary>
    /// The assignment query (PLAN.md §3.5): the nearest Available rider within the radius by PostGIS
    /// KNN, locked with FOR UPDATE SKIP LOCKED so concurrent assignments each get a different rider.
    /// </summary>
    Task<RiderCandidate?> LockNearestAvailableRiderAsync(
        GeoPoint near, int radiusMeters, int? excludingRiderId, CancellationToken ct);

    Task<int> CountAvailableRidersAsync(GeoPoint near, int radiusMeters, int? excludingRiderId, CancellationToken ct);

    /// <summary>Orders still searching for a rider, oldest first.</summary>
    Task<IReadOnlyList<int>> SearchingOrderIdsAsync(int max, CancellationToken ct);
}

public interface IStoreTransaction : IAsyncDisposable
{
    Task CommitAsync(CancellationToken ct);
}

public sealed record RiderCandidate(Rider Rider, double DistanceMeters);
