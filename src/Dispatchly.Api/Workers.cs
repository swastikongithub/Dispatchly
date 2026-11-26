using Dispatchly.Application.Live;
using Dispatchly.Application.Orders;
using Dispatchly.Domain.Dispatch;
using Dispatchly.Infrastructure;
using Microsoft.Extensions.Diagnostics.HealthChecks;

namespace Dispatchly.Api;

/// <summary>
/// Retries orders still searching for a rider every 5 s, widening the radius with their age
/// (PLAN.md §3.5 step 3). Safe with several API instances: each order is locked with SKIP LOCKED.
/// </summary>
internal sealed class AssignmentRetryWorker(
    IServiceScopeFactory scopes,
    DispatchPolicy policy,
    ILogger<AssignmentRetryWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(policy.RetryInterval);
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                var assigned = await scope.ServiceProvider.GetRequiredService<AssignmentService>().RetrySearchingAsync(stoppingToken);
                if (assigned > 0)
                {
                    logger.LogInformation("Assigned {Count} waiting orders on retry", assigned);
                }
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                // Keep retrying: one bad pass mustn't stop assignment for good.
                logger.LogError(e, "Assignment retry pass failed");
            }
        }
    }
}

/// <summary>The live tick (PLAN.md §3.6): rider positions, ETAs and stats every 2 s.</summary>
internal sealed class LiveBroadcastWorker(
    IServiceScopeFactory scopes,
    LiveOptions options,
    ILogger<LiveBroadcastWorker> logger) : BackgroundService
{
    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(options.BatchInterval);
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                await scope.ServiceProvider.GetRequiredService<LiveBroadcaster>().TickAsync(stoppingToken);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                // A missed tick is caught up by the next one.
                logger.LogError(e, "Live tick failed");
            }
        }
    }
}

/// <summary>Live settings ("Live").</summary>
public sealed class LiveOptions
{
    public const string Section = "Live";

    /// <summary>How often <c>riders:batch</c> and the other per-tick messages go out.</summary>
    public TimeSpan BatchInterval { get; init; } = TimeSpan.FromSeconds(2);
}

internal sealed class DatabaseHealthCheck(IServiceScopeFactory scopes) : IHealthCheck
{
    public async Task<HealthCheckResult> CheckHealthAsync(HealthCheckContext context, CancellationToken ct = default)
    {
        await using var scope = scopes.CreateAsyncScope();
        return await InfrastructureServices.CanConnectAsync(scope.ServiceProvider, ct)
            ? HealthCheckResult.Healthy()
            : HealthCheckResult.Unhealthy("Can't reach the database.");
    }
}
