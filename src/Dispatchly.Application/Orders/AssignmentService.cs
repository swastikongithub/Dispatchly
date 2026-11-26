using Dispatchly.Application.Abstractions;
using Dispatchly.Domain.Dispatch;
using Dispatchly.Domain.Orders;

namespace Dispatchly.Application.Orders;

/// <summary>
/// Nearest-free-rider assignment (PLAN.md §3.5). Each attempt is one transaction: lock the order,
/// lock the nearest Available rider within the order's radius with FOR UPDATE SKIP LOCKED, assign
/// both, record the event, commit, then publish. Two concurrent attempts can never take the same
/// rider: the second one skips the row the first has locked and takes the next nearest.
/// </summary>
public sealed class AssignmentService(IDispatchStore store, ILiveEvents live, DispatchPolicy policy, TimeProvider clock)
{
    /// <summary>The first attempt, right after the order is placed. True when a rider was assigned.</summary>
    public Task<bool> TryAssignAsync(int orderId, CancellationToken ct) =>
        AttemptAsync(orderId, isRetry: false, ct);

    /// <summary>
    /// The retry worker's pass (every 5 s): widen each searching order's radius with its age and try
    /// again. Orders another transaction is working on are skipped until the next pass.
    /// </summary>
    public async Task<int> RetrySearchingAsync(CancellationToken ct)
    {
        var assigned = 0;
        foreach (var id in await store.SearchingOrderIdsAsync(max: 200, ct))
        {
            if (await AttemptAsync(id, isRetry: true, ct))
            {
                assigned++;
            }
        }
        return assigned;
    }

    /// <summary>
    /// Sends an order that hasn't been picked up to the next nearest free rider within the widest
    /// radius. The current rider is free again. Throws <see cref="ConflictException"/> when nobody else is free.
    /// </summary>
    public async Task ReassignAsync(string code, CancellationToken ct)
    {
        Order order;
        await using (var transaction = await store.BeginTransactionAsync(ct))
        {
            order = await store.LockOrderAsync(code, ct) ?? throw new NotFoundException($"Order {code} not found.");
            if (order.Status != OrderStatus.Assigned)
            {
                throw new ConflictException(
                    "order_not_reassignable",
                    $"Order {code} is {order.Status}; only an assigned order that hasn't been picked up can be reassigned.");
            }
            var current = order.RiderId;
            var near = order.Restaurant.Location;
            var next = await store.LockNearestAvailableRiderAsync(near, policy.MaxRadius, current, ct)
                ?? throw new ConflictException("no_free_rider", $"No other free rider within {policy.MaxRadius / 1_000.0:0.#} km.");
            var free = await store.CountAvailableRidersAsync(near, policy.MaxRadius, current, ct);
            order.Reassign(next.Rider, free, next.DistanceMeters, policy, clock.GetUtcNow());
            await store.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        }
        await live.OrderChangedAsync(order, ct);
    }

    private async Task<bool> AttemptAsync(int orderId, bool isRetry, CancellationToken ct)
    {
        Order? order;
        bool assigned;
        await using (var transaction = await store.BeginTransactionAsync(ct))
        {
            order = await store.LockOrderAsync(orderId, skipLocked: isRetry, ct);
            if (order is not { Status: OrderStatus.Searching })
            {
                return false;
            }
            var now = clock.GetUtcNow();
            var radiusBefore = order.SearchRadiusMeters;
            if (isRetry)
            {
                order.WidenSearch(policy, now);
            }

            var near = order.Restaurant.Location;
            var candidate = await store.LockNearestAvailableRiderAsync(near, order.SearchRadiusMeters, null, ct);
            if (candidate is null)
            {
                order.RefreshEta(policy, now);
                await store.SaveChangesAsync(ct);
                await transaction.CommitAsync(ct);
                // "Searching within 3 km" follows the radius, so a wider search is news.
                if (order.SearchRadiusMeters != radiusBefore)
                {
                    await live.OrderChangedAsync(order, ct);
                }
                return false;
            }

            // N in "Nearest of N free riders" counts the chosen rider too.
            var free = await store.CountAvailableRidersAsync(near, order.SearchRadiusMeters, null, ct);
            order.Assign(candidate.Rider, free, candidate.DistanceMeters, policy, now);
            await store.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
            assigned = true;
        }
        await live.OrderChangedAsync(order, ct);
        return assigned;
    }
}
