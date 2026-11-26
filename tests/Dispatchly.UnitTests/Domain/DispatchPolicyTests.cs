using Dispatchly.Domain.Dispatch;

namespace Dispatchly.UnitTests.Domain;

public sealed class DispatchPolicyTests
{
    private static readonly DispatchPolicy Policy = new();
    private static readonly DateTimeOffset Shown = Build.Now.AddMinutes(20);

    [Fact]
    public void The_search_widens_from_1_5_to_3_to_5_km_and_stays_there()
    {
        Assert.Equal(1_500, Policy.FirstRadius);
        Assert.Equal(3_000, Policy.NextRadius(1_500));
        Assert.Equal(5_000, Policy.NextRadius(3_000));
        Assert.Equal(5_000, Policy.NextRadius(5_000));
    }

    [Theory]
    [InlineData(0, 3_000)]
    [InlineData(3_000, 4_800)]
    [InlineData(4_100, 5_500)]
    [InlineData(4_150, 5_500)]
    public void Rider_pay_is_a_base_plus_a_rate_per_km_in_whole_rupees(double meters, int paise)
    {
        Assert.Equal(paise, Policy.RiderPayPaise(meters));
    }

    [Fact]
    public void Travel_time_uses_the_average_speed()
    {
        Assert.Equal(TimeSpan.FromMinutes(10), Policy.Travel(3_000));
    }

    [Fact]
    public void The_first_estimate_is_shown_as_it_is()
    {
        Assert.Equal(Shown, Policy.SmoothEta(null, Shown));
    }

    [Theory]
    [InlineData(2.5, 1)]
    [InlineData(-2.5, -1)]
    [InlineData(0.5, 0.5)]
    [InlineData(-3, -1)]
    public void Small_changes_move_the_eta_at_most_a_minute_per_update(double change, double moved)
    {
        Assert.Equal(Shown.AddMinutes(moved), Policy.SmoothEta(Shown, Shown.AddMinutes(change)));
    }

    [Theory]
    [InlineData(3.5)]
    [InlineData(-8)]
    public void Changes_over_3_minutes_jump_straight_to_the_new_estimate(double change)
    {
        Assert.Equal(Shown.AddMinutes(change), Policy.SmoothEta(Shown, Shown.AddMinutes(change)));
    }
}
