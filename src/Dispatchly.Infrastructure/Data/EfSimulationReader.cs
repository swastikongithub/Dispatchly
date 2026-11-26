using Dispatchly.Application.Abstractions;
using Dispatchly.Domain.Orders;
using Microsoft.EntityFrameworkCore;

namespace Dispatchly.Infrastructure.Data;

/// <summary>What the city simulator sees. Read only: it changes things through the use cases.</summary>
internal sealed class EfSimulationReader(DispatchlyDbContext db) : ISimulationReader
{
    public async Task<SimulationCity> CityAsync(CancellationToken ct)
    {
        var restaurants = await db.Restaurants.AsNoTracking().OrderBy(r => r.Id).ToListAsync(ct);
        var customers = await db.Customers.OrderBy(c => c.Id).Select(c => c.Id).ToListAsync(ct);
        return new SimulationCity(
            [.. restaurants.Select(r => new SimulatedRestaurant(r.Id, r.Area, r.Location, [.. r.Menu.Select(m => m.Id)]))],
            customers);
    }

    public async Task<IReadOnlyList<SimulatedRider>> RidersAsync(CancellationToken ct)
    {
        var riders = await db.Riders.AsNoTracking().OrderBy(r => r.Id).ToListAsync(ct);
        var tasks = await db.Orders
            .AsNoTracking()
            .Where(o => o.RiderId != null && o.Status != OrderStatus.Delivered && o.Status != OrderStatus.Cancelled)
            .Include(o => o.Restaurant)
            .ToDictionaryAsync(o => o.RiderId!.Value, ct);
        return
        [
            .. riders.Select(r => new SimulatedRider(
                r.Id,
                r.Status,
                r.Location,
                r.Bearing,
                tasks.TryGetValue(r.Id, out var o)
                    ? new SimulatedTask(o.Code, o.Status, o.Restaurant.Location, o.DropLocation, o.Route, o.ReadyAt, o.DeliveryCode)
                    : null)),
        ];
    }
}
