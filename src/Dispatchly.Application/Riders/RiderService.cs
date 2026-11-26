using Dispatchly.Application.Abstractions;
using Dispatchly.Domain.Dispatch;
using Dispatchly.Domain.Geo;
using Dispatchly.Domain.Orders;

namespace Dispatchly.Application.Riders;

/// <summary>The rider app's use cases. Each mutation locks the rider's order, then the rider.</summary>
public sealed class RiderService(
    IDispatchStore store,
    IDispatchReader reader,
    ILiveEvents live,
    DispatchPolicy policy,
    TimeProvider clock)
{
    public async Task<RiderTaskView> GetTaskAsync(int riderId, CancellationToken ct)
    {
        var rider = await reader.RiderAsync(riderId, ct) ?? throw new NotFoundException($"Rider {riderId} not found.");
        var task = await reader.RiderTaskAsync(riderId, ct);
        return new RiderTaskView(await SelfAsync(rider, ct), task?.ToTask(policy));
    }

    public async Task<RiderTaskView> SetOnlineAsync(int riderId, bool online, CancellationToken ct)
    {
        await using (var transaction = await store.BeginTransactionAsync(ct))
        {
            var (rider, _) = await LockAsync(riderId, ct);
            if (online)
            {
                rider.GoOnline(clock.GetUtcNow());
            }
            else
            {
                rider.GoOffline();
            }
            await store.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        }
        return await GetTaskAsync(riderId, ct);
    }

    public async Task<RiderTaskView> ConfirmPickupAsync(int riderId, CancellationToken ct)
    {
        Order order;
        await using (var transaction = await store.BeginTransactionAsync(ct))
        {
            (_, var task) = await LockAsync(riderId, ct);
            order = task ?? throw new ConflictException("no_task", "You don't have a task to pick up.");
            order.ConfirmPickup(policy, clock.GetUtcNow());
            await store.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        }
        await live.OrderChangedAsync(order, ct);
        return await GetTaskAsync(riderId, ct);
    }

    /// <summary>Completes the delivery with the customer's 4-digit code (PLAN.md §5.4).</summary>
    public async Task<DeliveryResult> DeliverAsync(int riderId, string code, CancellationToken ct)
    {
        Order order;
        await using (var transaction = await store.BeginTransactionAsync(ct))
        {
            (_, var task) = await LockAsync(riderId, ct);
            order = task ?? throw new ConflictException("no_task", "You don't have a task to deliver.");
            order.Deliver(code, clock.GetUtcNow());
            await store.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        }
        await live.OrderChangedAsync(order, ct);
        var view = await GetTaskAsync(riderId, ct);
        return new DeliveryResult(order.Code, order.RiderPayPaise, view.Rider);
    }

    /// <summary>
    /// A new GPS position (the mobile app; the simulator calls this directly). Notes arrival at the
    /// restaurant and leaving it with the food, and refreshes the order's ETA.
    /// </summary>
    public async Task UpdateLocationAsync(int riderId, LocationUpdate update, CancellationToken ct)
    {
        Order? changed = null;
        await using (var transaction = await store.BeginTransactionAsync(ct))
        {
            var (rider, task) = await LockAsync(riderId, ct);
            var now = clock.GetUtcNow();
            rider.MoveTo(new GeoPoint(update.Lat, update.Lng), update.Bearing, now);
            if (task is not null)
            {
                var before = (task.Status, rider.Status);
                task.RiderMoved(policy, now);
                if ((task.Status, rider.Status) != before)
                {
                    changed = task;
                }
            }
            await store.SaveChangesAsync(ct);
            await transaction.CommitAsync(ct);
        }
        if (changed is not null)
        {
            await live.OrderChangedAsync(changed, ct);
        }
    }

    private async Task<(Domain.Riders.Rider Rider, Order? Task)> LockAsync(int riderId, CancellationToken ct) =>
        await store.LockRiderWithTaskAsync(riderId, ct) ?? throw new NotFoundException($"Rider {riderId} not found.");

    private async Task<RiderSelf> SelfAsync(Domain.Riders.Rider rider, CancellationToken ct)
    {
        var (trips, earned) = await reader.RiderEarningsAsync(rider.Id, policy.StartOfCityDay(clock.GetUtcNow()), ct);
        return rider.ToSelf(trips, earned);
    }
}
