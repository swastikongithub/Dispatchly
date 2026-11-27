using Dispatchly.Application.Abstractions;
using Dispatchly.Domain.Dispatch;
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

public sealed class CustomerQueries(IDispatchReader reader)
{
    /// <summary>The customer's saved addresses, in the order they were saved.</summary>
    public async Task<IReadOnlyList<CustomerAddress>> AddressesAsync(int customerId, CancellationToken ct)
    {
        var customer = await reader.CustomerAsync(customerId, ct)
            ?? throw new NotFoundException($"Customer {customerId} not found.");
        return [.. customer.SavedAddresses.Select(a => new CustomerAddress(a.Label, a.Address, a.Area, new Position(a.Lat, a.Lng)))];
    }
}

public sealed class StatsQueries(IDispatchReader reader, DispatchPolicy policy, TimeProvider clock)
{
    /// <summary>The window for "Avg. delivery".</summary>
    public static readonly TimeSpan AverageWindow = TimeSpan.FromHours(1);

    public async Task<LiveStats> LiveAsync(CancellationToken ct)
    {
        var now = clock.GetUtcNow();
        var counts = await reader.LiveCountsAsync(now - AverageWindow, policy.StartOfCityDay(now), ct);
        return new LiveStats(
            counts.RidersOnline,
            counts.ActiveOrders,
            counts.AverageDeliveryMinutes is { } minutes ? (int)Math.Round(minutes) : null,
            counts.RunningLate,
            counts.NeedsRider,
            counts.RidersFree,
            counts.RidersOnDelivery,
            counts.DeliveredToday);
    }
}
