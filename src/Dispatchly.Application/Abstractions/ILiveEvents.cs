using Dispatchly.Domain.Orders;

namespace Dispatchly.Application.Abstractions;

/// <summary>
/// Publishes changes to live clients after they're committed (PLAN.md §3.5 step 4, §3.6).
/// SignalR implements it in W3; until then nothing listens.
/// </summary>
public interface ILiveEvents
{
    Task OrderChangedAsync(Order order, CancellationToken ct);
}

public sealed class NoLiveEvents : ILiveEvents
{
    public Task OrderChangedAsync(Order order, CancellationToken ct) => Task.CompletedTask;
}
