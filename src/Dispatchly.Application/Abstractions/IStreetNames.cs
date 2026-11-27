using Dispatchly.Domain.Geo;

namespace Dispatchly.Application.Abstractions;

/// <summary>
/// Names the street at a point, for the tracking page's "…and is riding down Mathura Road"
/// (PLAN.md §5.3). The Infrastructure layer loads the streets from OpenStreetMap data.
/// </summary>
public interface IStreetNames
{
    /// <summary>The nearest named main road, or null when none is close enough to say so.</summary>
    string? Near(GeoPoint point);
}
