using System.Globalization;
using System.Security.Cryptography;
using Dispatchly.Application.Abstractions;
using Dispatchly.Domain.Dispatch;
using Dispatchly.Domain.Geo;
using Dispatchly.Domain.Orders;

namespace Dispatchly.Application.Orders;

public sealed class OrderService(
    IDispatchStore store,
    IDispatchReader reader,
    AssignmentService assignment,
    ILiveEvents live,
    DispatchPolicy policy,
    TimeProvider clock)
{
    /// <summary>
    /// Places an order (status Searching) and makes the first assignment attempt straight away, so
    /// concurrent orders race for riders through the locked assignment path (§3.5). Returns the
    /// order as it stands after that attempt: Assigned, or still Searching for the retry worker.
    /// </summary>
    public async Task<OrderDetails> PlaceAsync(int customerId, PlaceOrderRequest request, CancellationToken ct)
    {
        var customer = await store.FindCustomerAsync(customerId, ct)
            ?? throw new NotFoundException($"Customer {customerId} not found.");
        var restaurant = await store.FindRestaurantAsync(request.RestaurantId, ct)
            ?? throw new InvalidRequestException("unknown_restaurant", $"Restaurant {request.RestaurantId} doesn't exist.");

        // Prices come from the menu on the server, never from the client.
        var items = request.Items
            .Select(line =>
            {
                var item = restaurant.Menu.FirstOrDefault(m => m.Id == line.MenuItemId)
                    ?? throw new InvalidRequestException("unknown_menu_item", $"{restaurant.Name} has no menu item '{line.MenuItemId}'.");
                return OrderItem.From(item, line.Quantity);
            })
            .ToList();
        var drop = new OrderDrop(
            new GeoPoint(request.Drop.Lat, request.Drop.Lng),
            request.Drop.Address.Trim(),
            request.Drop.Area.Trim(),
            string.IsNullOrWhiteSpace(request.Drop.Label) ? null : request.Drop.Label.Trim());
        var deliveryCode = RandomNumberGenerator.GetInt32(0, 10_000).ToString("D4", CultureInfo.InvariantCulture);

        var number = await store.NextOrderNumberAsync(ct);
        var order = Order.Place(number, restaurant, customer, items, drop, request.Payment, deliveryCode, policy, clock.GetUtcNow());
        store.Add(order);
        await store.SaveChangesAsync(ct);
        await live.OrderChangedAsync(order, ct);

        await assignment.TryAssignAsync(order.Id, ct);
        return await GetAsync(order.Code, new Viewer(Role.Customer, CustomerId: customerId), ct);
    }

    public async Task<OrderDetails> ReassignAsync(string code, CancellationToken ct)
    {
        await assignment.ReassignAsync(code, ct);
        return await GetAsync(code, new Viewer(Role.Dispatcher), ct);
    }

    /// <summary>How many riders the Reassign popover lists (PLAN.md §5.2).</summary>
    public const int ReassignCandidateCount = 3;

    /// <summary>
    /// The free riders a reassignment would choose from, nearest to the restaurant first: the same
    /// search as <see cref="ReassignAsync"/>, without locking anyone.
    /// </summary>
    public async Task<IReadOnlyList<ReassignCandidate>> ReassignCandidatesAsync(string code, CancellationToken ct)
    {
        var order = (OrderCode.IsValid(code) ? await reader.OrderAsync(code, ct) : null)
            ?? throw new NotFoundException($"Order {code} not found.");
        if (order.Status != OrderStatus.Assigned)
        {
            throw new ConflictException(
                "order_not_reassignable",
                $"Order {code} is {order.Status}; only an assigned order that hasn't been picked up can be reassigned.");
        }
        var riders = await reader.NearestAvailableRidersAsync(
            order.Restaurant.Location, policy.MaxRadius, order.RiderId, ReassignCandidateCount, ct);
        return [.. riders.Select(c => c.Rider.ToCandidate(c.DistanceMeters))];
    }

    /// <summary>One order for its customer or a dispatcher. Anyone else gets 404, so codes can't be probed.</summary>
    public async Task<OrderDetails> GetAsync(string code, Viewer viewer, CancellationToken ct)
    {
        var order = OrderCode.IsValid(code) ? await reader.OrderAsync(code, ct) : null;
        var allowed = viewer.Role == Role.Dispatcher
            || (viewer.Role == Role.Customer && order?.CustomerId == viewer.CustomerId);
        if (order is null || !allowed)
        {
            throw new NotFoundException($"Order {code} not found.");
        }
        return order.ToDetails(viewer);
    }

    /// <summary>The dispatcher's queue: Needs rider first, then Running late, then by ETA (PLAN.md §5.2).</summary>
    public async Task<IReadOnlyList<OrderSummary>> QueueAsync(OrderStatus? status, bool? late, CancellationToken ct)
    {
        var orders = await reader.ActiveOrdersAsync(status, late, ct);
        return [.. OrderQueue.Sort(orders).Select(o => o.ToSummary())];
    }
}

internal static class OrderQueue
{
    /// <summary>Queue order (PLAN.md §5.2): Needs rider first, then Running late, then by ETA.</summary>
    public static IEnumerable<Order> Sort(IEnumerable<Order> orders) =>
        orders
            .OrderBy(o => o.Status == OrderStatus.Searching ? 0 : o.IsLate ? 1 : 2)
            .ThenBy(o => o.Status == OrderStatus.Searching ? o.CreatedAt : o.EstimatedDeliveryAt);
}
