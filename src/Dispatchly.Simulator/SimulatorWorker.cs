using Dispatchly.Application;
using Dispatchly.Application.Abstractions;
using Dispatchly.Application.Orders;
using Dispatchly.Application.Riders;
using Dispatchly.Domain;
using Dispatchly.Domain.Dispatch;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Dispatchly.Simulator;

/// <summary>
/// Keeps the demo city alive (PLAN.md §3.7): every tick it looks at the city, lets
/// <see cref="CitySimulation"/> decide what happens, and does it through the same use cases as the
/// rider app and the customer, each in a scope of its own. It never writes to the database itself.
/// </summary>
internal sealed class SimulatorWorker(
    IServiceScopeFactory scopes,
    SimulatorOptions options,
    DispatchPolicy policy,
    TimeProvider clock,
    ILogger<SimulatorWorker> logger) : BackgroundService
{
    /// <summary>Restaurants and customers rarely change; look again now and then.</summary>
    private static readonly TimeSpan CityRefresh = TimeSpan.FromMinutes(10);

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        CitySimulation? simulation = null;
        SimulationCity? city = null;
        var cityAt = DateTimeOffset.MinValue;
        DateTimeOffset? last = null;
        using var timer = new PeriodicTimer(options.TickInterval, clock);
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            try
            {
                var now = clock.GetUtcNow();
                // After a stall, carry on rather than jump.
                var elapsed = last is { } previous
                    ? TimeSpan.FromTicks(Math.Clamp((now - previous).Ticks, 0, options.TickInterval.Ticks * 3))
                    : options.TickInterval;
                last = now;

                IReadOnlyList<SimAction> actions;
                await using (var scope = scopes.CreateAsyncScope())
                {
                    var services = scope.ServiceProvider;
                    if (simulation is null)
                    {
                        var demoRider = await services.GetRequiredService<IDemoAccounts>().RiderAsync(stoppingToken);
                        simulation = new CitySimulation(options, policy.CityUtcOffset, demoRider?.Id);
                    }
                    var reader = services.GetRequiredService<ISimulationReader>();
                    if (city is null || now - cityAt > CityRefresh)
                    {
                        city = await reader.CityAsync(stoppingToken);
                        cityAt = now;
                    }
                    actions = simulation.Tick(city, await reader.RidersAsync(stoppingToken), now, elapsed);
                }
                await Parallel.ForEachAsync(
                    actions,
                    new ParallelOptions { MaxDegreeOfParallelism = options.Parallelism, CancellationToken = stoppingToken },
                    RunAsync);
            }
            catch (Exception e) when (e is not OperationCanceledException)
            {
                logger.LogError(e, "Simulator tick failed");
            }
        }
    }

    private async ValueTask RunAsync(SimAction action, CancellationToken ct)
    {
        try
        {
            await using var scope = scopes.CreateAsyncScope();
            var services = scope.ServiceProvider;
            switch (action)
            {
                case MoveRider move:
                    await services.GetRequiredService<RiderService>().UpdateLocationAsync(
                        move.RiderId, new LocationUpdate(move.To.Lat, move.To.Lng, move.Bearing), ct);
                    break;
                case SetOnline shift:
                    await services.GetRequiredService<RiderService>().SetOnlineAsync(shift.RiderId, shift.Online, ct);
                    break;
                case ConfirmPickup pickup:
                    await services.GetRequiredService<RiderService>().ConfirmPickupAsync(pickup.RiderId, ct);
                    break;
                case Deliver deliver:
                    await services.GetRequiredService<RiderService>().DeliverAsync(deliver.RiderId, deliver.Code, ct);
                    break;
                case PlaceOrder order:
                    var placed = await services.GetRequiredService<OrderService>().PlaceAsync(order.CustomerId, order.Request, ct);
                    logger.LogDebug("Simulated order {Code} from restaurant {RestaurantId}", placed.Code, placed.Restaurant.Id);
                    break;
            }
        }
        catch (Exception e) when (e is DomainException or ConflictException or NotFoundException or InvalidRequestException)
        {
            // The city moved on since this tick looked (a visitor picked up first, a rider was
            // reassigned…). Next tick decides again from what's there.
            logger.LogDebug("Simulator skipped {Action}: {Reason}", action, e.Message);
        }
        catch (Exception e) when (e is not OperationCanceledException)
        {
            // Lost a race on a row, or a hiccup: one action failing never stops the city.
            logger.LogWarning(e, "Simulator action {Action} failed", action);
        }
    }
}
