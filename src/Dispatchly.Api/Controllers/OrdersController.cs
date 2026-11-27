using Dispatchly.Api.Auth;
using Dispatchly.Application;
using Dispatchly.Application.Orders;
using Dispatchly.Domain.Orders;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Dispatchly.Api.Controllers;

[ApiController]
[Route("api/v1/orders")]
public sealed class OrdersController(OrderService orders) : ControllerBase
{
    /// <summary>The order queue: Needs rider first, then Running late, then by ETA.</summary>
    [HttpGet]
    [Authorize(Roles = nameof(Role.Dispatcher))]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public Task<IReadOnlyList<OrderSummary>> Queue(OrderStatus? status, bool? late, CancellationToken ct) =>
        orders.QueueAsync(status, late, ct);

    /// <summary>One order with its rider, route and timeline. Customers see only their own.</summary>
    [HttpGet("{code}")]
    [Authorize(Roles = $"{nameof(Role.Dispatcher)},{nameof(Role.Customer)}")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public Task<OrderDetails> Get(string code, CancellationToken ct) =>
        orders.GetAsync(code, User.ToViewer(), ct);

    /// <summary>Places an order; the nearest free rider is looked for straight away.</summary>
    [HttpPost]
    [Authorize(Roles = nameof(Role.Customer))]
    [ProducesResponseType(StatusCodes.Status201Created)]
    [ProducesResponseType(StatusCodes.Status400BadRequest)]
    public async Task<ActionResult<OrderDetails>> Place(PlaceOrderRequest request, CancellationToken ct)
    {
        var order = await orders.PlaceAsync(User.CustomerId(), request, ct);
        return CreatedAtAction(nameof(Get), new { code = order.Code }, order);
    }

    /// <summary>The 3 nearest free riders a reassignment would choose from, with their distance from the restaurant.</summary>
    [HttpGet("{code}/reassign/candidates")]
    [Authorize(Roles = nameof(Role.Dispatcher))]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public Task<IReadOnlyList<ReassignCandidate>> ReassignCandidates(string code, CancellationToken ct) =>
        orders.ReassignCandidatesAsync(code, ct);

    /// <summary>Sends an order that hasn't been picked up to the next nearest free rider.</summary>
    [HttpPost("{code}/reassign")]
    [Authorize(Roles = nameof(Role.Dispatcher))]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public Task<OrderDetails> Reassign(string code, CancellationToken ct) =>
        orders.ReassignAsync(code, ct);
}
