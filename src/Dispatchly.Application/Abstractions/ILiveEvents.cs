using Dispatchly.Domain.Orders;

namespace Dispatchly.Application.Abstractions;

/// <summary>
/// Tells live clients about a change once it's committed (PLAN.md §3.5 step 4, §3.6): the
/// dispatch group, the order's customer and the riders involved. Publishing never fails the use
/// case: the change is already saved.
/// </summary>
public interface ILiveEvents
{
    /// <summary>The order changed: placed, searching wider, picked up, on the way, delivered…</summary>
    Task OrderChangedAsync(Order order, CancellationToken ct);

    /// <summary>The order went to a rider, taken from <paramref name="previousRiderId"/> on a reassignment.</summary>
    Task RiderAssignedAsync(Order order, int? previousRiderId, CancellationToken ct);
}

/// <summary>Sends a message to a SignalR group. SignalR implements it in the Api.</summary>
public interface ILiveHub
{
    /// <summary>Sends <paramref name="message"/> with these arguments to everyone in <paramref name="group"/>.</summary>
    Task SendAsync(string group, string message, object?[] arguments, CancellationToken ct);
}
