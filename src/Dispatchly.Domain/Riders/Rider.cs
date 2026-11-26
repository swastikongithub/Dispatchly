using Dispatchly.Domain.Geo;

namespace Dispatchly.Domain.Riders;

public enum RiderStatus
{
    Offline,
    Available,
    Assigned,
    AtRestaurant,
    Delivering,
}

public sealed class Rider
{
    public Rider(string name, string phone, string vehicle, string plate, GeoPoint location, DateTimeOffset now)
    {
        Name = name;
        Phone = phone;
        Vehicle = vehicle;
        Plate = plate;
        Location = location;
        LastSeenAt = now;
        Status = RiderStatus.Offline;
    }

    private Rider()
    {
    }

    public int Id { get; private set; }
    public string Name { get; private set; } = "";
    public string Phone { get; private set; } = "";
    public string Vehicle { get; private set; } = "";
    public string Plate { get; private set; } = "";
    public RiderStatus Status { get; private set; }
    public GeoPoint Location { get; private set; }

    /// <summary>Heading in degrees clockwise from north.</summary>
    public double Bearing { get; private set; }

    public DateTimeOffset LastSeenAt { get; private set; }
    public DateTimeOffset? OnlineSince { get; private set; }

    public string FirstName => Name.Split(' ', 2)[0];

    /// <summary>On a task: from assignment until the order is delivered.</summary>
    public bool IsBusy => Status is RiderStatus.Assigned or RiderStatus.AtRestaurant or RiderStatus.Delivering;

    public void GoOnline(DateTimeOffset now)
    {
        if (Status != RiderStatus.Offline)
        {
            return;
        }
        Status = RiderStatus.Available;
        OnlineSince = now;
    }

    public void GoOffline()
    {
        if (IsBusy)
        {
            throw new DomainException("rider_busy", "Finish the current task before going offline.");
        }
        Status = RiderStatus.Offline;
        OnlineSince = null;
    }

    /// <summary>A new position. Without a bearing, the heading is the direction of travel.</summary>
    public void MoveTo(GeoPoint location, double? bearing, DateTimeOffset at)
    {
        if (bearing is { } heading)
        {
            Bearing = (heading % 360 + 360) % 360;
        }
        else if (location.DistanceTo(Location) >= 1)
        {
            Bearing = Location.BearingTo(location);
        }
        Location = location;
        LastSeenAt = at;
    }

    // Task transitions happen through Order, which keeps the order and its rider in step.

    internal void Assign()
    {
        if (Status != RiderStatus.Available)
        {
            throw new DomainException("rider_not_available", $"Rider {Id} is {Status}, not Available.");
        }
        Status = RiderStatus.Assigned;
    }

    /// <summary>Back to Available when their order is reassigned before pickup.</summary>
    internal void Release()
    {
        if (Status is not (RiderStatus.Assigned or RiderStatus.AtRestaurant))
        {
            throw new DomainException("rider_not_assigned", $"Rider {Id} is {Status}; only an assigned rider can be released.");
        }
        Status = RiderStatus.Available;
    }

    internal void ArriveAtRestaurant()
    {
        if (Status == RiderStatus.Assigned)
        {
            Status = RiderStatus.AtRestaurant;
        }
    }

    internal void PickUp()
    {
        if (Status is not (RiderStatus.Assigned or RiderStatus.AtRestaurant))
        {
            throw new DomainException("rider_not_assigned", $"Rider {Id} is {Status} and has nothing to pick up.");
        }
        Status = RiderStatus.Delivering;
    }

    internal void CompleteDelivery()
    {
        if (Status != RiderStatus.Delivering)
        {
            throw new DomainException("rider_not_delivering", $"Rider {Id} is {Status}, not Delivering.");
        }
        Status = RiderStatus.Available;
    }
}
