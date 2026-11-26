using Dispatchly.Api.Auth;
using Dispatchly.Application;
using Dispatchly.Application.Abstractions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Dispatchly.Api.Controllers;

public sealed record DemoSignInRequest(Role Role);

public sealed record DemoSession(string Token, DateTimeOffset ExpiresAt, Role Role, string Name, int? RiderId, int? CustomerId);

[ApiController]
[Route("api/v1/auth")]
public sealed class AuthController(TokenIssuer tokens, IDemoAccounts demo) : ControllerBase
{
    /// <summary>One-click demo sign-in (PLAN.md §1.3): a token for the seeded account of that role.</summary>
    [HttpPost("demo")]
    [AllowAnonymous]
    public async Task<ActionResult<DemoSession>> Demo(DemoSignInRequest request, CancellationToken ct)
    {
        switch (request.Role)
        {
            case Role.Dispatcher:
                return Session(Role.Dispatcher, "Dispatcher");
            case Role.Rider:
                var rider = await demo.RiderAsync(ct) ?? throw new NotFoundException("The demo rider isn't seeded.");
                return Session(Role.Rider, rider.Name, riderId: rider.Id);
            case Role.Customer:
                var customer = await demo.CustomerAsync(ct) ?? throw new NotFoundException("The demo customer isn't seeded.");
                return Session(Role.Customer, customer.Name, customerId: customer.Id);
            default:
                return ValidationProblem($"Unknown role {request.Role}.");
        }
    }

    private DemoSession Session(Role role, string name, int? riderId = null, int? customerId = null)
    {
        var (token, expiresAt) = tokens.Issue(role, name, riderId, customerId);
        return new DemoSession(token, expiresAt, role, name, riderId, customerId);
    }
}
