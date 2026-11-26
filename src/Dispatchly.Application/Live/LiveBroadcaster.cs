using Dispatchly.Application.Abstractions;
using Dispatchly.Domain.Orders;

namespace Dispatchly.Application.Live;

/// <summary>
/// One live tick (every 2 s, PLAN.md §3.6): every on-shift rider in one <c>riders:batch</c>, each
/// customer's rider in <c>rider:position</c>, and <c>eta:changed</c> and <c>stats:changed</c> only
/// for what changed since the last tick. All messages of a tick carry the same time.
/// </summary>
public sealed class LiveBroadcaster(
    IDispatchReader reader,
    StatsQueries stats,
    ILiveHub hub,
    LiveBroadcastState state,
    TimeProvider clock)
{
    public async Task TickAsync(CancellationToken ct)
    {
        var at = clock.GetUtcNow();
        var riders = await reader.OnShiftRidersAsync(ct);
        var batch = new RidersBatch(at, [.. riders.Select(r => r.ToPoint())]);
        await hub.SendAsync(LiveGroups.Dispatch, LiveMessages.RidersBatch, [batch], ct);
        await hub.SendAsync(LiveGroups.Public, LiveMessages.RidersBatch, [batch], ct);

        var orders = await reader.ActiveOrdersAsync(status: null, late: null, ct);
        foreach (var order in orders)
        {
            if (order.Rider is { } rider)
            {
                var position = new RiderPosition(at, order.Code, rider.Id, rider.Location.ToPosition(), rider.Bearing, order.RemainingMeters());
                await hub.SendAsync(LiveGroups.Order(order.Code), LiveMessages.RiderPosition, [position], ct);
            }
            if (state.EtaMoved(order))
            {
                var eta = new EtaChanged(at, order.Code, order.EstimatedDeliveryAt, order.IsLate, order.MinutesLate);
                await hub.SendAsync(LiveGroups.Order(order.Code), LiveMessages.EtaChanged, [eta], ct);
                // The dispatcher's queue shows the same ETA and "Running late".
                await hub.SendAsync(LiveGroups.Dispatch, LiveMessages.OrderChanged, [order.ToSummary(), at], ct);
            }
        }
        state.Forget(orders);

        var live = await stats.LiveAsync(ct);
        if (state.StatsChanged(live))
        {
            await hub.SendAsync(LiveGroups.Dispatch, LiveMessages.StatsChanged, [live, at], ct);
            await hub.SendAsync(LiveGroups.Public, LiveMessages.StatsChanged, [live, at], ct);
        }
    }
}

/// <summary>What the last ticks sent, so the next one sends only changes. One per process; ticks run one at a time.</summary>
public sealed class LiveBroadcastState
{
    private readonly Dictionary<string, EtaShown> _etas = [];
    private LiveStats? _stats;

    /// <summary>True when the order's ETA shows another minute or its lateness changed, and remembers it.</summary>
    internal bool EtaMoved(Order order)
    {
        var at = order.EstimatedDeliveryAt;
        var shown = new EtaShown(at.AddTicks(-(at.UtcTicks % TimeSpan.TicksPerMinute)), order.IsLate, order.MinutesLate);
        if (_etas.TryGetValue(order.Code, out var last) && last == shown)
        {
            return false;
        }
        _etas[order.Code] = shown;
        return true;
    }

    /// <summary>Drops orders that are no longer active.</summary>
    internal void Forget(IReadOnlyList<Order> active)
    {
        if (_etas.Count == active.Count)
        {
            return;
        }
        var codes = active.Select(o => o.Code).ToHashSet();
        foreach (var code in _etas.Keys.Where(c => !codes.Contains(c)).ToList())
        {
            _etas.Remove(code);
        }
    }

    internal bool StatsChanged(LiveStats stats)
    {
        if (stats == _stats)
        {
            return false;
        }
        _stats = stats;
        return true;
    }

    private readonly record struct EtaShown(DateTimeOffset Minute, bool IsLate, int MinutesLate);
}
