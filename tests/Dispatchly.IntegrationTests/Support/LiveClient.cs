using System.Text.Json;
using Dispatchly.Application.Live;
using Microsoft.AspNetCore.Http.Connections;
using Microsoft.AspNetCore.SignalR.Client;

namespace Dispatchly.IntegrationTests.Support;

/// <summary>
/// A SignalR client on the live hub, as a browser connects: WebSockets, the JWT in
/// <c>?access_token=</c>. It keeps every message it receives, with when it arrived.
/// </summary>
public sealed class LiveClient : IAsyncDisposable
{
    /// <summary>How many arguments each message has (docs/realtime.md).</summary>
    private static readonly Dictionary<string, int> Arguments = new()
    {
        [LiveMessages.RidersBatch] = 1,
        [LiveMessages.RiderPosition] = 1,
        [LiveMessages.EtaChanged] = 1,
        [LiveMessages.StatsChanged] = 2,
        [LiveMessages.OrderChanged] = 2,
        [LiveMessages.TaskAssigned] = 2,
        [LiveMessages.TaskChanged] = 2,
    };

    private readonly HubConnection _connection;
    private readonly List<LiveMessage> _received = [];

    private LiveClient(HubConnection connection)
    {
        _connection = connection;
        foreach (var (name, count) in Arguments)
        {
            _connection.On(name, [.. Enumerable.Repeat(typeof(JsonElement), count)], (args, _) =>
            {
                lock (_received)
                {
                    _received.Add(new LiveMessage(name, [.. args.Cast<JsonElement>()], DateTimeOffset.UtcNow));
                }
                return Task.CompletedTask;
            }, this);
        }
    }

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public static async Task<LiveClient> ConnectAsync(TestApp app, string? token = null)
    {
        var url = new Uri(app.Server.BaseAddress, "hubs/live" + (token is null ? "" : $"?access_token={Uri.EscapeDataString(token)}"));
        var connection = new HubConnectionBuilder()
            .WithUrl(url, options =>
            {
                options.Transports = HttpTransportType.WebSockets;
                options.SkipNegotiation = true;
                options.WebSocketFactory = async (context, ct) =>
                    await app.Server.CreateWebSocketClient().ConnectAsync(context.Uri, ct);
            })
            .Build();
        var client = new LiveClient(connection);
        await connection.StartAsync(Ct);
        return client;
    }

    public Task InvokeAsync(string method, params object?[] args) => _connection.InvokeCoreAsync(method, args, Ct);

    /// <summary>Everything received so far with this name, oldest first.</summary>
    public IReadOnlyList<LiveMessage> Received(string name)
    {
        lock (_received)
        {
            return [.. _received.Where(m => m.Name == name)];
        }
    }

    /// <summary>The first message with this name that matches, waiting up to <paramref name="timeout"/> (10 s) for it.</summary>
    public async Task<LiveMessage> WaitForAsync(string name, Func<LiveMessage, bool>? where = null, TimeSpan? timeout = null)
    {
        var deadline = DateTime.UtcNow + (timeout ?? TimeSpan.FromSeconds(10));
        while (true)
        {
            if (Received(name).FirstOrDefault(m => where?.Invoke(m) ?? true) is { } message)
            {
                return message;
            }
            Assert.True(DateTime.UtcNow < deadline, $"No matching {name} within {(timeout ?? TimeSpan.FromSeconds(10)).TotalSeconds:0.#} s; got {Received(name).Count} others.");
            await Task.Delay(20, Ct);
        }
    }

    /// <summary>Waits until <paramref name="count"/> messages with this name have arrived.</summary>
    public async Task<IReadOnlyList<LiveMessage>> WaitForCountAsync(string name, int count, TimeSpan timeout)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (Received(name) is var received && received.Count < count)
        {
            Assert.True(DateTime.UtcNow < deadline, $"Only {received.Count} of {count} {name} within {timeout.TotalSeconds:0.#} s.");
            await Task.Delay(20, Ct);
        }
        return Received(name);
    }

    public async ValueTask DisposeAsync() => await _connection.DisposeAsync();
}

/// <summary>One message from the hub: its arguments as JSON, and when the client got it.</summary>
public sealed record LiveMessage(string Name, JsonElement[] Arguments, DateTimeOffset ReceivedAt)
{
    public T Payload<T>() => Arguments[0].Deserialize<T>(Http.Json) ?? throw new InvalidOperationException($"{Name} had no payload.");

    /// <summary>The server time on the message: the second argument, or the payload's <c>at</c>.</summary>
    public DateTimeOffset At => Arguments.Length > 1 ? Arguments[1].GetDateTimeOffset() : Arguments[0].GetProperty("at").GetDateTimeOffset();
}
