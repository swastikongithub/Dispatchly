using System.Text.Json;
using Dispatchly.Application.Streets;
using Dispatchly.Domain.Geo;

namespace Dispatchly.Infrastructure.Streets;

/// <summary>
/// Central Delhi's named main roads, fetched from OpenStreetMap by
/// <c>tools/fetch-delhi-streets.mjs</c> and embedded in this assembly. The data is
/// © OpenStreetMap contributors under the ODbL; the maps credit OpenStreetMap.
/// </summary>
public static class StreetData
{
    private const string Resource = "Dispatchly.Infrastructure.Streets.delhi-streets.json";

    /// <summary>Reads the embedded streets into an index (about 5,000 lines, a fraction of a second).</summary>
    public static StreetIndex Load()
    {
        using var stream = typeof(StreetData).Assembly.GetManifestResourceStream(Resource)
            ?? throw new InvalidOperationException($"The street data '{Resource}' isn't embedded.");
        using var document = JsonDocument.Parse(stream);

        var streets = new List<Street>();
        foreach (var street in document.RootElement.GetProperty("streets").EnumerateObject())
        {
            // Each line is a flat [lat, lng, lat, lng, …] array.
            foreach (var line in street.Value.EnumerateArray())
            {
                var values = line.EnumerateArray().Select(v => v.GetDouble()).ToArray();
                var points = new GeoPoint[values.Length / 2];
                for (var i = 0; i < points.Length; i++)
                {
                    points[i] = new GeoPoint(values[2 * i], values[2 * i + 1]);
                }
                streets.Add(new Street(street.Name, points));
            }
        }
        return new StreetIndex(streets);
    }
}
