using Dispatchly.Domain.Customers;
using Dispatchly.Domain.Dispatch;
using Dispatchly.Domain.Geo;
using Dispatchly.Domain.Orders;
using Dispatchly.Domain.Restaurants;
using Dispatchly.Domain.Riders;

namespace Dispatchly.UnitTests.Domain;

/// <summary>Test data in central Delhi (PLAN.md §12).</summary>
internal static class Build
{
    public static readonly DateTimeOffset Now = new(2026, 11, 26, 14, 0, 0, TimeSpan.Zero);
    public static readonly GeoPoint KhanMarket = new(28.6003, 77.2270);
    public static readonly GeoPoint LajpatNagar = new(28.5672, 77.2372);
    public static readonly DispatchPolicy Policy = new();

    public static Restaurant Restaurant(int prepMinutes = 12) => new(
        "Saffron & Smoke",
        "Khan Market",
        "Shop 21, Middle Lane, Khan Market",
        "+91 00000 01001",
        KhanMarket,
        prepMinutes,
        [
            new MenuItem { Id = "butter-chicken", Name = "Smoked butter chicken", PricePaise = 46_000 },
            new MenuItem { Id = "dal-makhani", Name = "Dal makhani", PricePaise = 18_000 },
        ]);

    public static Customer Customer() => new("Priya Nair", "+91 00000 02001", []);

    public static Rider Rider(string name = "Aman Verma", GeoPoint? at = null, bool online = true)
    {
        var rider = new Rider(name, "+91 00000 03001", "Honda Activa", "DL 3S CK 2041", at ?? KhanMarket.Move(0, 600), Now);
        if (online)
        {
            rider.GoOnline(Now);
        }
        return rider;
    }

    public static Order Order(Restaurant? restaurant = null, string code = "4821")
    {
        var from = restaurant ?? Restaurant();
        return Dispatchly.Domain.Orders.Order.Place(
            4817,
            from,
            Customer(),
            [OrderItem.From(from.Menu[0], 1), OrderItem.From(from.Menu[1], 1)],
            new OrderDrop(LajpatNagar, "B-14, Lajpat Nagar II", "Lajpat Nagar II", "Home"),
            PaymentMethod.Online,
            code,
            Policy,
            Now);
    }
}
