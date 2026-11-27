using Dispatchly.Application.Abstractions;
using Dispatchly.Application.Riders;
using Dispatchly.Domain.Dispatch;
using Dispatchly.Domain.Orders;

namespace Dispatchly.Application.Live;

/// <summary>
/// Tells live clients about a committed change (PLAN.md §3.5 step 4, §3.6). Every payload is built
/// from a fresh read after the commit, so what goes out is what's saved. The time on a message is
/// taken before that read: a client that applies only messages newer than its snapshot never
/// applies anything older than what it already has (docs/realtime.md, "Recovery").
/// </summary>
public sealed class LivePublisher(IDispatchReader reader, ILiveHub hub, IStreetNames streets, DispatchPolicy policy, TimeProvider clock) : ILiveEvents
{
    public async Task OrderChangedAsync(Order order, CancellationToken ct)
    {
        var at = clock.GetUtcNow();
        if (await SendOrderAsync(order.Code, at, ct) is { RiderId: { } riderId })
        {
            await SendTaskAsync(riderId, LiveMessages.TaskChanged, at, ct);
        }
    }

    public async Task RiderAssignedAsync(Order order, int? previousRiderId, CancellationToken ct)
    {
        var at = clock.GetUtcNow();
        var saved = await SendOrderAsync(order.Code, at, ct);
        if (previousRiderId is { } previous && previous != saved?.RiderId)
        {
            // Taken away: their task is now null (or the next one, if they already have another).
            await SendTaskAsync(previous, LiveMessages.TaskChanged, at, ct);
        }
        if (saved?.RiderId is { } riderId)
        {
            await SendTaskAsync(riderId, LiveMessages.TaskAssigned, at, ct);
        }
    }

    /// <summary>order:changed to dispatchers (the queue row) and to the order's customer (everything, with the delivery code).</summary>
    private async Task<Order?> SendOrderAsync(string code, DateTimeOffset at, CancellationToken ct)
    {
        if (await reader.OrderAsync(code, ct) is not { } order)
        {
            return null;
        }
        await hub.SendAsync(LiveGroups.Dispatch, LiveMessages.OrderChanged, [order.ToSummary(), at], ct);
        var customer = new Viewer(Role.Customer, CustomerId: order.CustomerId);
        await hub.SendAsync(LiveGroups.Order(order.Code), LiveMessages.OrderChanged, [order.ToDetails(customer, streets), at], ct);
        return order;
    }

    private async Task SendTaskAsync(int riderId, string message, DateTimeOffset at, CancellationToken ct)
    {
        if (await RiderTaskViews.BuildAsync(reader, policy, clock, riderId, ct) is { } view)
        {
            await hub.SendAsync(LiveGroups.Rider(riderId), message, [view, at], ct);
        }
    }
}
