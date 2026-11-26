namespace Dispatchly.Domain.Dispatch;

/// <summary>
/// The tunable numbers behind assignment, promises, ETAs and rider pay (PLAN.md §3.5, §3.8).
/// Defaults are the production values; the Api binds overrides from configuration ("Dispatch").
/// </summary>
public sealed record DispatchPolicy
{
    /// <summary>Search radii in metres, widened on each retry and then held at the last one (§3.5).</summary>
    public IReadOnlyList<int> SearchRadiiMeters { get; init; } = [1_500, 3_000, 5_000];

    /// <summary>How often orders still searching are retried (§3.5).</summary>
    public TimeSpan RetryInterval { get; init; } = TimeSpan.FromSeconds(5);

    /// <summary>
    /// Average rider speed over straight-line distance, for ETAs until routes come from OSRM (§3.8).
    /// 18 km/h straight-line is about 22 km/h along real roads, inside the simulator's 18–28 km/h.
    /// </summary>
    public double AverageSpeedKmh { get; init; } = 18;

    /// <summary>Added to prep and travel time when promising a delivery time to the customer.</summary>
    public TimeSpan PromiseBuffer { get; init; } = TimeSpan.FromMinutes(10);

    /// <summary>A rider this close to the restaurant has arrived; farther than this after pickup, they're on the way.</summary>
    public double ArrivalRadiusMeters { get; init; } = 50;

    /// <summary>Rider pay per delivery: a base fee plus a rate per straight-line km, rounded to whole rupees.</summary>
    public int RiderPayBasePaise { get; init; } = 3_000;

    public int RiderPayPerKmPaise { get; init; } = 600;

    /// <summary>ETA smoothing (§3.8): the shown ETA moves at most this much per update…</summary>
    public TimeSpan EtaMaxStep { get; init; } = TimeSpan.FromMinutes(1);

    /// <summary>…unless the new estimate differs by more than this, when it jumps straight there.</summary>
    public TimeSpan EtaJumpThreshold { get; init; } = TimeSpan.FromMinutes(3);

    public TimeSpan Travel(double meters) => TimeSpan.FromHours(meters / 1_000 / AverageSpeedKmh);

    /// <summary>The radius searched when an order is placed.</summary>
    public int FirstRadius => SearchRadiiMeters[0];

    /// <summary>The widest radius, used by reassignment.</summary>
    public int MaxRadius => SearchRadiiMeters[^1];

    /// <summary>The next wider radius after <paramref name="current"/>, or the widest one.</summary>
    public int NextRadius(int current) => SearchRadiiMeters.FirstOrDefault(r => r > current, MaxRadius);

    public int RiderPayPaise(double distanceMeters)
    {
        var paise = RiderPayBasePaise + RiderPayPerKmPaise * distanceMeters / 1_000;
        return (int)Math.Round(paise / 100, MidpointRounding.AwayFromZero) * 100;
    }

    /// <summary>
    /// ETA smoothing: move the shown ETA towards <paramref name="estimate"/> by at most
    /// <see cref="EtaMaxStep"/>, unless they're more than <see cref="EtaJumpThreshold"/> apart.
    /// </summary>
    public DateTimeOffset SmoothEta(DateTimeOffset? shown, DateTimeOffset estimate)
    {
        if (shown is not { } current)
        {
            return estimate;
        }
        var difference = estimate - current;
        if (difference.Duration() > EtaJumpThreshold)
        {
            return estimate;
        }
        var step = TimeSpan.FromTicks(Math.Clamp(difference.Ticks, -EtaMaxStep.Ticks, EtaMaxStep.Ticks));
        return current + step;
    }
}
