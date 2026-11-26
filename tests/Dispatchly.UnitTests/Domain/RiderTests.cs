using Dispatchly.Domain;
using Dispatchly.Domain.Riders;

namespace Dispatchly.UnitTests.Domain;

public sealed class RiderTests
{
    [Fact]
    public void Going_online_makes_a_rider_available_from_now()
    {
        var rider = Build.Rider(online: false);

        rider.GoOnline(Build.Now);

        Assert.Equal(RiderStatus.Available, rider.Status);
        Assert.Equal(Build.Now, rider.OnlineSince);
    }

    [Fact]
    public void A_rider_on_a_task_cant_go_offline()
    {
        var rider = Build.Rider();
        Build.Order().Assign(rider, 1, 600, Build.Policy, Build.Now);

        var error = Assert.Throws<DomainException>(rider.GoOffline);

        Assert.Equal("rider_busy", error.Code);
        Assert.Equal(RiderStatus.Assigned, rider.Status);
    }

    [Fact]
    public void Without_a_bearing_the_heading_follows_the_direction_of_travel()
    {
        var rider = Build.Rider(at: Build.KhanMarket);

        rider.MoveTo(Build.KhanMarket.Move(135, 200), null, Build.Now);
        Assert.Equal(135, rider.Bearing, 0.1);

        rider.MoveTo(rider.Location, -90, Build.Now);
        Assert.Equal(270, rider.Bearing);
    }

    [Fact]
    public void The_first_name_is_used_in_sentences()
    {
        Assert.Equal("Aman", Build.Rider().FirstName);
    }
}
