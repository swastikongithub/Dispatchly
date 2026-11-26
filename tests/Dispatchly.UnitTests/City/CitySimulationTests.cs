using System.Text.Json;
using System.Text.RegularExpressions;
using Dispatchly.Application;
using Dispatchly.Application.Abstractions;
using Dispatchly.Domain.Geo;
using Dispatchly.Domain.Orders;
using Dispatchly.Domain.Riders;
using Dispatchly.Simulator;
using static Dispatchly.Simulator.CitySimulation;

namespace Dispatchly.UnitTests.City;

/// <summary>
/// The city simulator's decisions (PLAN.md §3.7), with a small stand-in for the server that applies
/// them the way the use cases would. Shares and counts are checked with bounds several standard
/// deviations wide, on a fixed seed, so they hold without being brittle.
/// </summary>
public sealed partial class CitySimulationTests
{
    private static readonly GeoPoint KhanMarket = new(28.6003, 77.2270);
    private static readonly TimeSpan Delhi = TimeSpan.FromHours(5.5);
    private static readonly TimeSpan TwoSeconds = TimeSpan.FromSeconds(2);

    /// <summary>13:00 in Delhi, the lunch peak.</summary>
    private static readonly DateTimeOffset Lunch = new(2026, 11, 27, 7, 30, 0, TimeSpan.Zero);

    /// <summary>03:00 in Delhi.</summary>
    private static readonly DateTimeOffset Night = new(2026, 11, 26, 21, 30, 0, TimeSpan.Zero);

    private const string Code = "0429";
    private const int Neha = 5;

    [Fact]
    public void Riders_ride_to_the_restaurant_at_18_to_28_kmh_facing_where_they_go()
    {
        var cafe = KhanMarket;
        var riders = Enumerable.Range(1, 40)
            .Select(id => Rider(id, cafe.Move(id * 9, 2_000), Job($"DL-{id}", OrderStatus.Assigned, cafe, cafe.Move(180, 2_500), Lunch.AddMinutes(10))))
            .ToArray();
        var city = new FakeCity(Simulation(), CityOf(cafe), Lunch, riders);
        var speeds = new List<double>();

        for (var tick = 0; tick < 5; tick++)
        {
            var before = city.Riders.ToDictionary(r => r.Key, r => r.Value.Location);
            foreach (var move in city.Tick().OfType<MoveRider>())
            {
                var from = before[move.RiderId];
                var kmh = from.DistanceTo(move.To) / TwoSeconds.TotalSeconds * 3.6;
                Assert.InRange(kmh, MinSpeedKmh * (1 - SpeedNoise) - 0.01, MaxSpeedKmh * (1 + SpeedNoise) + 0.01);
                Assert.True(move.To.DistanceTo(cafe) < from.DistanceTo(cafe));
                Assert.InRange(AngleBetween(move.Bearing, from.BearingTo(cafe)), 0, BearingNoiseDegrees + 0.01);
                Assert.InRange(move.Bearing, 0, 359.999_999);
                speeds.Add(kmh);
            }
        }

        Assert.Equal(200, speeds.Count);
        // Each rider has a pace of their own across the range.
        Assert.True(speeds.Min() < 21 && speeds.Max() > 25, $"Speeds {speeds.Min():0.0}–{speeds.Max():0.0} km/h.");
    }

    [Fact]
    public void Riders_wait_at_the_restaurant_for_the_food_and_some_kitchens_are_slow()
    {
        var cafe = KhanMarket;
        var readyAt = Lunch.AddMinutes(1);
        var riders = Enumerable.Range(1, 300)
            .Select(id => Rider(id, cafe, Job($"DL-{1_000 + id}", OrderStatus.Assigned, cafe, cafe.Move(180, 2_500), readyAt)))
            .ToArray();
        var city = new FakeCity(Simulation(), CityOf(cafe), Lunch, riders);

        city.RunUntil(() => city.Riders.Values.All(r => r.Task?.Status != OrderStatus.Assigned), TimeSpan.FromMinutes(20));

        var pickups = city.Log.Where(l => l.Action is ConfirmPickup).ToDictionary(l => ((ConfirmPickup)l.Action).RiderId, l => l.At);
        Assert.Equal(300, pickups.Count);
        var waits = pickups.Values.Select(at => at - readyAt).ToList();
        Assert.All(waits, wait => Assert.True(wait >= TimeSpan.Zero, "Collected before the food was ready."));
        // Ready food is collected within the jitter; a slow kitchen is 5–15 min late on top.
        var prompt = waits.Where(w => w <= MaxPickupJitter + TwoSeconds).ToList();
        var slow = waits.Where(w => w >= MinKitchenDelay && w <= MaxKitchenDelay + MaxPickupJitter + TwoSeconds).ToList();
        Assert.Equal(waits.Count, prompt.Count + slow.Count);
        Assert.InRange(slow.Count / 300.0, SlowKitchenShare - 0.07, SlowKitchenShare + 0.09);
        Assert.True(prompt.Max() > TimeSpan.FromSeconds(30), "Pickups don't all happen on the same tick.");
        // While they wait they stand still, and still report where they are.
        foreach (var (at, action) in city.Log.Where(l => l.Action is MoveRider))
        {
            var move = (MoveRider)action;
            Assert.True(at < pickups[move.RiderId]);
            Assert.Equal(cafe, move.To);
            Assert.Equal(0, move.Bearing);
        }
    }

    [Fact]
    public void A_rider_follows_the_route_to_the_door_then_hands_over_with_the_code()
    {
        var cafe = KhanMarket;
        var corner = cafe.Move(90, 800);
        var end = corner.Move(180, 800);
        var drop = end.Move(180, 100);
        var task = Job("DL-1", OrderStatus.PickedUp, cafe, drop, Lunch.AddMinutes(-1), cafe, corner, end);
        var city = new FakeCity(Simulation(), CityOf(cafe), Lunch, Rider(1, cafe, task));
        GeoPoint[] path = [cafe, corner, end, drop];

        var arrived = city.RunUntil(() => city.Riders[1].Location.DistanceTo(drop) <= 1, TimeSpan.FromMinutes(20));
        var delivered = city.RunUntil(() => city.Riders[1].Task is null, TimeSpan.FromMinutes(2));

        // Every fix is on the route, not on a straight line to the door.
        var moves = city.Log.Select(l => l.Action).OfType<MoveRider>().ToList();
        Assert.All(moves, move => Assert.True(OnPath(path, move.To), $"{move.To} is off the route."));
        Assert.Contains(moves, move => move.To.DistanceTo(corner) < 30);
        // 1.7 km at 18–28 km/h ±10%, or as slow as heavy traffic makes it.
        var ride = arrived - Lunch;
        Assert.InRange(ride.TotalSeconds, 1_700 / (MaxSpeedKmh * (1 + SpeedNoise) / 3.6) - 2, 1_700 / (MinSpeedKmh * (1 - SpeedNoise) * HeavyTrafficFactor / 3.6) + 2);
        // At the door, the customer takes a moment to come down, and the rider waits where they are.
        Assert.InRange(delivered - arrived, MinHandover, MaxHandover + TwoSeconds);
        var deliver = Assert.Single(city.Log.Select(l => l.Action).OfType<Deliver>());
        Assert.Equal(new Deliver(1, Code), deliver);
        Assert.All(city.Log.Where(l => l.At > arrived && l.Action is MoveRider), l => Assert.Equal(drop, ((MoveRider)l.Action).To));
    }

    [Fact]
    public void Some_rides_are_stuck_in_heavy_traffic()
    {
        var cafe = KhanMarket;
        var drop = cafe.Move(180, 3_000);
        var rides = new List<double>();
        for (var order = 0; order < 200; order++)
        {
            var task = Job($"DL-{5_000 + order}", OrderStatus.PickedUp, cafe, drop, Lunch, cafe, drop);
            var city = new FakeCity(Simulation(), CityOf(cafe), Lunch, Rider(7, cafe, task));
            rides.Add((city.RunUntil(() => city.Riders[7].Location.DistanceTo(drop) <= 1, TimeSpan.FromHours(1)) - Lunch).TotalSeconds);
        }

        // The same rider each time, so a ride over 1.6× the quickest is traffic (0.45×), not their pace.
        var quickest = rides.Min();
        var jammed = rides.Count(r => r > quickest * 1.6);
        Assert.InRange(jammed / 200.0, HeavyTrafficShare - 0.08, HeavyTrafficShare + 0.10);
        Assert.All(rides.Where(r => r <= quickest * 1.6), r => Assert.InRange(r, quickest, quickest * 1.1));
        Assert.All(rides.Where(r => r > quickest * 1.6), r => Assert.InRange(r, quickest / HeavyTrafficFactor * 0.9, quickest / HeavyTrafficFactor * 1.2));
    }

    [Fact]
    public void The_demo_rider_gives_the_visitor_time_to_slide_at_the_restaurant_and_at_the_door()
    {
        var cafe = KhanMarket;
        var drop = cafe.Move(180, 1_000);
        var options = new SimulatorOptions { OrdersPerMinute = 0, SpeedMultiplier = 10, DemoRiderPatience = TimeSpan.FromMinutes(2) };
        var task = Job("DL-4810", OrderStatus.Assigned, cafe, drop, Lunch.AddMinutes(-1), cafe, drop);
        var city = new FakeCity(Simulation(options, demoRiderId: Neha), CityOf(cafe), Lunch, Rider(Neha, cafe, task));

        var pickedUp = city.RunUntil(() => city.Riders[Neha].Task?.Status != OrderStatus.Assigned, TimeSpan.FromMinutes(10));
        var arrived = city.RunUntil(() => city.Riders[Neha].Location.DistanceTo(drop) <= 1, TimeSpan.FromMinutes(10));
        var delivered = city.RunUntil(() => city.Riders[Neha].Task is null, TimeSpan.FromMinutes(10));

        // Not her kitchen delays or a handover sped up 10×: the visitor's patience, in real time.
        Assert.InRange(pickedUp - (Lunch + TwoSeconds), options.DemoRiderPatience, options.DemoRiderPatience + TwoSeconds);
        Assert.InRange(delivered - arrived, options.DemoRiderPatience, options.DemoRiderPatience + TwoSeconds);
        // She still rides 10× faster: 1 km in well under a minute.
        Assert.True(arrived - pickedUp < TimeSpan.FromSeconds(30));
    }

    [Fact]
    public void The_demo_rider_waits_where_she_is_when_free_and_never_changes_shift_herself()
    {
        var cafe = KhanMarket;
        var city = CityOf(cafe, cafe.Move(90, 1_500));
        var free = new FakeCity(Simulation(demoRiderId: Neha), city, Lunch, Rider(Neha, cafe.Move(0, 300)), Rider(6, cafe.Move(0, 300)));
        var offline = new FakeCity(Simulation(demoRiderId: Neha), city, Lunch, Rider(Neha, cafe.Move(0, 300), status: RiderStatus.Offline));

        for (var tick = 0; tick < 1_440; tick++)
        {
            free.Tick(TimeSpan.FromSeconds(30));
            offline.Tick(TimeSpan.FromSeconds(30));
        }

        Assert.DoesNotContain(free.Log, l => RiderOf(l.Action) == Neha);
        Assert.Empty(offline.Log);
        // Twelve hours went by for everyone else.
        Assert.Contains(free.Log, l => l.Action is MoveRider { RiderId: 6 });
    }

    [Fact]
    public void Free_riders_drift_slowly_to_restaurants_take_breaks_and_end_their_shifts()
    {
        GeoPoint[] restaurants = [KhanMarket, KhanMarket.Move(60, 1_200), KhanMarket.Move(200, 900)];
        var riders = Enumerable.Range(1, 100).Select(id => Rider(id, KhanMarket.Move(id * 37 % 360, 300 + id * 12))).ToArray();
        var city = new FakeCity(Simulation(), CityOf(restaurants), Lunch, riders);
        var tick = TimeSpan.FromSeconds(10);
        var reached = new HashSet<int>();
        var onlineTicks = 0;
        var moves = 0;

        for (var i = 0; i < 2_160; i++)
        {
            var before = city.Riders.ToDictionary(r => r.Key, r => r.Value);
            onlineTicks += before.Values.Count(r => r.Status == RiderStatus.Available);
            foreach (var move in city.Tick(tick).OfType<MoveRider>())
            {
                moves++;
                var kmh = before[move.RiderId].Location.DistanceTo(move.To) / tick.TotalSeconds * 3.6;
                Assert.InRange(kmh, 0, MaxDriftKmh * (1 + SpeedNoise) + 0.01);
                if (restaurants.Any(r => r.DistanceTo(move.To) <= DriftRadiusMeters + 1))
                {
                    reached.Add(move.RiderId);
                }
            }
        }

        Assert.Equal(100, reached.Count);
        Assert.InRange(moves, onlineTicks * 0.5, onlineTicks * 0.97);
        // Six hours on, the city has settled at about 30 min off for every 3 h on (≈ 14% offline).
        Assert.Contains(city.Log, l => l.Action is SetOnline { Online: false });
        Assert.Contains(city.Log, l => l.Action is SetOnline { Online: true });
        Assert.InRange(city.Riders.Values.Count(r => r.Status == RiderStatus.Offline), 4, 30);
    }

    [Fact]
    public void Orders_come_in_at_the_set_rate_shaped_by_the_hour()
    {
        var options = new SimulatorOptions { OrdersPerMinute = 10 };
        int OrdersIn20Minutes(DateTimeOffset start, SimulationCity city, SimulatorOptions? settings = null)
        {
            var fake = new FakeCity(Simulation(settings ?? options), city, start);
            for (var i = 0; i < 600; i++)
            {
                fake.Tick();
            }
            return fake.Log.Count(l => l.Action is PlaceOrder);
        }
        var city = CityOf(KhanMarket, KhanMarket.Move(90, 2_000));

        // 10 a minute × 1.8 at lunch × 20 min = 360; × 0.25 at night = 50.
        Assert.InRange(OrdersIn20Minutes(Lunch, city), 300, 420);
        Assert.InRange(OrdersIn20Minutes(Night, city), 25, 80);
        Assert.Equal(0, OrdersIn20Minutes(Lunch, city, new SimulatorOptions { OrdersPerMinute = 0 }));
        Assert.Equal(0, OrdersIn20Minutes(Lunch, city with { CustomerIds = [] }));
        Assert.Equal(0, OrdersIn20Minutes(Lunch, city with { Restaurants = [] }));
    }

    [Fact]
    public void Each_new_order_is_one_a_customer_could_place()
    {
        SimulatedRestaurant[] restaurants =
        [
            Restaurant(1, "Khan Market", KhanMarket),
            Restaurant(2, "Lodhi Colony", KhanMarket.Move(90, 2_000)),
            Restaurant(3, "Lajpat Nagar II", KhanMarket.Move(200, 3_500)),
            // More than 5.5 km from all the others.
            Restaurant(4, "Civil Lines", KhanMarket.Move(0, 9_000)),
        ];
        var city = new SimulationCity(restaurants, [101, 102, 103]);
        var fake = new FakeCity(Simulation(new SimulatorOptions { OrdersPerMinute = 30 }), city, Lunch);
        for (var i = 0; i < 300; i++)
        {
            fake.Tick();
        }

        var orders = fake.Log.Select(l => l.Action).OfType<PlaceOrder>().ToList();
        Assert.InRange(orders.Count, 450, 630);
        foreach (var (customerId, request) in orders)
        {
            Assert.Contains(customerId, city.CustomerIds);
            var from = Assert.Single(restaurants, r => r.Id == request.RestaurantId);
            Assert.InRange(request.Items.Count, 1, 3);
            Assert.Equal(request.Items.Count, request.Items.Select(l => l.MenuItemId).Distinct().Count());
            Assert.All(request.Items, line =>
            {
                Assert.Contains(line.MenuItemId, from.MenuItemIds);
                Assert.InRange(line.Quantity, 1, 2);
            });
            var drop = new GeoPoint(request.Drop.Lat, request.Drop.Lng);
            var others = restaurants.Where(r => r.Id != from.Id && r.Location.DistanceTo(from.Location) is >= MinDropMeters and <= MaxDropMeters).ToList();
            if (others.Count > 0)
            {
                // Near another restaurant a ride away, in its area.
                Assert.Contains(others, r => r.Area == request.Drop.Area && r.Location.DistanceTo(drop) <= DropScatterMeters + 0.5);
            }
            else
            {
                Assert.Equal(from.Area, request.Drop.Area);
                Assert.InRange(from.Location.DistanceTo(drop), MinDropMeters - 0.5, (MinDropMeters + MaxDropMeters) / 2 + 0.5);
            }
            Assert.Matches(AddressPattern(), request.Drop.Address);
            Assert.EndsWith(request.Drop.Area, request.Drop.Address, StringComparison.Ordinal);
            Assert.Contains(request.Drop.Label, new[] { "Home", "Work", null });
        }
        Assert.Equal(restaurants.Select(r => r.Id), orders.Select(o => o.Request.RestaurantId).Distinct().Order());
        Assert.InRange(orders.Count(o => o.Request.Payment == PaymentMethod.Online) / (double)orders.Count, OnlinePaymentShare - 0.08, OnlinePaymentShare + 0.08);
    }

    [Fact]
    public void The_same_seed_makes_the_same_city_and_another_seed_a_different_one()
    {
        string Run(int seed)
        {
            var cafe = KhanMarket;
            var options = new SimulatorOptions { RandomSeed = seed, OrdersPerMinute = 20 };
            var fake = new FakeCity(
                Simulation(options),
                CityOf(cafe, cafe.Move(90, 2_000), cafe.Move(200, 3_500)),
                Lunch,
                Rider(1, cafe.Move(0, 900), Job("DL-1", OrderStatus.Assigned, cafe, cafe.Move(180, 2_000), Lunch.AddMinutes(2))),
                Rider(2, cafe, Job("DL-2", OrderStatus.PickedUp, cafe, cafe.Move(90, 1_500), Lunch, cafe, cafe.Move(90, 1_500))),
                Rider(3, cafe.Move(45, 600)),
                Rider(4, cafe.Move(300, 600), status: RiderStatus.Offline));
            for (var i = 0; i < 400; i++)
            {
                fake.Tick();
            }
            return string.Join('\n', fake.Log.Select(l => $"{l.At:O} {l.Action.GetType().Name} {JsonSerializer.Serialize(l.Action, l.Action.GetType())}"));
        }

        var first = Run(4817);

        Assert.Equal(first, Run(4817));
        Assert.NotEqual(first, Run(4818));
    }

    [Fact]
    public void A_faster_demo_moves_riders_further_each_tick_but_kitchens_keep_their_time()
    {
        var cafe = KhanMarket;
        var readyAt = Lunch.AddMinutes(5);
        double FirstStep(double multiplier)
        {
            var from = cafe.Move(0, 5_000);
            var fake = new FakeCity(
                Simulation(new SimulatorOptions { OrdersPerMinute = 0, SpeedMultiplier = multiplier }),
                CityOf(cafe),
                Lunch,
                Rider(1, from, Job("DL-1", OrderStatus.Assigned, cafe, cafe.Move(180, 2_000), readyAt)));
            return from.DistanceTo(Assert.IsType<MoveRider>(Assert.Single(fake.Tick())).To);
        }

        Assert.Equal(10, FirstStep(10) / FirstStep(1), 3);

        var waiting = new FakeCity(
            Simulation(new SimulatorOptions { OrdersPerMinute = 0, SpeedMultiplier = 10 }),
            CityOf(cafe),
            Lunch,
            Rider(1, cafe, Job("DL-1", OrderStatus.Assigned, cafe, cafe.Move(180, 2_000), readyAt)));
        var pickedUp = waiting.RunUntil(() => waiting.Riders[1].Task?.Status == OrderStatus.PickedUp, TimeSpan.FromMinutes(10));
        Assert.InRange(pickedUp, readyAt, readyAt + (MaxKitchenDelay + MaxPickupJitter) / 10 + TwoSeconds);
    }

    [Fact]
    public void The_city_is_busiest_at_lunch_and_dinner_and_quietest_at_night()
    {
        var demand = Enumerable.Range(0, 24).Select(DemandAt).ToArray();

        Assert.Equal(demand.Max(), demand[20]);
        Assert.Equal(demand.Min(), demand[3]);
        Assert.All(new[] { 12, 13, 14 }, hour => Assert.True(demand[hour] > demand[11] && demand[hour] > demand[16]));
        // Across a day it averages about 1, so OrdersPerMinute is roughly the day's rate.
        Assert.InRange(demand.Average(), 0.85, 1.05);
    }

    // ---- The world --------------------------------------------------------------------------

    private static CitySimulation Simulation(SimulatorOptions? options = null, int? demoRiderId = null) =>
        new(options ?? new SimulatorOptions { OrdersPerMinute = 0 }, Delhi, demoRiderId);

    private static SimulatedRestaurant Restaurant(int id, string area, GeoPoint at) =>
        new(id, area, at, ["cold-brew", "croissant", "flat-white"]);

    private static SimulationCity CityOf(params GeoPoint[] restaurants) =>
        new([.. restaurants.Select((at, i) => Restaurant(i + 1, $"Area {i + 1}", at))], [101, 102]);

    private static SimulatedRider Rider(int id, GeoPoint at, SimulatedTask? task = null, RiderStatus? status = null) =>
        new(id, status ?? (task is null ? RiderStatus.Available : task.Status == OrderStatus.Assigned ? RiderStatus.Assigned : RiderStatus.Delivering), at, 0, task);

    private static SimulatedTask Job(string code, OrderStatus status, GeoPoint restaurant, GeoPoint drop, DateTimeOffset readyAt, params GeoPoint[] route) =>
        new(code, status, restaurant, drop, route, readyAt, Code);

    private static int? RiderOf(SimAction action) => action switch
    {
        MoveRider a => a.RiderId,
        SetOnline a => a.RiderId,
        ConfirmPickup a => a.RiderId,
        Deliver a => a.RiderId,
        _ => null,
    };

    private static double AngleBetween(double a, double b) => Math.Abs(((a - b) % 360 + 540) % 360 - 180);

    /// <summary>On one of the path's legs: going via the point adds (almost) nothing to the leg.</summary>
    private static bool OnPath(GeoPoint[] path, GeoPoint at) =>
        path.Zip(path.Skip(1)).Any(leg => at.DistanceTo(leg.First) + at.DistanceTo(leg.Second) - leg.First.DistanceTo(leg.Second) < 0.5);

    [GeneratedRegex(@"^[A-M]-\d{1,3}, .+$")]
    private static partial Regex AddressPattern();

    private sealed record Logged(DateTimeOffset At, SimAction Action);

    /// <summary>Plays the server: each tick applies the simulation's actions as the use cases would.</summary>
    private sealed class FakeCity(CitySimulation simulation, SimulationCity city, DateTimeOffset start, params SimulatedRider[] riders)
    {
        /// <summary>DispatchPolicy.ArrivalRadiusMeters: leaving it with the food is "On the way".</summary>
        private const double ArrivalRadiusMeters = 50;

        public Dictionary<int, SimulatedRider> Riders { get; } = riders.ToDictionary(r => r.Id);

        public List<Logged> Log { get; } = [];

        public DateTimeOffset Now { get; private set; } = start;

        public IReadOnlyList<SimAction> Tick(TimeSpan? elapsed = null)
        {
            var step = elapsed ?? TwoSeconds;
            Now += step;
            var actions = simulation.Tick(city, [.. Riders.Values.OrderBy(r => r.Id)], Now, step);
            foreach (var action in actions)
            {
                Log.Add(new Logged(Now, action));
                Apply(action);
            }
            return actions;
        }

        /// <summary>Ticks every 2 s until <paramref name="done"/>, and returns when that was.</summary>
        public DateTimeOffset RunUntil(Func<bool> done, TimeSpan limit)
        {
            var end = Now + limit;
            while (!done())
            {
                Assert.True(Now < end, $"Still waiting after {limit}.");
                Tick();
            }
            return Now;
        }

        private void Apply(SimAction action)
        {
            switch (action)
            {
                case MoveRider move:
                {
                    var rider = Riders[move.RiderId];
                    var task = rider.Task is { Status: OrderStatus.PickedUp } picked && move.To.DistanceTo(picked.Restaurant) > ArrivalRadiusMeters
                        ? picked with { Status = OrderStatus.InTransit }
                        : rider.Task;
                    Riders[move.RiderId] = rider with { Location = move.To, Bearing = move.Bearing, Task = task };
                    break;
                }
                case SetOnline shift:
                {
                    var rider = Riders[shift.RiderId];
                    Assert.Null(rider.Task);
                    Riders[shift.RiderId] = rider with { Status = shift.Online ? RiderStatus.Available : RiderStatus.Offline };
                    break;
                }
                case ConfirmPickup pickup:
                {
                    var rider = Riders[pickup.RiderId];
                    Assert.Equal(OrderStatus.Assigned, rider.Task?.Status);
                    Assert.True(rider.Location.DistanceTo(rider.Task!.Restaurant) <= ArrivalRadiusMeters);
                    Riders[pickup.RiderId] = rider with { Status = RiderStatus.Delivering, Task = rider.Task with { Status = OrderStatus.PickedUp } };
                    break;
                }
                case Deliver deliver:
                {
                    var rider = Riders[deliver.RiderId];
                    Assert.Contains(rider.Task?.Status, new OrderStatus?[] { OrderStatus.PickedUp, OrderStatus.InTransit });
                    Assert.Equal(rider.Task!.DeliveryCode, deliver.Code);
                    Riders[deliver.RiderId] = rider with { Status = RiderStatus.Available, Task = null };
                    break;
                }
            }
        }
    }
}
