using Dispatchly.Application.Abstractions;
using Dispatchly.Domain.Geo;

namespace Dispatchly.Application;

public sealed class RestaurantQueries(IDispatchReader reader)
{
    public const int NearbyLimit = 20;

    /// <summary>The nearest restaurants to a point, closest first.</summary>
    public async Task<IReadOnlyList<NearbyRestaurant>> NearAsync(GeoPoint near, CancellationToken ct)
    {
        var restaurants = await reader.RestaurantsNearAsync(near, NearbyLimit, ct);
        return [.. restaurants.Select(r => r.Restaurant.ToNearby(r.DistanceMeters))];
    }
}

public sealed class StatsQueries(IDispatchReader reader, TimeProvider clock)
{
    /// <summary>The window for "Avg. delivery".</summary>
    public static readonly TimeSpan AverageWindow = TimeSpan.FromHours(1);

    public async Task<LiveStats> LiveAsync(CancellationToken ct)
    {
        var counts = await reader.LiveCountsAsync(clock.GetUtcNow() - AverageWindow, ct);
        return new LiveStats(
            counts.RidersOnline,
            counts.ActiveOrders,
            counts.AverageDeliveryMinutes is { } minutes ? (int)Math.Round(minutes) : null,
            counts.RunningLate,
            counts.NeedsRider);
    }
}
