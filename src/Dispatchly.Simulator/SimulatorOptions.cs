namespace Dispatchly.Simulator;

/// <summary>The city simulator's settings ("Simulator"), PLAN.md §3.7.</summary>
public sealed class SimulatorOptions
{
    public const string Section = "Simulator";

    /// <summary>Run the simulator. Turn it on for one API instance only: each would add its own orders.</summary>
    public bool Enabled { get; init; } = true;

    public TimeSpan TickInterval { get; init; } = TimeSpan.FromSeconds(2);

    /// <summary>
    /// For demos: riders move this many times faster, and the simulator's own waits (kitchen delays,
    /// handovers, breaks, shifts) are this many times shorter. Kitchens still take their prep time.
    /// </summary>
    public double SpeedMultiplier { get; init; } = 1;

    /// <summary>New orders per minute across the city, before the time-of-day curve (busier at lunch and dinner).</summary>
    public double OrdersPerMinute { get; init; } = 1.5;

    /// <summary>The same seed gives the same riders' speeds, delays and orders, so demos repeat.</summary>
    public int RandomSeed { get; init; } = 4817;

    /// <summary>
    /// How long the demo rider waits at the restaurant (once the food is ready) and at the door for
    /// the visitor to slide, before confirming by themself. Not shortened by <see cref="SpeedMultiplier"/>.
    /// </summary>
    public TimeSpan DemoRiderPatience { get; init; } = TimeSpan.FromMinutes(2);

    /// <summary>How many rider and order actions run at once.</summary>
    public int Parallelism { get; init; } = 8;
}
