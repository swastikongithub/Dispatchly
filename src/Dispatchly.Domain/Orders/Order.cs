using System.Security.Cryptography;
using System.Text;
using Dispatchly.Domain.Customers;
using Dispatchly.Domain.Dispatch;
using Dispatchly.Domain.Geo;
using Dispatchly.Domain.Restaurants;
using Dispatchly.Domain.Riders;

namespace Dispatchly.Domain.Orders;

public enum OrderStatus
{
    Searching,
    Assigned,
    PickedUp,
    InTransit,
    Delivered,
    Cancelled,
}

public enum PaymentMethod
{
    Online,
    Cash,
}

/// <summary>Where the order goes. <see cref="Label"/> is a saved-address name such as "Home".</summary>
public sealed record OrderDrop(GeoPoint Location, string Address, string Area, string? Label);

/// <summary>
/// An order and its lifecycle (PLAN.md §3.3, §3.5). Every change that also changes the rider goes
/// through here, so an order and its rider can't disagree. Each step is recorded as an
/// <see cref="OrderEvent"/> for the timelines.
/// </summary>
public sealed class Order
{
    public const int MaxLines = 20;
    public const int MaxQuantity = 20;

    private readonly List<OrderItem> _items = [];
    private readonly List<OrderEvent> _events = [];
    private IReadOnlyList<GeoPoint> _route = [];

    private Order()
    {
    }

    public int Id { get; private set; }

    /// <summary>"DL-4817". The order's public identifier.</summary>
    public string Code { get; private set; } = "";

    public int RestaurantId { get; private set; }
    public Restaurant Restaurant { get; private set; } = null!;
    public int CustomerId { get; private set; }
    public Customer Customer { get; private set; } = null!;
    public int? RiderId { get; private set; }
    public Rider? Rider { get; private set; }
    public OrderStatus Status { get; private set; }

    public GeoPoint DropLocation { get; private set; }
    public string DropAddress { get; private set; } = "";
    public string DropArea { get; private set; } = "";
    public string? DropLabel { get; private set; }

    public IReadOnlyList<OrderItem> Items => _items;
    public int TotalPaise { get; private set; }
    public PaymentMethod Payment { get; private set; }

    /// <summary>The 4-digit code the customer gives the rider at the door.</summary>
    public string DeliveryCode { get; private set; } = "";

    /// <summary>What the rider earns for this delivery.</summary>
    public int RiderPayPaise { get; private set; }

    /// <summary>Restaurant → drop. A straight line until routes come from OSRM (W9).</summary>
    public IReadOnlyList<GeoPoint> Route => _route;

    public double DistanceMeters { get; private set; }

    /// <summary>The radius the assignment search is currently using (§3.5).</summary>
    public int SearchRadiusMeters { get; private set; }

    public DateTimeOffset CreatedAt { get; private set; }

    /// <summary>When the food should be ready: created + the restaurant's prep time.</summary>
    public DateTimeOffset ReadyAt { get; private set; }

    public DateTimeOffset PromisedBy { get; private set; }

    /// <summary>The smoothed ETA shown to everyone (§3.8).</summary>
    public DateTimeOffset EstimatedDeliveryAt { get; private set; }

    public DateTimeOffset? AssignedAt { get; private set; }
    public DateTimeOffset? PickedUpAt { get; private set; }
    public DateTimeOffset? DeliveredAt { get; private set; }

    public IReadOnlyList<OrderEvent> Events => _events;

    public bool IsActive => Status is not (OrderStatus.Delivered or OrderStatus.Cancelled);

    /// <summary>"Running late" is derived, not stored: the current ETA is after the promise.</summary>
    public bool IsLate => IsActive && EstimatedDeliveryAt > PromisedBy;

    public int MinutesLate => IsLate ? (int)Math.Ceiling((EstimatedDeliveryAt - PromisedBy).TotalMinutes) : 0;

    public static Order Place(
        int number,
        Restaurant restaurant,
        Customer customer,
        IReadOnlyList<OrderItem> items,
        OrderDrop drop,
        PaymentMethod payment,
        string deliveryCode,
        DispatchPolicy policy,
        DateTimeOffset now)
    {
        if (items.Count is 0 or > MaxLines)
        {
            throw new DomainException("invalid_items", $"An order needs 1 to {MaxLines} lines.");
        }
        if (items.Any(i => i.Quantity is < 1 or > MaxQuantity))
        {
            throw new DomainException("invalid_items", $"Each quantity must be 1 to {MaxQuantity}.");
        }
        if (deliveryCode.Length != 4 || !deliveryCode.All(char.IsAsciiDigit))
        {
            throw new ArgumentException("A delivery code is 4 digits.", nameof(deliveryCode));
        }

        var distance = restaurant.Location.DistanceTo(drop.Location);
        if (distance > policy.MaxDeliveryMeters)
        {
            throw new DomainException("drop_too_far", $"The drop is {distance / 1_000:F1} km from the restaurant; the limit is {policy.MaxDeliveryMeters / 1_000:F1} km.");
        }
        var order = new Order
        {
            Code = OrderCode.Format(number),
            Restaurant = restaurant,
            RestaurantId = restaurant.Id,
            Customer = customer,
            CustomerId = customer.Id,
            Status = OrderStatus.Searching,
            DropLocation = drop.Location,
            DropAddress = drop.Address,
            DropArea = drop.Area,
            DropLabel = drop.Label,
            TotalPaise = items.Sum(i => i.LinePaise),
            Payment = payment,
            DeliveryCode = deliveryCode,
            RiderPayPaise = policy.RiderPayPaise(distance),
            _route = [restaurant.Location, drop.Location],
            DistanceMeters = distance,
            SearchRadiusMeters = policy.FirstRadius,
            CreatedAt = now,
            ReadyAt = now.AddMinutes(restaurant.PrepMinutes),
        };
        order._items.AddRange(items);
        order.PromisedBy = order.ReadyAt + policy.Travel(distance) + policy.PromiseBuffer;
        order.EstimatedDeliveryAt = order.ReadyAt + policy.Travel(distance);
        order.Record(OrderEventType.Placed, now, new OrderEventData());
        return order;
    }

    /// <summary>Widens the search with the order's age (1.5 → 3 → 5 km, §3.5). Never narrows it.</summary>
    public void WidenSearch(DispatchPolicy policy, DateTimeOffset now)
    {
        Require(OrderStatus.Searching);
        SearchRadiusMeters = Math.Max(SearchRadiusMeters, policy.RadiusForAge(now - CreatedAt));
    }

    public void Assign(Rider rider, int freeRiders, double distanceMeters, DispatchPolicy policy, DateTimeOffset now)
    {
        Require(OrderStatus.Searching);
        rider.Assign();
        Rider = rider;
        RiderId = rider.Id;
        AssignedAt = now;
        Status = OrderStatus.Assigned;
        Record(OrderEventType.Assigned, now, new OrderEventData
        {
            RiderId = rider.Id,
            RiderName = rider.Name,
            FreeRiders = freeRiders,
            DistanceMeters = Math.Round(distanceMeters),
        });
        RefreshEta(policy, now);
    }

    /// <summary>Hands the order to <paramref name="next"/> before pickup; the current rider is free again.</summary>
    public void Reassign(Rider next, int freeRiders, double distanceMeters, DispatchPolicy policy, DateTimeOffset now)
    {
        Require(OrderStatus.Assigned);
        var previous = Rider ?? throw new InvalidOperationException($"Order {Code} is Assigned without its rider loaded.");
        if (ReferenceEquals(next, previous) || (next.Id != 0 && next.Id == previous.Id))
        {
            throw new DomainException("same_rider", $"Order {Code} is already with rider {next.Id}.");
        }
        previous.Release();
        next.Assign();
        Rider = next;
        RiderId = next.Id;
        AssignedAt = now;
        Record(OrderEventType.Reassigned, now, new OrderEventData
        {
            RiderId = next.Id,
            RiderName = next.Name,
            FreeRiders = freeRiders,
            DistanceMeters = Math.Round(distanceMeters),
            PreviousRiderId = previous.Id,
            PreviousRiderName = previous.Name,
        });
        RefreshEta(policy, now);
    }

    /// <summary>
    /// The rider moved (they've already been moved): note arrival at the restaurant and leaving it
    /// with the food, and refresh the ETA.
    /// </summary>
    public void RiderMoved(DispatchPolicy policy, DateTimeOffset now)
    {
        var rider = RequireRider();
        var fromRestaurant = rider.Location.DistanceTo(Restaurant.Location);
        if (Status == OrderStatus.Assigned && rider.Status == RiderStatus.Assigned && fromRestaurant <= policy.ArrivalRadiusMeters)
        {
            rider.ArriveAtRestaurant();
            Record(OrderEventType.ArrivedAtRestaurant, now, RiderData(rider));
        }
        else if (Status == OrderStatus.PickedUp && fromRestaurant > policy.ArrivalRadiusMeters)
        {
            Status = OrderStatus.InTransit;
            Record(OrderEventType.OnTheWay, now, RiderData(rider));
        }
        RefreshEta(policy, now);
    }

    public void ConfirmPickup(DispatchPolicy policy, DateTimeOffset now)
    {
        Require(OrderStatus.Assigned);
        var rider = RequireRider();
        rider.PickUp();
        Status = OrderStatus.PickedUp;
        PickedUpAt = now;
        Record(OrderEventType.PickedUp, now, RiderData(rider));
        RefreshEta(policy, now);
    }

    public void Deliver(string code, DateTimeOffset now)
    {
        if (Status is not (OrderStatus.PickedUp or OrderStatus.InTransit))
        {
            throw new DomainException("order_not_picked_up", $"Order {Code} is {Status}; it can only be delivered after pickup.");
        }
        if (!CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(code), Encoding.ASCII.GetBytes(DeliveryCode)))
        {
            throw new DomainException("wrong_delivery_code", "That delivery code doesn't match.");
        }
        var rider = RequireRider();
        rider.CompleteDelivery();
        Status = OrderStatus.Delivered;
        DeliveredAt = now;
        Record(OrderEventType.Delivered, now, RiderData(rider));
    }

    /// <summary>
    /// Re-estimates the delivery time from where things are now (§3.8) and moves the shown ETA
    /// towards it, smoothed. Straight-line distances until OSRM (W9).
    /// </summary>
    public void RefreshEta(DispatchPolicy policy, DateTimeOffset now)
    {
        if (!IsActive)
        {
            return;
        }
        var toDrop = policy.Travel(DistanceMeters);
        var estimate = Status switch
        {
            // Nobody yet: at best the food is ready on time and goes straight out.
            OrderStatus.Searching => Max(ReadyAt, now) + toDrop,
            OrderStatus.Assigned => Max(ReadyAt, now + policy.Travel(RequireRider().Location.DistanceTo(Restaurant.Location))) + toDrop,
            _ => now + policy.Travel(RequireRider().Location.DistanceTo(DropLocation)),
        };
        EstimatedDeliveryAt = policy.SmoothEta(EstimatedDeliveryAt, estimate);
    }

    private static DateTimeOffset Max(DateTimeOffset a, DateTimeOffset b) => a > b ? a : b;

    private static OrderEventData RiderData(Rider rider) => new() { RiderId = rider.Id, RiderName = rider.Name };

    private void Record(OrderEventType type, DateTimeOffset at, OrderEventData data) =>
        _events.Add(new OrderEvent(type, at, data));

    private void Require(OrderStatus status)
    {
        if (Status != status)
        {
            throw new DomainException("order_wrong_status", $"Order {Code} is {Status}, not {status}.");
        }
    }

    private Rider RequireRider() =>
        Rider ?? throw new InvalidOperationException($"Order {Code} has no rider loaded.");
}

public sealed class OrderItem
{
    public required string MenuItemId { get; init; }
    public required string Name { get; init; }
    public required int Quantity { get; init; }
    public required int UnitPricePaise { get; init; }

    public int LinePaise => Quantity * UnitPricePaise;

    public static OrderItem From(MenuItem item, int quantity) => new()
    {
        MenuItemId = item.Id,
        Name = item.Name,
        Quantity = quantity,
        UnitPricePaise = item.PricePaise,
    };
}

/// <summary>Order codes: "DL-" and a number from a database sequence.</summary>
public static class OrderCode
{
    public const string Prefix = "DL-";

    public static string Format(int number) => FormattableString.Invariant($"{Prefix}{number}");

    public static bool IsValid(string code) =>
        code.StartsWith(Prefix, StringComparison.Ordinal)
        && code.Length > Prefix.Length
        && code.Length <= Prefix.Length + 9
        && code[Prefix.Length..].All(char.IsAsciiDigit);
}
