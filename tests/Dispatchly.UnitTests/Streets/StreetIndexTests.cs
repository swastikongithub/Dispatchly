using Dispatchly.Application.Streets;
using Dispatchly.Domain.Geo;

namespace Dispatchly.UnitTests.Streets;

/// <summary>Naming the street a rider is on: the nearest named road within <see cref="StreetIndex.MaxMeters"/>.</summary>
public sealed class StreetIndexTests
{
    private static readonly GeoPoint Origin = new(28.6, 77.2);

    /// <summary>A straight street starting <paramref name="north"/> metres north of the origin and running <paramref name="length"/> metres east.</summary>
    private static Street EastWard(string name, double north, double length = 1_000)
    {
        var start = Origin.Move(0, north);
        return new Street(name, [start, start.Move(90, length)]);
    }

    [Fact]
    public void Names_the_nearest_street()
    {
        var index = new StreetIndex([EastWard("Lodhi Road", north: 40), EastWard("Mathura Road", north: -120)]);

        Assert.Equal("Lodhi Road", index.Near(Origin.Move(90, 500)));
        Assert.Equal("Mathura Road", index.Near(Origin.Move(90, 500).Move(180, 90)));
    }

    [Fact]
    public void Measures_to_the_road_between_its_points_not_only_to_its_points()
    {
        // The nearest point, 2 km away along the street, is far; the road itself passes 30 m away.
        var index = new StreetIndex([EastWard("Ring Road", north: 30, length: 4_000), EastWard("Janpath", north: -200, length: 10)]);

        Assert.Equal("Ring Road", index.Near(Origin.Move(90, 2_000)));
    }

    [Fact]
    public void Follows_a_street_through_its_bends()
    {
        var corner = Origin.Move(90, 600);
        var index = new StreetIndex([new Street("Aurobindo Marg", [Origin, corner, corner.Move(0, 600)])]);

        Assert.Equal("Aurobindo Marg", index.Near(corner.Move(0, 300).Move(270, 50)));
    }

    [Fact]
    public void Names_nothing_when_no_street_is_close_enough()
    {
        var index = new StreetIndex([EastWard("Lodhi Road", north: StreetIndex.MaxMeters + 30)]);

        Assert.Null(index.Near(Origin.Move(90, 500)));
        Assert.Null(new StreetIndex([]).Near(Origin));
    }

    [Fact]
    public void Names_a_street_just_within_reach()
    {
        var index = new StreetIndex([EastWard("Lodhi Road", north: StreetIndex.MaxMeters - 5)]);

        Assert.Equal("Lodhi Road", index.Near(Origin.Move(90, 500)));
    }
}
