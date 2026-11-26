using System.Globalization;
using Dispatchly.Domain.Customers;
using Dispatchly.Domain.Dispatch;
using Dispatchly.Domain.Geo;
using Dispatchly.Domain.Orders;
using Dispatchly.Domain.Restaurants;
using Dispatchly.Domain.Riders;
using Dispatchly.Infrastructure.Data;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Logging;

namespace Dispatchly.Infrastructure.Seeding;

/// <summary>
/// Seeds an empty database with the demo city (PLAN.md §12): ~40 restaurants, 140 riders, demo
/// customers, a few hours of delivered orders and the canon orders from the designs (DL-4810 …
/// DL-4823, with the hero order DL-4817). A fixed random seed makes demos repeatable; times are
/// relative to now. Everything goes through the domain, so seeded data obeys the same rules.
/// </summary>
public sealed class DemoSeeder(DispatchlyDbContext db, DispatchPolicy policy, TimeProvider clock, ILogger<DemoSeeder> logger)
{
    public const int RandomSeed = 4817;
    public const int RiderCount = 140;

    /// <summary>The demo accounts behind "Try as Rider / Customer" (the rider app design shows Neha's task).</summary>
    public const string DemoRiderName = "Neha Gupta";

    public const string DemoCustomerName = "Priya Nair";

    private static readonly TimeSpan HistoryLength = TimeSpan.FromHours(6);

    private readonly Random _random = new(RandomSeed);
    private int _phone;

    public async Task SeedAsync(CancellationToken ct)
    {
        if (await db.Riders.AnyAsync(ct))
        {
            return;
        }
        // All or nothing, so a failed seed never leaves a half-seeded database behind.
        await using var transaction = await db.Database.BeginTransactionAsync(ct);
        var now = clock.GetUtcNow();

        var restaurants = Restaurants();
        var riders = Riders(now);
        var customers = Customers();
        db.AddRange(restaurants);
        db.AddRange(riders);
        db.AddRange(customers);
        // Ids first: order events record the rider's id.
        await db.SaveChangesAsync(ct);

        var history = History(restaurants, riders, customers, now);
        var canon = CanonOrders(restaurants, riders, customers, now);
        db.AddRange(history);
        db.AddRange(canon);
        await db.SaveChangesAsync(ct);
        await transaction.CommitAsync(ct);

        logger.LogInformation(
            "Seeded {Restaurants} restaurants, {Riders} riders, {Customers} customers and {Orders} orders",
            restaurants.Count, riders.Count, customers.Count, history.Count + canon.Count);
    }

    private List<Restaurant> Restaurants() =>
    [
        .. DelhiCanon.Named
            .Concat(DelhiCanon.InventedRestaurants(_random))
            .Select(r => new Restaurant(
                r.Name, r.Area, r.Address, NextPhone(), Near(DelhiCanon.Areas[r.Area], 350), r.PrepMinutes, r.Menu)),
    ];

    private List<Rider> Riders(DateTimeOffset now)
    {
        var names = DelhiCanon.FirstNames
            .SelectMany(first => DelhiCanon.LastNames.Select(last => $"{first} {last}"))
            .Except(DelhiCanon.NamedRiders.Select(r => r.Name))
            .OrderBy(_ => _random.Next())
            .Take(RiderCount - DelhiCanon.NamedRiders.Length);
        var generated = names.Select(name => (
            Name: name,
            Vehicle: DelhiCanon.Vehicles[_random.Next(DelhiCanon.Vehicles.Length)],
            Plate: Plate()));

        var riders = new List<Rider>();
        foreach (var (name, vehicle, plate) in DelhiCanon.NamedRiders.Concat(generated))
        {
            var rider = new Rider(name, NextPhone(), vehicle, plate, Near(RandomArea(), 1_200), now);
            // The named riders are always on shift; about 15% of the rest are offline.
            if (riders.Count < DelhiCanon.NamedRiders.Length || _random.NextDouble() > 0.15)
            {
                rider.GoOnline(now.AddMinutes(-_random.Next(20, 360)));
            }
            riders.Add(rider);
        }
        return riders;
    }

    private List<Customer> Customers() =>
    [
        .. DelhiCanon.Customers.Select((name, i) =>
        {
            var home = i == 0
                ? (Address: "B-14, Lajpat Nagar II", Area: "Lajpat Nagar II", Location: Near(DelhiCanon.Areas["Lajpat Nagar II"], 150))
                : RandomAddress();
            return new Customer(name, NextPhone(),
            [
                new SavedAddress { Label = "Home", Address = home.Address, Area = home.Area, Lat = home.Location.Lat, Lng = home.Location.Lng },
            ]);
        }),
    ];

    /// <summary>Delivered orders over the last few hours, so stats and earnings start out real.</summary>
    private List<Order> History(List<Restaurant> restaurants, List<Rider> riders, List<Customer> customers, DateTimeOffset now)
    {
        var slots = new List<DateTimeOffset>();
        for (var t = now - HistoryLength; t < now.AddMinutes(-45); t = t.AddMinutes(5))
        {
            slots.AddRange(Enumerable.Range(0, _random.Next(2, 5)).Select(_ => t.AddSeconds(_random.Next(300))));
        }
        slots.Sort();

        var busyUntil = riders.ToDictionary(r => r, _ => DateTimeOffset.MinValue);
        var online = riders.Where(r => r.Status == RiderStatus.Available).ToList();
        // The named riders have a history too, but only well before their canon orders below.
        var named = DelhiCanon.NamedRiders.Select(r => r.Name).ToHashSet();
        bool Free(Rider r, DateTimeOffset at) => busyUntil[r] < at && (!named.Contains(r.Name) || at < now.AddMinutes(-90));
        var orders = new List<Order>();
        var number = 4810 - slots.Count;
        foreach (var placedAt in slots)
        {
            var restaurant = restaurants[_random.Next(restaurants.Count)];
            var rider = online.FirstOrDefault(r => Free(r, placedAt) && _random.NextDouble() < 0.2)
                ?? online.First(r => Free(r, placedAt));
            var order = Place(number++, restaurant, customers[_random.Next(customers.Count)], RandomDropNear(restaurant), placedAt);

            var assignedAt = placedAt.AddSeconds(_random.Next(15, 120));
            rider.MoveTo(restaurant.Location.Move(_random.Next(360), _random.Next(200, 1_500)), null, assignedAt);
            order.Assign(rider, _random.Next(2, 10), rider.Location.DistanceTo(restaurant.Location), policy, assignedAt);

            var pickedUpAt = Max(order.ReadyAt, assignedAt + policy.Travel(rider.Location.DistanceTo(restaurant.Location)))
                .AddSeconds(_random.Next(0, 180));
            Ride(order, rider, restaurant.Location, pickedUpAt);
            order.ConfirmPickup(policy, pickedUpAt);
            Ride(order, rider, restaurant.Location.Move(restaurant.Location.BearingTo(order.DropLocation), 200), pickedUpAt.AddMinutes(1));

            var deliveredAt = pickedUpAt + policy.Travel(order.DistanceMeters) * (1 + _random.NextDouble() * 0.4);
            if (deliveredAt > now.AddMinutes(-1))
            {
                continue;
            }
            Ride(order, rider, order.DropLocation, deliveredAt);
            order.Deliver(order.DeliveryCode, deliveredAt);
            busyUntil[rider] = deliveredAt;
            orders.Add(order);
        }

        // Back out on the streets, spread around the restaurants.
        foreach (var rider in riders)
        {
            rider.MoveTo(Near(restaurants[_random.Next(restaurants.Count)].Location, 1_200), _random.Next(360), now);
        }
        return orders;
    }

    /// <summary>The orders in the dashboard design's queue, as they stand right now.</summary>
    private List<Order> CanonOrders(List<Restaurant> restaurants, List<Rider> riders, List<Customer> customers, DateTimeOffset now)
    {
        Restaurant R(string name) => restaurants.Single(r => r.Name == name);
        Rider Who(string name) => riders.Single(r => r.Name == name);
        var priya = customers.Single(c => c.Name == DemoCustomerName);
        Customer Someone() => customers[_random.Next(1, customers.Count)];

        // #DL-4810: Neha is heading to Second Pour Café; the food is ready in 2 minutes.
        var cafe = R("Second Pour Café");
        var neha = Who("Neha Gupta");
        var dl4810 = Place(4810, cafe, Someone(), Drop("Karol Bagh", "11A Ajmal Khan Road"), now.AddMinutes(-6),
            [OrderItem.From(cafe.Menu[0], 2), OrderItem.From(cafe.Menu[1], 1)], PaymentMethod.Online);
        Assign(dl4810, neha, cafe.Location.Move(250, 900), freeRiders: 5, now.AddMinutes(-5));
        Ride(dl4810, neha, cafe.Location.Move(250, 400), now);

        // #DL-4812: Imran picked up late from Lahori Gate Kitchen and is running about 5 minutes late.
        var lahori = R("Lahori Gate Kitchen");
        var imran = Who("Imran Ali");
        var dl4812 = Place(4812, lahori, Someone(), Drop("ITO", "Pragati Vihar Hostel Road"), now.AddMinutes(-33));
        Assign(dl4812, imran, lahori.Location.Move(20, 700), freeRiders: 3, now.AddMinutes(-31));
        PickUpAndLeave(dl4812, imran, now.AddMinutes(-14));
        Ride(dl4812, imran, dl4812.DropLocation.Move(dl4812.DropLocation.BearingTo(lahori.Location), 900), now);

        // #DL-4815: Ritika just picked up at Kulfi & Co.
        var kulfi = R("Kulfi & Co.");
        var ritika = Who("Ritika Sharma");
        var dl4815 = Place(4815, kulfi, Someone(), Drop("Gole Market", "Bhai Vir Singh Marg"), now.AddMinutes(-9));
        Assign(dl4815, ritika, kulfi.Location.Move(120, 500), freeRiders: 6, now.AddMinutes(-8));
        Ride(dl4815, ritika, kulfi.Location.Move(90, 15), now.AddMinutes(-2));
        dl4815.ConfirmPickup(policy, now.AddMinutes(-1));

        // #DL-4817, the hero order: Aman is on the way to Priya's home with 3.1 km to go, code 4821.
        var saffron = R("Saffron & Smoke");
        var aman = Who("Aman Verma");
        var home = priya.SavedAddresses[0];
        var dl4817 = Order.Place(
            4817,
            saffron,
            priya,
            [OrderItem.From(saffron.Menu[0], 1), OrderItem.From(saffron.Menu[1], 1)],
            new OrderDrop(new GeoPoint(home.Lat, home.Lng), home.Address, home.Area, home.Label),
            PaymentMethod.Online,
            "4821",
            policy,
            now.AddMinutes(-17));
        Assign(dl4817, aman, saffron.Location.Move(200, 600), freeRiders: 4, now.AddMinutes(-15));
        PickUpAndLeave(dl4817, aman, now.AddMinutes(-6));
        var toHome = saffron.Location.BearingTo(dl4817.DropLocation);
        Ride(dl4817, aman, saffron.Location.Move(toHome, Math.Max(0, dl4817.DistanceMeters - 3_100)), now);

        // #DL-4822 and #DL-4823 have just come in and need a rider.
        var dl4822 = Place(4822, R("Momo Lab"), Someone(), Drop("Green Park", "S-21, Green Park Main"), now.AddSeconds(-4));
        var dl4823 = Place(4823, R("Tiffin Theory"), Someone(), Drop("Nizamuddin East", "C-9, Nizamuddin East"), now.AddSeconds(-12));

        Ride(null, Who("Karan Mehta"), Near(DelhiCanon.Areas["Connaught Place"], 400), now);
        return [dl4810, dl4812, dl4815, dl4817, dl4822, dl4823];
    }

    private Order Place(
        int number,
        Restaurant restaurant,
        Customer customer,
        OrderDrop drop,
        DateTimeOffset at,
        OrderItem[]? items = null,
        PaymentMethod? payment = null)
    {
        items ??=
        [
            .. restaurant.Menu
                .OrderBy(_ => _random.Next())
                .Take(_random.Next(1, Math.Min(3, restaurant.Menu.Count) + 1))
                .Select(m => OrderItem.From(m, _random.Next(1, 3))),
        ];
        var code = _random.Next(10_000).ToString("D4", CultureInfo.InvariantCulture);
        return Order.Place(
            number, restaurant, customer, items, drop,
            payment ?? (_random.NextDouble() < 0.8 ? PaymentMethod.Online : PaymentMethod.Cash),
            code, policy, at);
    }

    private void Assign(Order order, Rider rider, GeoPoint from, int freeRiders, DateTimeOffset at)
    {
        rider.MoveTo(from, null, at);
        order.Assign(rider, freeRiders, from.DistanceTo(order.Restaurant.Location), policy, at);
    }

    private void PickUpAndLeave(Order order, Rider rider, DateTimeOffset at)
    {
        Ride(order, rider, order.Restaurant.Location, at.AddMinutes(-1));
        order.ConfirmPickup(policy, at);
        var away = order.Restaurant.Location.Move(order.Restaurant.Location.BearingTo(order.DropLocation), 200);
        Ride(order, rider, away, at.AddMinutes(2));
    }

    private void Ride(Order? order, Rider rider, GeoPoint to, DateTimeOffset at)
    {
        rider.MoveTo(to, null, at);
        order?.RiderMoved(policy, at);
    }

    private OrderDrop Drop(string area, string street) =>
        new(Near(DelhiCanon.Areas[area], 250), $"{_random.Next(1, 60)}, {street}", area, null);

    private OrderDrop RandomDropNear(Restaurant restaurant)
    {
        var areas = DelhiCanon.Areas
            .Where(a => a.Value.DistanceTo(restaurant.Location) is > 800 and < 5_500)
            .ToList();
        var (area, centre) = areas.Count > 0
            ? areas[_random.Next(areas.Count)]
            : new KeyValuePair<string, GeoPoint>(restaurant.Area, restaurant.Location);
        return new OrderDrop(Near(centre, 600), $"House {_random.Next(1, 300)}, {area}", area, null);
    }

    private (string Address, string Area, GeoPoint Location) RandomAddress()
    {
        var (area, centre) = DelhiCanon.Areas.ElementAt(_random.Next(DelhiCanon.Areas.Count));
        return ($"{(char)('A' + _random.Next(8))}-{_random.Next(1, 120)}, {area}", area, Near(centre, 500));
    }

    private GeoPoint RandomArea() => DelhiCanon.Areas.ElementAt(_random.Next(DelhiCanon.Areas.Count)).Value;

    private GeoPoint Near(GeoPoint centre, double maxMeters) =>
        centre.Move(_random.Next(360), _random.NextDouble() * maxMeters);

    /// <summary>Delhi two-wheeler plates look like "DL 3S CK 2041".</summary>
    private string Plate() => string.Create(
        CultureInfo.InvariantCulture,
        $"DL {_random.Next(1, 14)}S {(char)('A' + _random.Next(26))}{(char)('A' + _random.Next(26))} {_random.Next(1_000, 10_000)}");

    /// <summary>"+91 00000 …" numbers are not valid Indian mobile numbers, so "Call" never reaches a real person.</summary>
    private string NextPhone() => string.Create(CultureInfo.InvariantCulture, $"+91 00000 {++_phone:D5}");

    private static DateTimeOffset Max(DateTimeOffset a, DateTimeOffset b) => a > b ? a : b;
}
