using Dispatchly.Domain.Geo;

namespace Dispatchly.Domain.Restaurants;

public sealed class Restaurant
{
    private readonly List<MenuItem> _menu = [];

    public Restaurant(
        string name,
        string area,
        string address,
        string phone,
        GeoPoint location,
        int prepMinutes,
        IEnumerable<MenuItem> menu)
    {
        Name = name;
        Area = area;
        Address = address;
        Phone = phone;
        Location = location;
        PrepMinutes = prepMinutes;
        // Copies: a menu item belongs to exactly one restaurant.
        _menu.AddRange(menu.Select(m => new MenuItem { Id = m.Id, Name = m.Name, PricePaise = m.PricePaise }));
    }

    private Restaurant()
    {
    }

    public int Id { get; private set; }
    public string Name { get; private set; } = "";

    /// <summary>The neighbourhood shown after the name, e.g. "Khan Market".</summary>
    public string Area { get; private set; } = "";

    public string Address { get; private set; } = "";

    /// <summary>For "Call café" in the rider app.</summary>
    public string Phone { get; private set; } = "";

    public GeoPoint Location { get; private set; }
    public int PrepMinutes { get; private set; }
    public IReadOnlyList<MenuItem> Menu => _menu;
}

public sealed class MenuItem
{
    /// <summary>Stable within the restaurant, e.g. "cold-brew".</summary>
    public required string Id { get; init; }

    public required string Name { get; init; }
    public required int PricePaise { get; init; }
}
