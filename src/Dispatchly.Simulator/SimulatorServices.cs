using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.DependencyInjection;

namespace Dispatchly.Simulator;

public static class SimulatorServices
{
    /// <summary>
    /// Runs the city simulator in this process when <c>Simulator:Enabled</c> is on (the default).
    /// It needs the Application use cases and an <c>ISimulationReader</c> registered too.
    /// </summary>
    public static IServiceCollection AddCitySimulator(this IServiceCollection services, IConfiguration section)
    {
        var options = section.Get<SimulatorOptions>() ?? new SimulatorOptions();
        if (!options.Enabled)
        {
            return services;
        }
        if (options.TickInterval <= TimeSpan.Zero || options.SpeedMultiplier <= 0 || options.OrdersPerMinute < 0 || options.Parallelism < 1)
        {
            throw new InvalidOperationException(
                "Simulator settings need TickInterval > 0, SpeedMultiplier > 0, OrdersPerMinute >= 0 and Parallelism >= 1.");
        }
        services.AddSingleton(options);
        services.AddHostedService<SimulatorWorker>();
        return services;
    }
}
