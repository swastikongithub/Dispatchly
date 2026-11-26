using System.Globalization;
using Dispatchly.Application;
using Dispatchly.Domain.Geo;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Dispatchly.Api.Controllers;

[ApiController]
[Route("api/v1/restaurants")]
[Authorize(Roles = nameof(Role.Customer))]
public sealed class RestaurantsController(RestaurantQueries restaurants) : ControllerBase
{
    /// <summary>The nearest restaurants to <paramref name="near"/> ("lat,lng"), closest first, with their menus.</summary>
    [HttpGet]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<IReadOnlyList<NearbyRestaurant>>> Near([FromQuery] string near, CancellationToken ct)
    {
        if (!TryParse(near, out var point))
        {
            ModelState.AddModelError(nameof(near), "Use \"lat,lng\" in degrees, e.g. 28.6315,77.2167.");
            return ValidationProblem(ModelState);
        }
        return Ok(await restaurants.NearAsync(point, ct));
    }

    private static bool TryParse(string? value, out GeoPoint point)
    {
        point = default;
        var parts = value?.Split(',', StringSplitOptions.TrimEntries);
        if (parts is not [var lat, var lng]
            || !double.TryParse(lat, NumberStyles.Float, CultureInfo.InvariantCulture, out var latitude)
            || !double.TryParse(lng, NumberStyles.Float, CultureInfo.InvariantCulture, out var longitude)
            || latitude is < -90 or > 90 || longitude is < -180 or > 180)
        {
            return false;
        }
        point = new GeoPoint(latitude, longitude);
        return true;
    }
}

[ApiController]
[Route("api/v1/stats")]
[Authorize(Roles = nameof(Role.Dispatcher))]
public sealed class StatsController(StatsQueries stats) : ControllerBase
{
    /// <summary>The dashboard's top-bar stats: riders online, active orders, average delivery, running late.</summary>
    [HttpGet("live")]
    public Task<LiveStats> Live(CancellationToken ct) => stats.LiveAsync(ct);
}
