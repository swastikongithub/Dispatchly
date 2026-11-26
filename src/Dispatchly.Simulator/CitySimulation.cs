using System.Globalization;
using Dispatchly.Application;
using Dispatchly.Application.Abstractions;
using Dispatchly.Domain.Geo;
using Dispatchly.Domain.Orders;
using Dispatchly.Domain.Riders;

namespace Dispatchly.Simulator;

/// <summary>Something the simulator does on a tick, through the same use case a real rider or customer would call.</summary>
internal abstract record SimAction;

/// <summary>A GPS fix: <c>POST /rider/location</c>.</summary>
internal sealed record MoveRider(int RiderId, GeoPoint To, double Bearing) : SimAction;

/// <summary><c>PUT /rider/status</c>.</summary>
internal sealed record SetOnline(int RiderId, bool Online) : SimAction;

/// <summary>"Picked up · Start ride": <c>POST /rider/task/pickup</c>.</summary>
internal sealed record ConfirmPickup(int RiderId) : SimAction;

/// <summary>The customer reads out the code at the door: <c>POST /rider/task/deliver</c>.</summary>
internal sealed record Deliver(int RiderId, string Code) : SimAction;

/// <summary><c>POST /orders</c>.</summary>
internal sealed record PlaceOrder(int CustomerId, PlaceOrderRequest Request) : SimAction;

/// <summary>
/// The city's behaviour (PLAN.md §3.7), with no I/O: given what the city looks like now, it decides
/// what every rider does this tick and which orders come in. Riders follow their route at 18–28 km/h
/// with a little noise, wait for the food and at the door, drift between restaurants when free and
/// sometimes take a break. Some kitchens and some roads are slow, so "Running late" happens.
/// The same seed and the same city give the same decisions.
/// </summary>
internal sealed class CitySimulation(SimulatorOptions options, TimeSpan cityUtcOffset, int? demoRiderId)
{
    public const double MinSpeedKmh = 18;
    public const double MaxSpeedKmh = 28;
    public const double SpeedNoise = 0.10;
    public const double BearingNoiseDegrees = 3;

    /// <summary>Free riders drift slowly to a spot near one of the closest restaurants, then wait there a while.</summary>
    public const double MinDriftKmh = 4;
    public const double MaxDriftKmh = 8;
    public const double DriftRadiusMeters = 450;
    public const int DriftAmongNearest = 6;
    public static readonly TimeSpan MaxIdleBreak = TimeSpan.FromSeconds(120);
    public static readonly TimeSpan MinIdleBreak = TimeSpan.FromSeconds(30);

    /// <summary>A slow kitchen: the food is this much later than promised.</summary>
    public const double SlowKitchenShare = 0.15;
    public static readonly TimeSpan MinKitchenDelay = TimeSpan.FromMinutes(5);
    public static readonly TimeSpan MaxKitchenDelay = TimeSpan.FromMinutes(15);

    /// <summary>Heavy traffic: the ride to the door goes at this fraction of the rider's speed.</summary>
    public const double HeavyTrafficShare = 0.12;
    public const double HeavyTrafficFactor = 0.45;

    /// <summary>Once the food is ready, the rider takes a moment to collect it…</summary>
    public static readonly TimeSpan MaxPickupJitter = TimeSpan.FromSeconds(45);

    /// <summary>…and at the door, a moment for the customer to come down and read out the code.</summary>
    public static readonly TimeSpan MinHandover = TimeSpan.FromSeconds(20);
    public static readonly TimeSpan MaxHandover = TimeSpan.FromSeconds(60);

    /// <summary>Riders stay online about this long on average, then go offline about this long.</summary>
    public static readonly TimeSpan MeanShift = TimeSpan.FromHours(3);
    public static readonly TimeSpan MeanOffShift = TimeSpan.FromMinutes(30);

    /// <summary>Drops go near another restaurant this far from the one cooking, give or take a few hundred metres.</summary>
    public const double MinDropMeters = 800;
    public const double MaxDropMeters = 5_500;
    public const double DropScatterMeters = 600;
    public const double OnlinePaymentShare = 0.8;

    /// <summary>Closer than this to a stop is being there.</summary>
    private const double AtStopMeters = 1;

    private readonly Random _random = new(options.RandomSeed);
    private readonly Dictionary<int, RiderPlan> _riders = [];
    private readonly Dictionary<string, Job> _jobs = [];

    /// <summary>What happens in the city in the <paramref name="elapsed"/> since the last tick.</summary>
    public IReadOnlyList<SimAction> Tick(SimulationCity city, IReadOnlyList<SimulatedRider> riders, DateTimeOffset now, TimeSpan elapsed)
    {
        var seconds = elapsed.TotalSeconds * options.SpeedMultiplier;
        var actions = new List<SimAction>();
        foreach (var rider in riders)
        {
            if (Step(rider, city, now, seconds) is { } action)
            {
                actions.Add(action);
            }
        }
        // Forget orders that are done or were taken from their rider.
        var active = riders.Where(r => r.Task is not null).Select(r => r.Task!.Code).ToHashSet();
        foreach (var code in _jobs.Keys.Where(c => !active.Contains(c)).ToList())
        {
            _jobs.Remove(code);
        }
        actions.AddRange(NewOrders(city, now, elapsed));
        return actions;
    }

    /// <summary>How busy the city is at this hour in Delhi: quiet at night, peaks at lunch and dinner.</summary>
    public static double DemandAt(int hour) => hour switch
    {
        < 6 => 0.25,
        < 10 => 0.5,
        < 12 => 0.8,
        < 15 => 1.8,
        < 19 => 0.8,
        < 23 => 2.0,
        _ => 0.8,
    };

    private SimAction? Step(SimulatedRider rider, SimulationCity city, DateTimeOffset now, double seconds)
    {
        var plan = PlanFor(rider, now);
        var isDemo = rider.Id == demoRiderId;
        if (rider.Status == RiderStatus.Offline)
        {
            // The demo rider is the visitor's: only they take her on and off shift.
            return !isDemo && Chance(seconds / MeanOffShift.TotalSeconds) ? new SetOnline(rider.Id, true) : null;
        }
        if (rider.Task is not { } task)
        {
            if (isDemo || rider.Status != RiderStatus.Available)
            {
                return null;
            }
            return Chance(seconds / MeanShift.TotalSeconds)
                ? new SetOnline(rider.Id, false)
                : Drift(rider, plan, city, now, seconds);
        }
        return task.Status switch
        {
            OrderStatus.Assigned => ToRestaurant(rider, task, plan, isDemo, now, seconds),
            OrderStatus.PickedUp or OrderStatus.InTransit => ToDoor(rider, task, plan, isDemo, now, seconds),
            _ => null,
        };
    }

    private SimAction ToRestaurant(SimulatedRider rider, SimulatedTask task, RiderPlan plan, bool isDemo, DateTimeOffset now, double seconds)
    {
        if (rider.Location.DistanceTo(task.Restaurant) > AtStopMeters)
        {
            return Move(rider, Advance(rider.Location, task.Restaurant, Meters(plan.SpeedKmh * Noise(), seconds)));
        }
        // At the restaurant: wait for the food, then collect it.
        var job = JobFor(task);
        job.PickupAt ??= isDemo
            ? Later(now, task.ReadyAt) + options.DemoRiderPatience
            : Later(now, task.ReadyAt + Scaled(job.KitchenDelay)) + Scaled(job.PickupJitter);
        // Standing still still sends a fix, so the ETA keeps up with a late kitchen.
        return now >= job.PickupAt ? new ConfirmPickup(rider.Id) : Move(rider, rider.Location);
    }

    private SimAction ToDoor(SimulatedRider rider, SimulatedTask task, RiderPlan plan, bool isDemo, DateTimeOffset now, double seconds)
    {
        var job = JobFor(task);
        var path = PathTo(task);
        job.NextVertex ??= NextVertex(path, rider.Location);
        if (job.NextVertex < path.Count)
        {
            var traffic = isDemo ? 1 : job.Traffic;
            var meters = Meters(plan.SpeedKmh * traffic * Noise(), seconds);
            var at = rider.Location;
            while (meters > 0 && job.NextVertex < path.Count)
            {
                var vertex = path[job.NextVertex.Value];
                var gap = at.DistanceTo(vertex);
                if (gap <= meters)
                {
                    at = vertex;
                    meters -= gap;
                    job.NextVertex++;
                }
                else
                {
                    at = at.Move(at.BearingTo(vertex), meters);
                    meters = 0;
                }
            }
            return Move(rider, at);
        }
        // At the door: the customer comes down with the code.
        job.DeliverAt ??= now + (isDemo ? options.DemoRiderPatience : Scaled(job.Handover));
        return now >= job.DeliverAt ? new Deliver(rider.Id, task.DeliveryCode) : Move(rider, rider.Location);
    }

    private MoveRider? Drift(SimulatedRider rider, RiderPlan plan, SimulationCity city, DateTimeOffset now, double seconds)
    {
        if (plan.DriftTarget is not { } target)
        {
            if (now < plan.BreakUntil || DriftTarget(rider.Location, city) is not { } next)
            {
                return null;
            }
            target = next;
            plan.DriftTarget = next;
        }
        var to = Advance(rider.Location, target, Meters(plan.DriftKmh * Noise(), seconds));
        if (to.DistanceTo(target) <= AtStopMeters)
        {
            plan.DriftTarget = null;
            plan.BreakUntil = now + Scaled(Between(MinIdleBreak, MaxIdleBreak, _random));
        }
        return Move(rider, to);
    }

    private GeoPoint? DriftTarget(GeoPoint from, SimulationCity city)
    {
        if (city.Restaurants.Count == 0)
        {
            return null;
        }
        var nearest = city.Restaurants.OrderBy(r => r.Location.DistanceTo(from)).Take(DriftAmongNearest).ToList();
        var around = nearest[_random.Next(nearest.Count)].Location;
        return around.Move(_random.NextDouble() * 360, _random.NextDouble() * DriftRadiusMeters);
    }

    private IEnumerable<SimAction> NewOrders(SimulationCity city, DateTimeOffset now, TimeSpan elapsed)
    {
        if (city.Restaurants.Count == 0 || city.CustomerIds.Count == 0 || options.OrdersPerMinute <= 0)
        {
            return [];
        }
        var expected = options.OrdersPerMinute * DemandAt(now.ToOffset(cityUtcOffset).Hour) * elapsed.TotalMinutes;
        var count = Poisson(expected);
        var orders = new List<SimAction>(count);
        for (var i = 0; i < count; i++)
        {
            if (NewOrder(city) is { } order)
            {
                orders.Add(order);
            }
        }
        return orders;
    }

    private PlaceOrder? NewOrder(SimulationCity city)
    {
        var restaurant = city.Restaurants[_random.Next(city.Restaurants.Count)];
        if (restaurant.MenuItemIds.Count == 0)
        {
            return null;
        }
        var others = city.Restaurants
            .Where(r => r.Id != restaurant.Id && r.Location.DistanceTo(restaurant.Location) is >= MinDropMeters and <= MaxDropMeters)
            .ToList();
        GeoPoint drop;
        string area;
        if (others.Count > 0)
        {
            var near = others[_random.Next(others.Count)];
            drop = near.Location.Move(_random.NextDouble() * 360, _random.NextDouble() * DropScatterMeters);
            area = near.Area;
        }
        else
        {
            drop = restaurant.Location.Move(_random.NextDouble() * 360, MinDropMeters + _random.NextDouble() * (MaxDropMeters - MinDropMeters) / 2);
            area = restaurant.Area;
        }
        var lines = restaurant.MenuItemIds
            .OrderBy(_ => _random.Next())
            .Take(_random.Next(1, Math.Min(3, restaurant.MenuItemIds.Count) + 1))
            .Select(id => new PlaceOrderLine(id, _random.Next(1, 3)))
            .ToList();
        var address = string.Create(CultureInfo.InvariantCulture, $"{(char)('A' + _random.Next(13))}-{_random.Next(1, 120)}, {area}");
        var label = _random.NextDouble() switch
        {
            < 0.3 => "Home",
            < 0.45 => "Work",
            _ => null,
        };
        var payment = _random.NextDouble() < OnlinePaymentShare ? PaymentMethod.Online : PaymentMethod.Cash;
        var customer = city.CustomerIds[_random.Next(city.CustomerIds.Count)];
        return new PlaceOrder(customer, new PlaceOrderRequest(restaurant.Id, lines, new DropRequest(drop.Lat, drop.Lng, address, area, label), payment));
    }

    private RiderPlan PlanFor(SimulatedRider rider, DateTimeOffset now)
    {
        if (!_riders.TryGetValue(rider.Id, out var plan))
        {
            var random = RandomFor(rider.Id);
            plan = new RiderPlan
            {
                SpeedKmh = MinSpeedKmh + random.NextDouble() * (MaxSpeedKmh - MinSpeedKmh),
                DriftKmh = MinDriftKmh + random.NextDouble() * (MaxDriftKmh - MinDriftKmh),
                // Not everyone sets off on the first tick.
                BreakUntil = now + Scaled(Between(TimeSpan.Zero, MaxIdleBreak, random)),
            };
            _riders[rider.Id] = plan;
        }
        return plan;
    }

    private Job JobFor(SimulatedTask task)
    {
        if (!_jobs.TryGetValue(task.Code, out var job))
        {
            var random = RandomFor(StableHash(task.Code));
            job = new Job
            {
                KitchenDelay = random.NextDouble() < SlowKitchenShare ? Between(MinKitchenDelay, MaxKitchenDelay, random) : TimeSpan.Zero,
                Traffic = random.NextDouble() < HeavyTrafficShare ? HeavyTrafficFactor : 1,
                PickupJitter = Between(TimeSpan.Zero, MaxPickupJitter, random),
                Handover = Between(MinHandover, MaxHandover, random),
            };
            _jobs[task.Code] = job;
        }
        return job;
    }

    /// <summary>The route, ending at the drop.</summary>
    private static List<GeoPoint> PathTo(SimulatedTask task)
    {
        var path = task.Route.Count > 0 ? task.Route.ToList() : [task.Restaurant];
        if (path[^1].DistanceTo(task.Drop) > AtStopMeters)
        {
            path.Add(task.Drop);
        }
        return path;
    }

    /// <summary>The vertex to head for from <paramref name="at"/>: the one after the nearest, or the last.</summary>
    private static int NextVertex(List<GeoPoint> path, GeoPoint at)
    {
        var nearest = 0;
        for (var i = 1; i < path.Count; i++)
        {
            if (path[i].DistanceTo(at) < path[nearest].DistanceTo(at))
            {
                nearest = i;
            }
        }
        return Math.Max(1, nearest == path.Count - 1 ? nearest : nearest + 1);
    }

    private MoveRider Move(SimulatedRider rider, GeoPoint to)
    {
        var bearing = rider.Location.DistanceTo(to) >= 1
            ? rider.Location.BearingTo(to) + (_random.NextDouble() * 2 - 1) * BearingNoiseDegrees
            : rider.Bearing;
        return new MoveRider(rider.Id, to, (bearing % 360 + 360) % 360);
    }

    private static GeoPoint Advance(GeoPoint from, GeoPoint to, double meters) =>
        from.DistanceTo(to) <= meters ? to : from.Move(from.BearingTo(to), meters);

    private static double Meters(double kmh, double seconds) => kmh / 3.6 * seconds;

    private static DateTimeOffset Later(DateTimeOffset a, DateTimeOffset b) => a > b ? a : b;

    private TimeSpan Scaled(TimeSpan duration) => duration / options.SpeedMultiplier;

    private double Noise() => 1 + (_random.NextDouble() * 2 - 1) * SpeedNoise;

    private bool Chance(double probability) => _random.NextDouble() < probability;

    private static TimeSpan Between(TimeSpan min, TimeSpan max, Random random) => min + (max - min) * random.NextDouble();

    /// <summary>Knuth's method; fine for the handful of orders a tick brings.</summary>
    private int Poisson(double mean)
    {
        var limit = Math.Exp(-mean);
        var count = 0;
        for (var p = _random.NextDouble(); p > limit; p *= _random.NextDouble())
        {
            count++;
        }
        return count;
    }

    /// <summary>A generator of its own per rider and per order, so one's numbers don't depend on who else is in the city.</summary>
    private Random RandomFor(int key) => new(unchecked((options.RandomSeed * 486_187_739) + key));

    /// <summary>FNV-1a: string.GetHashCode changes every run.</summary>
    private static int StableHash(string value)
    {
        var hash = 2_166_136_261;
        foreach (var c in value)
        {
            hash = unchecked((hash ^ c) * 16_777_619u);
        }
        return unchecked((int)hash);
    }

    private sealed class RiderPlan
    {
        public double SpeedKmh { get; init; }
        public double DriftKmh { get; init; }
        public GeoPoint? DriftTarget { get; set; }
        public DateTimeOffset BreakUntil { get; set; }
    }

    private sealed class Job
    {
        public TimeSpan KitchenDelay { get; init; }
        public double Traffic { get; init; }
        public TimeSpan PickupJitter { get; init; }
        public TimeSpan Handover { get; init; }
        public DateTimeOffset? PickupAt { get; set; }
        public DateTimeOffset? DeliverAt { get; set; }
        public int? NextVertex { get; set; }
    }
}
