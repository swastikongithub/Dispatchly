using Dispatchly.Api.Auth;
using Dispatchly.Application;
using Dispatchly.Application.Riders;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Dispatchly.Api.Controllers;

/// <summary>The rider app. Every call acts as the signed-in rider.</summary>
[ApiController]
[Route("api/v1/rider")]
[Authorize(Roles = nameof(Role.Rider))]
public sealed class RiderController(RiderService riders) : ControllerBase
{
    /// <summary>Go online or offline. A rider on a task can't go offline.</summary>
    [HttpPut("status")]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public Task<RiderTaskView> SetStatus(RiderStatusRequest request, CancellationToken ct) =>
        riders.SetOnlineAsync(User.RiderId(), request.Online, ct);

    /// <summary>The rider's day and current task, or no task.</summary>
    [HttpGet("task")]
    public Task<RiderTaskView> Task(CancellationToken ct) =>
        riders.GetTaskAsync(User.RiderId(), ct);

    [HttpPost("task/pickup")]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    public Task<RiderTaskView> ConfirmPickup(CancellationToken ct) =>
        riders.ConfirmPickupAsync(User.RiderId(), ct);

    /// <summary>Completes the delivery with the customer's code. A wrong code is 422 and changes nothing.</summary>
    [HttpPost("task/deliver")]
    [ProducesResponseType(StatusCodes.Status409Conflict)]
    [ProducesResponseType(StatusCodes.Status422UnprocessableEntity)]
    public Task<DeliveryResult> Deliver(DeliverRequest request, CancellationToken ct) =>
        riders.DeliverAsync(User.RiderId(), request.Code, ct);

    /// <summary>A GPS position from the mobile app.</summary>
    [HttpPost("location")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    public async Task<IActionResult> Location(LocationUpdate update, CancellationToken ct)
    {
        await riders.UpdateLocationAsync(User.RiderId(), update, ct);
        return NoContent();
    }
}
