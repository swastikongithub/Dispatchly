using Dispatchly.Domain.Geo;
using Dispatchly.Domain.Orders;
using Dispatchly.Domain.Restaurants;
using Dispatchly.Domain.Riders;

namespace Dispatchly.Application.Abstractions;

/// <summary>Read side: untracked entities for the API's views.</summary>
public interface IDispatchReader
{
    /// <summary>Active orders with their restaurant and rider, optionally filtered.</summary>
    Task<IReadOnlyList<Order>> ActiveOrdersAsync(OrderStatus? status, bool? late, CancellationToken ct);

    /// <summary>One order with its restaurant, customer, rider and events.</summary>
    Task<Order?> OrderAsync(string code, CancellationToken ct);

    Task<IReadOnlyList<(Restaurant Restaurant, double DistanceMeters)>> RestaurantsNearAsync(
        GeoPoint near, int take, CancellationToken ct);

    Task<Rider?> RiderAsync(int id, CancellationToken ct);

    /// <summary>The rider's active order with its restaurant and customer, if any.</summary>
    Task<Order?> RiderTaskAsync(int riderId, CancellationToken ct);

    /// <summary>Deliveries completed by the rider since <paramref name="since"/>, and what they earned.</summary>
    Task<(int Trips, int EarnedPaise)> RiderEarningsAsync(int riderId, DateTimeOffset since, CancellationToken ct);

    Task<LiveCounts> LiveCountsAsync(DateTimeOffset deliveredSince, CancellationToken ct);
}

public sealed record LiveCounts(
    int RidersOnline,
    int ActiveOrders,
    int NeedsRider,
    int RunningLate,
    double? AverageDeliveryMinutes);
