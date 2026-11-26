namespace Dispatchly.Domain.Orders;

public enum OrderEventType
{
    Placed,
    Assigned,
    Reassigned,
    ArrivedAtRestaurant,
    PickedUp,
    OnTheWay,
    Delivered,
}

/// <summary>One step in an order's life. Drives the timelines in the UI.</summary>
public sealed class OrderEvent
{
    internal OrderEvent(OrderEventType type, DateTimeOffset at, OrderEventData data)
    {
        Type = type;
        At = at;
        Data = data;
    }

    private OrderEvent()
    {
    }

    public int Id { get; private set; }
    public int OrderId { get; private set; }
    public OrderEventType Type { get; private set; }
    public DateTimeOffset At { get; private set; }
    public OrderEventData Data { get; private set; } = new();
}

/// <summary>
/// The facts behind an event, e.g. "Nearest of 4 free riders, 0.6 km away" is
/// FreeRiders = 4 and DistanceMeters = 600. Clients write the sentence.
/// </summary>
public sealed class OrderEventData
{
    public int? RiderId { get; init; }
    public string? RiderName { get; init; }
    public int? FreeRiders { get; init; }
    public double? DistanceMeters { get; init; }
    public int? PreviousRiderId { get; init; }
    public string? PreviousRiderName { get; init; }
}
