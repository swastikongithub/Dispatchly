using Dispatchly.Application.Abstractions;
using Dispatchly.Application.Orders;

namespace Dispatchly.Application.Live;

/// <summary>
/// The snapshots clients start from, and come back to after a reconnect (PLAN.md §3.6). Each one's
/// <c>At</c> is taken before reading, so any change it misses comes in a message newer than it.
/// </summary>
public sealed class LiveQueries(IDispatchReader reader, StatsQueries stats, TimeProvider clock)
{
    /// <summary><c>GET /live/snapshot</c>: the dashboard's riders, order queue and stats.</summary>
    public async Task<LiveSnapshot> SnapshotAsync(CancellationToken ct)
    {
        var at = clock.GetUtcNow();
        var riders = await reader.OnShiftRidersAsync(ct);
        var orders = await reader.ActiveOrdersAsync(status: null, late: null, ct);
        var live = await stats.LiveAsync(ct);
        var tasks = orders
            .Where(o => o.RiderId is not null)
            .ToDictionary(o => o.RiderId!.Value, o => o.Code);
        return new LiveSnapshot(
            at,
            [.. riders.Select(r => r.ToLive(tasks.GetValueOrDefault(r.Id)))],
            [.. OrderQueue.Sort(orders).Select(o => o.ToSummary())],
            live);
    }

    /// <summary><c>GET /live/public</c>: rider positions and stats for the landing page. No names, no orders.</summary>
    public async Task<PublicSnapshot> PublicAsync(CancellationToken ct)
    {
        var at = clock.GetUtcNow();
        var riders = await reader.OnShiftRidersAsync(ct);
        var live = await stats.LiveAsync(ct);
        return new PublicSnapshot(at, [.. riders.Select(r => r.ToPoint())], live);
    }
}
