using Dispatchly.Application;
using Dispatchly.Domain.Customers;
using Dispatchly.Domain.Geo;
using Dispatchly.Domain.Orders;
using Dispatchly.Domain.Restaurants;
using Dispatchly.Domain.Riders;

namespace Dispatchly.IntegrationTests.Support;

/// <summary>
/// Builds a small, exact world in an empty database (<see cref="Seed.None"/>), through the domain
/// like the seeder does, so a test can say "a rider 300 m away" and mean it.
/// </summary>
public sealed class World(TestApp app)
{
    public static readonly GeoPoint KhanMarket = new(28.6003, 77.2270);

    private int _riders;

    public async Task<Restaurant> RestaurantAsync(GeoPoint? at = null, int prepMinutes = 10)
    {
        var restaurant = new Restaurant(
            "Second Pour Café",
            "Khan Market",
            "Shop 7, Middle Lane, Khan Market",
            "+91 00000 01001",
            at ?? KhanMarket,
            prepMinutes,
            [
                new MenuItem { Id = "cold-brew", Name = "Cold brew", PricePaise = 22_000 },
                new MenuItem { Id = "croissant", Name = "Almond croissant", PricePaise = 18_000 },
            ]);
        await AddAsync(restaurant);
        return restaurant;
    }

    /// <summary>A rider <paramref name="meters"/> from <paramref name="from"/>, online unless told otherwise.</summary>
    public async Task<Rider> RiderAsync(GeoPoint from, double meters, double bearing = 0, bool online = true)
    {
        var rider = NewRider(from.Move(bearing, meters), online);
        await AddAsync(rider);
        return rider;
    }

    public async Task<IReadOnlyList<Rider>> RidersAsync(int count, Func<int, GeoPoint> at, bool online = true)
    {
        var riders = Enumerable.Range(0, count).Select(i => NewRider(at(i), online)).ToList();
        await app.ExecuteAsync(async db =>
        {
            db.AddRange(riders);
            await db.SaveChangesAsync(TestContext.Current.CancellationToken);
        });
        return riders;
    }

    public async Task<Customer> CustomerAsync()
    {
        var customer = new Customer("Priya Nair", "+91 00000 02001", []);
        await AddAsync(customer);
        return customer;
    }

    /// <summary>Two cold brews and a croissant (₹620), dropped 2.5 km south of the restaurant.</summary>
    public static PlaceOrderRequest OrderFrom(Restaurant restaurant, GeoPoint? drop = null)
    {
        var to = drop ?? restaurant.Location.Move(180, 2_500);
        return new PlaceOrderRequest(
            restaurant.Id,
            [new PlaceOrderLine("cold-brew", 2), new PlaceOrderLine("croissant", 1)],
            new DropRequest(to.Lat, to.Lng, "B-14, Lajpat Nagar II", "Lajpat Nagar II", "Home"),
            PaymentMethod.Online);
    }

    private Rider NewRider(GeoPoint at, bool online)
    {
        var now = TimeProvider.System.GetUtcNow();
        var number = Interlocked.Increment(ref _riders);
        var rider = new Rider($"Rider {number}", $"+91 00000 {30_000 + number}", "Honda Activa", $"DL 3S CK {1_000 + number}", at, now);
        if (online)
        {
            rider.GoOnline(now);
        }
        return rider;
    }

    private Task AddAsync(object entity) =>
        app.ExecuteAsync(async db =>
        {
            db.Add(entity);
            await db.SaveChangesAsync(TestContext.Current.CancellationToken);
        });
}
