using System.ComponentModel.DataAnnotations;
using System.Text.Json.Serialization;
using Dispatchly.Application.Live;
using Dispatchly.Domain.Orders;
using Dispatchly.Domain.Riders;

namespace Dispatchly.Application;

// The REST contract (/api/v1). The TypeScript client and the mobile app are generated from these
// through OpenAPI, so change them only with approval (CLAUDE.md).

public enum Role
{
    Dispatcher,
    Customer,
    Rider,
}

/// <summary>Who is asking: the role, plus their customer or rider id.</summary>
public sealed record Viewer(Role Role, int? CustomerId = null, int? RiderId = null);

public sealed record Position(double Lat, double Lng);

// ---- Orders ---------------------------------------------------------------------------------

/// <summary>A row in the dispatcher's order queue.</summary>
public sealed record OrderSummary(
    string Code,
    OrderStatus Status,
    bool IsLate,
    int MinutesLate,
    string RestaurantName,
    string RestaurantArea,
    string DropArea,
    int? RiderId,
    string? RiderName,
    int SearchRadiusMeters,
    DateTimeOffset CreatedAt,
    DateTimeOffset PromisedBy,
    DateTimeOffset EstimatedDeliveryAt,
    /// <summary>For the dashboard map: the restaurant's pin, the drop and the route between them.</summary>
    int RestaurantId,
    Position RestaurantLocation,
    Position DropLocation,
    IReadOnlyList<Position> Route);

public sealed record OrderDetails(
    string Code,
    OrderStatus Status,
    bool IsLate,
    int MinutesLate,
    RestaurantStop Restaurant,
    DropStop Drop,
    RiderCard? Rider,
    IReadOnlyList<OrderLine> Items,
    int TotalPaise,
    PaymentMethod Payment,
    /// <summary>Only for the customer who placed the order.</summary>
    string? DeliveryCode,
    IReadOnlyList<Position> Route,
    double DistanceMeters,
    /// <summary>Straight-line distance the rider still has to cover, via the restaurant before pickup.</summary>
    double? RemainingMeters,
    int SearchRadiusMeters,
    DateTimeOffset CreatedAt,
    DateTimeOffset ReadyAt,
    DateTimeOffset PromisedBy,
    DateTimeOffset EstimatedDeliveryAt,
    DateTimeOffset? AssignedAt,
    DateTimeOffset? PickedUpAt,
    DateTimeOffset? DeliveredAt,
    IReadOnlyList<TimelineEntry> Timeline);

public sealed record RestaurantStop(int Id, string Name, string Area, string Address, string Phone, Position Location);

public sealed record DropStop(string? CustomerFirstName, string? Label, string Address, string Area, Position Location);

public sealed record RiderCard(
    int Id,
    string Name,
    string Vehicle,
    string Plate,
    /// <summary>Only for dispatchers ("Call rider").</summary>
    string? Phone,
    RiderStatus Status,
    Position Location,
    double Bearing);

/// <summary>A free rider an order could be reassigned to, nearest first (the Reassign popover).</summary>
public sealed record ReassignCandidate(int RiderId, string Name, string Vehicle, string Plate, double DistanceMeters);

public sealed record OrderLine(string MenuItemId, string Name, int Quantity, int UnitPricePaise);

public sealed record TimelineEntry(
    OrderEventType Type,
    DateTimeOffset At,
    int? RiderId,
    string? RiderName,
    int? FreeRiders,
    double? DistanceMeters,
    int? PreviousRiderId,
    string? PreviousRiderName);

public sealed record PlaceOrderRequest(
    [Range(1, int.MaxValue)] int RestaurantId,
    [Required, MinLength(1), MaxLength(Order.MaxLines)] IReadOnlyList<PlaceOrderLine> Items,
    [Required] DropRequest Drop,
    PaymentMethod Payment);

public sealed record PlaceOrderLine(
    [Required, StringLength(64, MinimumLength = 1)] string MenuItemId,
    [Range(1, Order.MaxQuantity)] int Quantity);

public sealed record DropRequest(
    [Range(-90, 90)] double Lat,
    [Range(-180, 180)] double Lng,
    [Required, StringLength(200, MinimumLength = 1)] string Address,
    [Required, StringLength(80, MinimumLength = 1)] string Area,
    [StringLength(40)] string? Label);

// ---- Restaurants ----------------------------------------------------------------------------

public sealed record NearbyRestaurant(
    int Id,
    string Name,
    string Area,
    string Address,
    Position Location,
    int PrepMinutes,
    double DistanceMeters,
    IReadOnlyList<MenuEntry> Menu);

public sealed record MenuEntry(string Id, string Name, int PricePaise);

/// <summary>A restaurant on the dashboard map.</summary>
public sealed record RestaurantPin(int Id, string Name, string Area, Position Location);

// ---- Rider app ------------------------------------------------------------------------------

/// <summary>Everything the rider app shows: the rider's day and their current task, if any.</summary>
public sealed record RiderTaskView(RiderSelf Rider, RiderTask? Task);

public sealed record RiderSelf(
    int Id,
    string Name,
    RiderStatus Status,
    DateTimeOffset? OnlineSince,
    int TripsToday,
    int EarnedTodayPaise,
    Position Location,
    double Bearing);

public sealed record RiderTask(
    string Code,
    OrderStatus Status,
    RestaurantStop Restaurant,
    DateTimeOffset ReadyAt,
    IReadOnlyList<OrderLine> Items,
    int TotalPaise,
    PaymentMethod Payment,
    DropStop Drop,
    /// <summary>Restaurant to drop, straight line.</summary>
    double DistanceMeters,
    /// <summary>Estimated ride from the restaurant to the drop ("≈ 14 min").</summary>
    int DropRideMinutes,
    int RiderPayPaise,
    IReadOnlyList<Position> Route);

public sealed record RiderStatusRequest(bool Online);

public sealed record DeliverRequest([Required, RegularExpression("^[0-9]{4}$")] string Code);

public sealed record DeliveryResult(string Code, int EarnedPaise, RiderSelf Rider);

public sealed record LocationUpdate(
    [Range(-90, 90)] double Lat,
    [Range(-180, 180)] double Lng,
    [Range(0, 360)] double? Bearing);

// ---- Stats ----------------------------------------------------------------------------------

/// <summary>
/// The dashboard's top-bar stats and the landing page's live numbers. Aggregates only, so the
/// public group gets them too.
/// </summary>
public sealed record LiveStats(
    int RidersOnline,
    int ActiveOrders,
    /// <summary>Average placed-to-delivered time over the last hour; null when nothing was delivered.</summary>
    int? AverageDeliveryMinutes,
    int RunningLate,
    int NeedsRider,
    /// <summary>Online and without a task ("84 free").</summary>
    int RidersFree,
    /// <summary>Online and on a task, from assignment to delivery ("58 on a delivery").</summary>
    int RidersOnDelivery,
    /// <summary>Delivered since midnight in Delhi.</summary>
    int DeliveredToday);

// ---- Live: the snapshots, and the SignalR messages (docs/realtime.md) ------------------------

/// <summary>
/// One rider on the map. Sent as the array <c>[id, lat, lng, bearing, status]</c> so a batch of
/// hundreds of riders stays small. Positions are rounded to 5 decimals (about 1 m).
/// </summary>
[JsonConverter(typeof(RiderPointJsonConverter))]
public readonly record struct RiderPoint(int Id, double Lat, double Lng, int Bearing, RiderStatus Status);

/// <summary><c>riders:batch</c>: every rider on shift, once per tick. A rider missing from it is offline.</summary>
public sealed record RidersBatch(DateTimeOffset At, IReadOnlyList<RiderPoint> Riders);

/// <summary><c>rider:position</c>: where the customer's rider is, once per tick.</summary>
public sealed record RiderPosition(
    DateTimeOffset At,
    string Code,
    int RiderId,
    Position Location,
    double Bearing,
    /// <summary>Straight-line distance the rider still has to cover, via the restaurant before pickup.</summary>
    double? RemainingMeters);

/// <summary><c>eta:changed</c>: the shown arrival time moved to another minute, or lateness changed.</summary>
public sealed record EtaChanged(
    DateTimeOffset At,
    string Code,
    DateTimeOffset EstimatedDeliveryAt,
    bool IsLate,
    int MinutesLate);

/// <summary>The dashboard's first paint: <c>GET /live/snapshot</c>.</summary>
public sealed record LiveSnapshot(
    DateTimeOffset At,
    IReadOnlyList<LiveRider> Riders,
    /// <summary>The order queue, in queue order.</summary>
    IReadOnlyList<OrderSummary> Orders,
    LiveStats Stats,
    /// <summary>Every restaurant, for the map.</summary>
    IReadOnlyList<RestaurantPin> Restaurants);

/// <summary>A rider on shift, as the dispatcher sees them.</summary>
public sealed record LiveRider(
    int Id,
    string Name,
    string Vehicle,
    string Plate,
    string Phone,
    RiderStatus Status,
    Position Location,
    double Bearing,
    /// <summary>Their active order, if any.</summary>
    string? OrderCode,
    DateTimeOffset? OnlineSince,
    /// <summary>Deliveries completed since midnight in Delhi.</summary>
    int DeliveriesToday);

/// <summary>The landing page's live city: <c>GET /live/public</c>. No names, no orders.</summary>
public sealed record PublicSnapshot(DateTimeOffset At, IReadOnlyList<RiderPoint> Riders, LiveStats Stats);
