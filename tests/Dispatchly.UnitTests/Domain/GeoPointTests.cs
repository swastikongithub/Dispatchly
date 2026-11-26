using Dispatchly.Domain.Geo;

namespace Dispatchly.UnitTests.Domain;

public sealed class GeoPointTests
{
    [Fact]
    public void One_degree_of_latitude_is_about_111_km()
    {
        var distance = new GeoPoint(28, 77).DistanceTo(new GeoPoint(29, 77));

        Assert.InRange(distance, 111_150, 111_250);
    }

    [Fact]
    public void Khan_Market_to_Lajpat_Nagar_II_is_about_4_km()
    {
        Assert.InRange(Build.KhanMarket.DistanceTo(Build.LajpatNagar), 3_800, 4_000);
    }

    [Theory]
    [InlineData(0)]
    [InlineData(90)]
    [InlineData(200)]
    [InlineData(315)]
    public void Moving_along_a_bearing_lands_that_far_away_in_that_direction(double bearing)
    {
        var start = Build.KhanMarket;

        var end = start.Move(bearing, 1_500);

        Assert.Equal(1_500, start.DistanceTo(end), 0.5);
        var angleBetween = Math.Abs((start.BearingTo(end) - bearing + 540) % 360 - 180);
        Assert.InRange(angleBetween, 0, 0.1);
    }

    [Theory]
    [InlineData(91, 77)]
    [InlineData(28, 181)]
    [InlineData(double.NaN, 77)]
    public void Rejects_coordinates_outside_the_globe(double lat, double lng)
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => new GeoPoint(lat, lng));
    }
}
