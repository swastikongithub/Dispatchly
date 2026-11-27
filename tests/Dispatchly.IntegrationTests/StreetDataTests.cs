using Dispatchly.Application.Streets;
using Dispatchly.Domain.Geo;
using Dispatchly.Infrastructure.Streets;

namespace Dispatchly.IntegrationTests;

/// <summary>The embedded OpenStreetMap streets name real central Delhi roads (no database needed).</summary>
public sealed class StreetDataTests
{
    private static readonly Lazy<StreetIndex> Streets = new(StreetData.Load);

    [Theory]
    [InlineData(28.592765, 77.244095, "Mathura Road")] // by Sundar Nagar
    [InlineData(28.5908, 77.226315, "Lodhi Road")]
    [InlineData(28.6003, 77.227, "Subramaniyam Bharti Marg")] // by Khan Market
    public void Names_the_road_at_a_point(double lat, double lng, string street)
    {
        Assert.Equal(street, Streets.Value.Near(new GeoPoint(lat, lng)));
    }

    [Fact]
    public void Names_nothing_outside_the_city()
    {
        Assert.Null(Streets.Value.Near(new GeoPoint(28.0, 77.0)));
    }
}
