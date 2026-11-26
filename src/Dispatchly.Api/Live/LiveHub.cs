using Dispatchly.Api.Auth;
using Dispatchly.Application;
using Dispatchly.Application.Abstractions;
using Dispatchly.Application.Live;
using Dispatchly.Domain.Orders;
using Microsoft.AspNetCore.SignalR;

namespace Dispatchly.Api.Live;

/// <summary>
/// The live hub (PLAN.md §3.6, docs/realtime.md). Anyone may connect; each Join… checks who is
/// asking. The JWT comes in <c>?access_token=</c>, since browsers can't set headers on WebSockets.
/// Clients join again after every reconnect: groups don't survive a new connection.
/// </summary>
public sealed class LiveHub(IDispatchReader reader) : Hub
{
    public const string Path = "/hubs/live";

    /// <summary>Rider positions and stats, for anyone.</summary>
    public Task JoinPublic() => Groups.AddToGroupAsync(Context.ConnectionId, LiveGroups.Public);

    /// <summary>The whole city, for dispatchers.</summary>
    public Task JoinDispatch()
    {
        Require(Role.Dispatcher);
        return Groups.AddToGroupAsync(Context.ConnectionId, LiveGroups.Dispatch);
    }

    /// <summary>One order, for the customer who placed it.</summary>
    public async Task JoinOrder(string code)
    {
        var viewer = Require(Role.Customer);
        var order = OrderCode.IsValid(code) ? await reader.OrderAsync(code, Context.ConnectionAborted) : null;
        if (order is null || order.CustomerId != viewer.CustomerId)
        {
            // Like the REST API: someone else's order looks the same as no order.
            throw new HubException(LiveErrors.NotFound);
        }
        await Groups.AddToGroupAsync(Context.ConnectionId, LiveGroups.Order(order.Code));
    }

    public Task LeaveOrder(string code) =>
        OrderCode.IsValid(code)
            ? Groups.RemoveFromGroupAsync(Context.ConnectionId, LiveGroups.Order(code))
            : Task.CompletedTask;

    /// <summary>The signed-in rider's tasks.</summary>
    public Task JoinRider()
    {
        var viewer = Require(Role.Rider);
        var riderId = viewer.RiderId ?? throw new HubException(LiveErrors.Forbidden);
        return Groups.AddToGroupAsync(Context.ConnectionId, LiveGroups.Rider(riderId));
    }

    private Viewer Require(Role role)
    {
        if (Context.User?.Identity?.IsAuthenticated != true)
        {
            throw new HubException(LiveErrors.Unauthorized);
        }
        var viewer = Context.User.ToViewer();
        return viewer.Role == role ? viewer : throw new HubException(LiveErrors.Forbidden);
    }
}

/// <summary>The reasons a Join… fails, at the end of the client's error message.</summary>
public static class LiveErrors
{
    /// <summary>No valid token: sign in (again) and reconnect.</summary>
    public const string Unauthorized = "unauthorized";

    /// <summary>Signed in with the wrong role for this group.</summary>
    public const string Forbidden = "forbidden";

    /// <summary>No such order, or not this customer's.</summary>
    public const string NotFound = "not_found";
}

/// <summary>Sends through SignalR to everyone in a group.</summary>
internal sealed class SignalRLiveHub(IHubContext<LiveHub> hub) : ILiveHub
{
    public Task SendAsync(string group, string message, object?[] arguments, CancellationToken ct) =>
        hub.Clients.Group(group).SendCoreAsync(message, arguments, ct);
}

/// <summary>
/// Publishes after the change is committed, so a failure here is logged and never fails the use
/// case. It doesn't use the request's token either: a client hanging up mustn't stop everyone
/// else hearing about a change that is already saved.
/// </summary>
internal sealed class SafeLiveEvents(LivePublisher publisher, ILogger<SafeLiveEvents> logger) : ILiveEvents
{
    private static readonly TimeSpan Timeout = TimeSpan.FromSeconds(10);

    public Task OrderChangedAsync(Order order, CancellationToken ct) =>
        PublishAsync(order, token => publisher.OrderChangedAsync(order, token));

    public Task RiderAssignedAsync(Order order, int? previousRiderId, CancellationToken ct) =>
        PublishAsync(order, token => publisher.RiderAssignedAsync(order, previousRiderId, token));

    private async Task PublishAsync(Order order, Func<CancellationToken, Task> publish)
    {
        using var timeout = new CancellationTokenSource(Timeout);
        try
        {
            await publish(timeout.Token);
        }
        catch (Exception e)
        {
            logger.LogError(e, "Couldn't publish the change to order {Code}", order.Code);
        }
    }
}
