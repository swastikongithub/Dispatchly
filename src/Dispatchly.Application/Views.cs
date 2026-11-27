using Dispatchly.Domain.Dispatch;
using Dispatchly.Domain.Geo;
using Dispatchly.Domain.Orders;
using Dispatchly.Domain.Restaurants;
using Dispatchly.Domain.Riders;

namespace Dispatchly.Application;

/// <summary>Maps loaded entities to the contract records.</summary>
internal static class Views
{
    public static Position ToPosition(this GeoPoint point) => new(point.Lat, point.Lng);

    public static OrderSummary ToSummary(this Order order) => new(
        order.Code,
        order.Status,
        order.IsLate,
        order.MinutesLate,
        order.Restaurant.Name,
        order.Restaurant.Area,
        order.DropArea,
        order.RiderId,
        order.Rider?.Name,
        order.SearchRadiusMeters,
        order.CreatedAt,
        order.PromisedBy,
        order.EstimatedDeliveryAt,
        order.RestaurantId,
        order.Restaurant.Location.ToPosition(),
        order.DropLocation.ToPosition(),
        [.. order.Route.Select(ToPosition)]);

    public static OrderDetails ToDetails(this Order order, Viewer viewer)
    {
        var isOwner = viewer.Role == Role.Customer && viewer.CustomerId == order.CustomerId;
        return new OrderDetails(
            order.Code,
            order.Status,
            order.IsLate,
            order.MinutesLate,
            order.Restaurant.ToStop(),
            order.ToDrop(),
            order.Rider?.ToCard(includePhone: viewer.Role == Role.Dispatcher),
            order.Items.ToLines(),
            order.TotalPaise,
            order.Payment,
            isOwner ? order.DeliveryCode : null,
            [.. order.Route.Select(ToPosition)],
            Math.Round(order.DistanceMeters),
            order.RemainingMeters(),
            order.SearchRadiusMeters,
            order.CreatedAt,
            order.ReadyAt,
            order.PromisedBy,
            order.EstimatedDeliveryAt,
            order.AssignedAt,
            order.PickedUpAt,
            order.DeliveredAt,
            [.. order.Events.OrderBy(e => e.At).ThenBy(e => e.Id).Select(ToTimeline)]);
    }

    public static RiderTask ToTask(this Order order, DispatchPolicy policy) => new(
        order.Code,
        order.Status,
        order.Restaurant.ToStop(),
        order.ReadyAt,
        order.Items.ToLines(),
        order.TotalPaise,
        order.Payment,
        order.ToDrop(),
        Math.Round(order.DistanceMeters),
        (int)Math.Ceiling(policy.Travel(order.DistanceMeters).TotalMinutes),
        order.RiderPayPaise,
        [.. order.Route.Select(ToPosition)]);

    public static RiderSelf ToSelf(this Rider rider, int tripsToday, int earnedTodayPaise) => new(
        rider.Id,
        rider.Name,
        rider.Status,
        rider.OnlineSince,
        tripsToday,
        earnedTodayPaise,
        rider.Location.ToPosition(),
        rider.Bearing);

    public static LiveRider ToLive(this Rider rider, string? orderCode, int deliveriesToday) => new(
        rider.Id,
        rider.Name,
        rider.Vehicle,
        rider.Plate,
        rider.Phone,
        rider.Status,
        rider.Location.ToPosition(),
        rider.Bearing,
        orderCode,
        rider.OnlineSince,
        deliveriesToday);

    public static RestaurantPin ToPin(this Restaurant restaurant) =>
        new(restaurant.Id, restaurant.Name, restaurant.Area, restaurant.Location.ToPosition());

    public static ReassignCandidate ToCandidate(this Rider rider, double distanceMeters) =>
        new(rider.Id, rider.Name, rider.Vehicle, rider.Plate, Math.Round(distanceMeters));

    public static RiderPoint ToPoint(this Rider rider) => new(
        rider.Id,
        Math.Round(rider.Location.Lat, 5),
        Math.Round(rider.Location.Lng, 5),
        (int)Math.Round(rider.Bearing) % 360,
        rider.Status);

    public static NearbyRestaurant ToNearby(this Restaurant restaurant, double distanceMeters) => new(
        restaurant.Id,
        restaurant.Name,
        restaurant.Area,
        restaurant.Address,
        restaurant.Location.ToPosition(),
        restaurant.PrepMinutes,
        Math.Round(distanceMeters),
        [.. restaurant.Menu.Select(m => new MenuEntry(m.Id, m.Name, m.PricePaise))]);

    private static RestaurantStop ToStop(this Restaurant restaurant) => new(
        restaurant.Id, restaurant.Name, restaurant.Area, restaurant.Address, restaurant.Phone, restaurant.Location.ToPosition());

    private static DropStop ToDrop(this Order order) => new(
        order.Customer?.Name.Split(' ', 2)[0], order.DropLabel, order.DropAddress, order.DropArea, order.DropLocation.ToPosition());

    private static RiderCard ToCard(this Rider rider, bool includePhone) => new(
        rider.Id,
        rider.Name,
        rider.Vehicle,
        rider.Plate,
        includePhone ? rider.Phone : null,
        rider.Status,
        rider.Location.ToPosition(),
        rider.Bearing);

    private static OrderLine[] ToLines(this IReadOnlyList<OrderItem> items) =>
        [.. items.Select(i => new OrderLine(i.MenuItemId, i.Name, i.Quantity, i.UnitPricePaise))];

    private static TimelineEntry ToTimeline(OrderEvent e) => new(
        e.Type,
        e.At,
        e.Data.RiderId,
        e.Data.RiderName,
        e.Data.FreeRiders,
        e.Data.DistanceMeters,
        e.Data.PreviousRiderId,
        e.Data.PreviousRiderName);

    public static double? RemainingMeters(this Order order)
    {
        if (!order.IsActive || order.Rider is not { } rider)
        {
            return null;
        }
        var meters = order.Status == OrderStatus.Assigned
            ? rider.Location.DistanceTo(order.Restaurant.Location) + order.DistanceMeters
            : rider.Location.DistanceTo(order.DropLocation);
        return Math.Round(meters);
    }
}
