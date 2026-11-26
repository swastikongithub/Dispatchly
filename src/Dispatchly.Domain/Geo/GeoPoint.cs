namespace Dispatchly.Domain.Geo;

/// <summary>A WGS 84 position in degrees. Distances are great-circle distances in metres.</summary>
public readonly record struct GeoPoint
{
    /// <summary>Mean Earth radius (IUGG), the same sphere PostGIS uses for geography KNN.</summary>
    public const double EarthRadiusMeters = 6_371_008.8;

    public GeoPoint(double lat, double lng)
    {
        if (double.IsNaN(lat) || lat is < -90 or > 90)
        {
            throw new ArgumentOutOfRangeException(nameof(lat), lat, "Latitude must be between -90 and 90.");
        }
        if (double.IsNaN(lng) || lng is < -180 or > 180)
        {
            throw new ArgumentOutOfRangeException(nameof(lng), lng, "Longitude must be between -180 and 180.");
        }
        Lat = lat;
        Lng = lng;
    }

    public double Lat { get; }
    public double Lng { get; }

    /// <summary>Haversine distance in metres.</summary>
    public double DistanceTo(GeoPoint other)
    {
        var dLat = ToRadians(other.Lat - Lat);
        var dLng = ToRadians(other.Lng - Lng);
        var a = Math.Pow(Math.Sin(dLat / 2), 2)
            + Math.Cos(ToRadians(Lat)) * Math.Cos(ToRadians(other.Lat)) * Math.Pow(Math.Sin(dLng / 2), 2);
        return 2 * EarthRadiusMeters * Math.Asin(Math.Min(1, Math.Sqrt(a)));
    }

    /// <summary>Initial bearing towards <paramref name="other"/>, in degrees clockwise from north (0–360).</summary>
    public double BearingTo(GeoPoint other)
    {
        var lat1 = ToRadians(Lat);
        var lat2 = ToRadians(other.Lat);
        var dLng = ToRadians(other.Lng - Lng);
        var y = Math.Sin(dLng) * Math.Cos(lat2);
        var x = Math.Cos(lat1) * Math.Sin(lat2) - Math.Sin(lat1) * Math.Cos(lat2) * Math.Cos(dLng);
        return (ToDegrees(Math.Atan2(y, x)) + 360) % 360;
    }

    /// <summary>The point <paramref name="meters"/> away along <paramref name="bearing"/> (degrees from north).</summary>
    public GeoPoint Move(double bearing, double meters)
    {
        var angular = meters / EarthRadiusMeters;
        var theta = ToRadians(bearing);
        var lat1 = ToRadians(Lat);
        var lng1 = ToRadians(Lng);
        var lat2 = Math.Asin(Math.Sin(lat1) * Math.Cos(angular) + Math.Cos(lat1) * Math.Sin(angular) * Math.Cos(theta));
        var lng2 = lng1 + Math.Atan2(
            Math.Sin(theta) * Math.Sin(angular) * Math.Cos(lat1),
            Math.Cos(angular) - Math.Sin(lat1) * Math.Sin(lat2));
        return new GeoPoint(ToDegrees(lat2), (ToDegrees(lng2) + 540) % 360 - 180);
    }

    public override string ToString() => FormattableString.Invariant($"{Lat:F6},{Lng:F6}");

    private static double ToRadians(double degrees) => degrees * Math.PI / 180;

    private static double ToDegrees(double radians) => radians * 180 / Math.PI;
}
