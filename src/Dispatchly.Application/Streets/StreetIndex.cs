using Dispatchly.Application.Abstractions;
using Dispatchly.Domain.Geo;

namespace Dispatchly.Application.Streets;

/// <summary>A named road as a line of points; one street can be several of these.</summary>
public sealed record Street(string Name, IReadOnlyList<GeoPoint> Line);

/// <summary>
/// Names the street at a point: the nearest named road within <see cref="MaxMeters"/>. Road
/// segments sit in a grid of <see cref="MaxMeters"/> cells on a local flat projection in metres,
/// so a lookup only measures the segments in the 3 × 3 cells around the point. Built once,
/// read from many threads.
/// </summary>
public sealed class StreetIndex : IStreetNames
{
    /// <summary>Farther than this from every road, the rider isn't said to be on one.</summary>
    public const double MaxMeters = 250;

    private const double MetersPerDegreeLat = 110_574;
    private const double MetersPerDegreeLngAtEquator = 111_320;

    private readonly double _metersPerDegreeLng;
    private readonly Dictionary<(int X, int Y), List<Segment>> _cells = [];

    public StreetIndex(IEnumerable<Street> streets)
    {
        var lines = streets.Where(s => s.Line.Count >= 2).ToList();
        // A city is small enough for one scale across it: the scale at its mean latitude.
        var points = lines.SelectMany(s => s.Line).ToList();
        var lat0 = points.Count > 0 ? points.Average(p => p.Lat) : 0;
        _metersPerDegreeLng = MetersPerDegreeLngAtEquator * Math.Cos(lat0 * Math.PI / 180);

        foreach (var street in lines)
        {
            for (var i = 1; i < street.Line.Count; i++)
            {
                Add(new Segment(street.Name, Project(street.Line[i - 1]), Project(street.Line[i])));
            }
        }
    }

    public string? Near(GeoPoint point)
    {
        var p = Project(point);
        var (cx, cy) = Cell(p);
        string? name = null;
        var best = MaxMeters;
        for (var x = cx - 1; x <= cx + 1; x++)
        {
            for (var y = cy - 1; y <= cy + 1; y++)
            {
                if (!_cells.TryGetValue((x, y), out var segments))
                {
                    continue;
                }
                foreach (var segment in segments)
                {
                    var distance = segment.DistanceTo(p);
                    if (distance <= best)
                    {
                        best = distance;
                        name = segment.Name;
                    }
                }
            }
        }
        return name;
    }

    /// <summary>Files the segment under every cell its bounding box touches.</summary>
    private void Add(Segment segment)
    {
        var (x0, y0) = Cell(new Vector(Math.Min(segment.A.X, segment.B.X), Math.Min(segment.A.Y, segment.B.Y)));
        var (x1, y1) = Cell(new Vector(Math.Max(segment.A.X, segment.B.X), Math.Max(segment.A.Y, segment.B.Y)));
        for (var x = x0; x <= x1; x++)
        {
            for (var y = y0; y <= y1; y++)
            {
                if (!_cells.TryGetValue((x, y), out var segments))
                {
                    _cells[(x, y)] = segments = [];
                }
                segments.Add(segment);
            }
        }
    }

    private Vector Project(GeoPoint point) => new(point.Lng * _metersPerDegreeLng, point.Lat * MetersPerDegreeLat);

    private static (int X, int Y) Cell(Vector p) => ((int)Math.Floor(p.X / MaxMeters), (int)Math.Floor(p.Y / MaxMeters));

    private readonly record struct Vector(double X, double Y);

    private sealed record Segment(string Name, Vector A, Vector B)
    {
        public double DistanceTo(Vector p)
        {
            var dx = B.X - A.X;
            var dy = B.Y - A.Y;
            var length2 = dx * dx + dy * dy;
            var t = length2 == 0 ? 0 : Math.Clamp(((p.X - A.X) * dx + (p.Y - A.Y) * dy) / length2, 0, 1);
            return Math.Sqrt(Math.Pow(p.X - (A.X + t * dx), 2) + Math.Pow(p.Y - (A.Y + t * dy), 2));
        }
    }
}
