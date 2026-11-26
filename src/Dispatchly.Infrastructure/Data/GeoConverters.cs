using Dispatchly.Domain.Geo;
using Microsoft.EntityFrameworkCore.ChangeTracking;
using Microsoft.EntityFrameworkCore.Storage.ValueConversion;
using NetTopologySuite.Geometries;

namespace Dispatchly.Infrastructure.Data;

/// <summary>Domain <see cref="GeoPoint"/> ↔ PostGIS geography point (x = longitude, y = latitude, SRID 4326).</summary>
internal sealed class GeoPointConverter() : ValueConverter<GeoPoint, Point>(
    point => new Point(point.Lng, point.Lat) { SRID = 4326 },
    point => new GeoPoint(point.Y, point.X));

/// <summary>An ordered list of positions ↔ PostGIS geography linestring.</summary>
internal sealed class RouteConverter() : ValueConverter<IReadOnlyList<GeoPoint>, LineString>(
    route => ToLineString(route),
    line => FromLineString(line))
{
    private static LineString ToLineString(IReadOnlyList<GeoPoint> route) =>
        new([.. route.Select(p => new Coordinate(p.Lng, p.Lat))]) { SRID = 4326 };

    private static IReadOnlyList<GeoPoint> FromLineString(LineString line) =>
        [.. line.Coordinates.Select(c => new GeoPoint(c.Y, c.X))];
}

internal sealed class RouteComparer() : ValueComparer<IReadOnlyList<GeoPoint>>(
    (a, b) => a == null ? b == null : b != null && a.SequenceEqual(b),
    route => route.Aggregate(0, (hash, point) => HashCode.Combine(hash, point)),
    route => route.ToArray());
