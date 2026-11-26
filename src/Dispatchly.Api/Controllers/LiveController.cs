using Dispatchly.Application;
using Dispatchly.Application.Live;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Dispatchly.Api.Controllers;

/// <summary>
/// The snapshots live clients start from, and refetch after every reconnect: join the hub's groups
/// first, then apply only messages newer than the snapshot's <c>at</c> (docs/realtime.md).
/// </summary>
[ApiController]
[Route("api/v1/live")]
public sealed class LiveController(LiveQueries live) : ControllerBase
{
    /// <summary>The dashboard's first paint: every rider on shift, the order queue in queue order, and the stats.</summary>
    [HttpGet("snapshot")]
    [Authorize(Roles = nameof(Role.Dispatcher))]
    public Task<LiveSnapshot> Snapshot(CancellationToken ct) => live.SnapshotAsync(ct);

    /// <summary>The landing page's live city: rider positions as [id, lat, lng, bearing, status] and the stats. No names, no orders.</summary>
    [HttpGet("public")]
    [AllowAnonymous]
    public Task<PublicSnapshot> Public(CancellationToken ct) => live.PublicAsync(ct);
}
