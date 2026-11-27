using Dispatchly.Domain.Customers;
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

    /// <summary>The customer with their saved addresses.</summary>
    Task<Customer?> CustomerAsync(int id, CancellationToken ct);

    /// <summary>The rider's active order with its restaurant and customer, if any.</summary>
    Task<Order?> RiderTaskAsync(int riderId, CancellationToken ct);

    /// <summary>Deliveries completed by the rider since <paramref name="since"/>, and what they earned.</summary>
    Task<(int Trips, int EarnedPaise)> RiderEarningsAsync(int riderId, DateTimeOffset since, CancellationToken ct);

    /// <summary>Every rider who isn't offline.</summary>
    Task<IReadOnlyList<Rider>> OnShiftRidersAsync(CancellationToken ct);

    /// <summary>Deliveries completed since <paramref name="since"/>, by rider. Riders with none are left out.</summary>
    Task<IReadOnlyDictionary<int, int>> DeliveriesByRiderAsync(DateTimeOffset since, CancellationToken ct);

    Task<IReadOnlyList<Restaurant>> RestaurantsAsync(CancellationToken ct);

    /// <summary>
    /// The nearest Available riders within <paramref name="radiusMeters"/> of a point, nearest first,
    /// without locking them: what an assignment would choose from right now.
    /// </summary>
    Task<IReadOnlyList<(Rider Rider, double DistanceMeters)>> NearestAvailableRidersAsync(
        GeoPoint near, int radiusMeters, int? excludingRiderId, int take, CancellationToken ct);

    /// <summary>The counts behind the live stats: the average over orders delivered since <paramref name="averageSince"/>.</summary>
    Task<LiveCounts> LiveCountsAsync(DateTimeOffset averageSince, DateTimeOffset startOfDay, CancellationToken ct);
}

public sealed record LiveCounts(
    int RidersOnline,
    int RidersFree,
    int RidersOnDelivery,
    int ActiveOrders,
    int NeedsRider,
    int RunningLate,
    double? AverageDeliveryMinutes,
    int DeliveredToday);
