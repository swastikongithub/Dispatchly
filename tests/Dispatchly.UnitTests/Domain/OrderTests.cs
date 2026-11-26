using Dispatchly.Domain;
using Dispatchly.Domain.Orders;
using Dispatchly.Domain.Riders;

namespace Dispatchly.UnitTests.Domain;

public sealed class OrderTests
{
    private static readonly DateTimeOffset Now = Build.Now;

    [Fact]
    public void A_placed_order_is_searching_within_1_5_km_and_priced_on_the_server()
    {
        var order = Build.Order();

        Assert.Equal("DL-4817", order.Code);
        Assert.Equal(OrderStatus.Searching, order.Status);
        Assert.Equal(1_500, order.SearchRadiusMeters);
        Assert.Equal(64_000, order.TotalPaise);
        Assert.Equal(Now.AddMinutes(12), order.ReadyAt);
        Assert.Equal([Build.KhanMarket, Build.LajpatNagar], order.Route);
        Assert.Equal(order.ReadyAt + Build.Policy.Travel(order.DistanceMeters) + Build.Policy.PromiseBuffer, order.PromisedBy);
        Assert.False(order.IsLate);
        Assert.Equal(OrderEventType.Placed, Assert.Single(order.Events).Type);
    }

    [Fact]
    public void An_order_needs_at_least_one_line_with_a_sensible_quantity()
    {
        var restaurant = Build.Restaurant();
        var drop = new OrderDrop(Build.LajpatNagar, "B-14", "Lajpat Nagar II", null);

        var empty = Assert.Throws<DomainException>(() => Order.Place(
            1, restaurant, Build.Customer(), [], drop, PaymentMethod.Cash, "1234", Build.Policy, Now));
        var tooMany = Assert.Throws<DomainException>(() => Order.Place(
            1, restaurant, Build.Customer(), [OrderItem.From(restaurant.Menu[0], 21)], drop, PaymentMethod.Cash, "1234", Build.Policy, Now));

        Assert.Equal("invalid_items", empty.Code);
        Assert.Equal("invalid_items", tooMany.Code);
    }

    [Fact]
    public void A_drop_more_than_8_km_from_the_restaurant_is_refused()
    {
        var restaurant = Build.Restaurant();
        var farAway = new OrderDrop(Build.KhanMarket.Move(0, 8_100), "Somewhere", "Rohini", null);

        var error = Assert.Throws<DomainException>(() => Order.Place(
            1, restaurant, Build.Customer(), [OrderItem.From(restaurant.Menu[0], 1)], farAway, PaymentMethod.Cash, "1234", Build.Policy, Now));

        Assert.Equal("drop_too_far", error.Code);
    }

    [Fact]
    public void The_search_widens_with_the_orders_age_and_never_narrows()
    {
        var order = Build.Order();

        order.WidenSearch(Build.Policy, Now.AddSeconds(6));
        Assert.Equal(3_000, order.SearchRadiusMeters);

        order.WidenSearch(Build.Policy, Now.AddSeconds(1));
        Assert.Equal(3_000, order.SearchRadiusMeters);
    }

    [Fact]
    public void Assigning_records_how_many_riders_were_free_and_how_far_the_chosen_one_was()
    {
        var order = Build.Order();
        var rider = Build.Rider();

        order.Assign(rider, freeRiders: 4, distanceMeters: 612.4, Build.Policy, Now);

        Assert.Equal(OrderStatus.Assigned, order.Status);
        Assert.Equal(RiderStatus.Assigned, rider.Status);
        Assert.Same(rider, order.Rider);
        Assert.Equal(Now, order.AssignedAt);
        var assigned = order.Events[^1];
        Assert.Equal(OrderEventType.Assigned, assigned.Type);
        Assert.Equal(4, assigned.Data.FreeRiders);
        Assert.Equal(612, assigned.Data.DistanceMeters);
        Assert.Equal("Aman Verma", assigned.Data.RiderName);
    }

    [Fact]
    public void A_rider_who_isnt_available_cant_be_assigned()
    {
        var busy = Build.Rider();
        Build.Order().Assign(busy, 1, 100, Build.Policy, Now);

        var second = Assert.Throws<DomainException>(() => Build.Order().Assign(busy, 1, 100, Build.Policy, Now));
        var offline = Assert.Throws<DomainException>(() => Build.Order().Assign(Build.Rider(online: false), 1, 100, Build.Policy, Now));

        Assert.Equal("rider_not_available", second.Code);
        Assert.Equal("rider_not_available", offline.Code);
    }

    [Fact]
    public void An_order_goes_from_restaurant_to_door_and_frees_its_rider()
    {
        var order = Build.Order();
        var rider = Build.Rider();
        order.Assign(rider, 1, 600, Build.Policy, Now);

        rider.MoveTo(Build.KhanMarket.Move(90, 20), null, Now.AddMinutes(3));
        order.RiderMoved(Build.Policy, Now.AddMinutes(3));
        Assert.Equal(RiderStatus.AtRestaurant, rider.Status);

        order.ConfirmPickup(Build.Policy, Now.AddMinutes(12));
        Assert.Equal((OrderStatus.PickedUp, RiderStatus.Delivering), (order.Status, rider.Status));

        rider.MoveTo(Build.KhanMarket.Move(160, 400), null, Now.AddMinutes(14));
        order.RiderMoved(Build.Policy, Now.AddMinutes(14));
        Assert.Equal(OrderStatus.InTransit, order.Status);

        order.Deliver("4821", Now.AddMinutes(24));
        Assert.Equal((OrderStatus.Delivered, RiderStatus.Available), (order.Status, rider.Status));
        Assert.Equal(Now.AddMinutes(24), order.DeliveredAt);
        Assert.Equal(
            [
                OrderEventType.Placed, OrderEventType.Assigned, OrderEventType.ArrivedAtRestaurant,
                OrderEventType.PickedUp, OrderEventType.OnTheWay, OrderEventType.Delivered,
            ],
            order.Events.Select(e => e.Type));
    }

    [Fact]
    public void A_wrong_delivery_code_changes_nothing()
    {
        var order = Build.Order();
        var rider = Build.Rider();
        order.Assign(rider, 1, 600, Build.Policy, Now);
        order.ConfirmPickup(Build.Policy, Now.AddMinutes(12));

        var error = Assert.Throws<DomainException>(() => order.Deliver("1234", Now.AddMinutes(20)));

        Assert.Equal("wrong_delivery_code", error.Code);
        Assert.Equal((OrderStatus.PickedUp, RiderStatus.Delivering), (order.Status, rider.Status));
    }

    [Fact]
    public void An_order_cant_be_delivered_before_pickup()
    {
        var order = Build.Order();
        order.Assign(Build.Rider(), 1, 600, Build.Policy, Now);

        var error = Assert.Throws<DomainException>(() => order.Deliver("4821", Now));

        Assert.Equal("order_not_picked_up", error.Code);
    }

    [Fact]
    public void Reassigning_hands_the_order_over_and_frees_the_previous_rider()
    {
        var order = Build.Order();
        var aman = Build.Rider();
        var ritika = Build.Rider("Ritika Sharma");
        order.Assign(aman, 3, 600, Build.Policy, Now);

        order.Reassign(ritika, 2, 900, Build.Policy, Now.AddMinutes(1));

        Assert.Same(ritika, order.Rider);
        Assert.Equal((RiderStatus.Available, RiderStatus.Assigned), (aman.Status, ritika.Status));
        var reassigned = order.Events[^1];
        Assert.Equal(OrderEventType.Reassigned, reassigned.Type);
        Assert.Equal(("Ritika Sharma", "Aman Verma"), (reassigned.Data.RiderName, reassigned.Data.PreviousRiderName));
    }

    [Fact]
    public void A_picked_up_order_cant_be_reassigned()
    {
        var order = Build.Order();
        order.Assign(Build.Rider(), 1, 600, Build.Policy, Now);
        order.ConfirmPickup(Build.Policy, Now.AddMinutes(12));

        var error = Assert.Throws<DomainException>(() => order.Reassign(Build.Rider("Imran Ali"), 1, 300, Build.Policy, Now));

        Assert.Equal("order_wrong_status", error.Code);
    }

    [Fact]
    public void Running_late_is_derived_from_the_eta_and_the_promise()
    {
        var order = Build.Order();
        var rider = Build.Rider(at: Build.KhanMarket.Move(0, 4_000));
        order.Assign(rider, 1, 4_000, Build.Policy, Now);
        order.ConfirmPickup(Build.Policy, Now.AddMinutes(40));

        // Far from the drop well after the promise: the smoothed ETA jumps past it.
        rider.MoveTo(Build.KhanMarket.Move(0, 3_000), null, Now.AddMinutes(40));
        order.RiderMoved(Build.Policy, Now.AddMinutes(40));

        Assert.True(order.IsLate);
        Assert.Equal((int)Math.Ceiling((order.EstimatedDeliveryAt - order.PromisedBy).TotalMinutes), order.MinutesLate);
    }

    [Theory]
    [InlineData("DL-4817", true)]
    [InlineData("DL-12345", true)]
    [InlineData("DL-", false)]
    [InlineData("dl-4817", false)]
    [InlineData("DL-48a7", false)]
    public void Order_codes_are_DL_and_digits(string code, bool valid)
    {
        Assert.Equal(valid, OrderCode.IsValid(code));
    }
}
