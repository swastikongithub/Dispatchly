using Dispatchly.Domain.Geo;
using Dispatchly.Domain.Orders;
using Dispatchly.Domain.Riders;

namespace Dispatchly.Application.Abstractions;

/// <summary>
/// What the city simulator (PLAN.md §3.7) needs to see. It reads through this port and acts only
/// through the same use cases as real riders and customers, never by writing tables.
/// </summary>
public interface ISimulationReader
{
    /// <summary>The restaurants and customers orders can come from.</summary>
    Task<SimulationCity> CityAsync(CancellationToken ct);

    /// <summary>Every rider with their active task, if any.</summary>
    Task<IReadOnlyList<SimulatedRider>> RidersAsync(CancellationToken ct);
}

public sealed record SimulationCity(IReadOnlyList<SimulatedRestaurant> Restaurants, IReadOnlyList<int> CustomerIds);

public sealed record SimulatedRestaurant(int Id, string Area, GeoPoint Location, IReadOnlyList<string> MenuItemIds);

public sealed record SimulatedRider(int Id, RiderStatus Status, GeoPoint Location, double Bearing, SimulatedTask? Task);

/// <summary>
/// A rider's active order. The simulator plays the customer at the door too, so it knows the
/// delivery code.
/// </summary>
public sealed record SimulatedTask(
    string Code,
    OrderStatus Status,
    GeoPoint Restaurant,
    GeoPoint Drop,
    IReadOnlyList<GeoPoint> Route,
    DateTimeOffset ReadyAt,
    string DeliveryCode);
