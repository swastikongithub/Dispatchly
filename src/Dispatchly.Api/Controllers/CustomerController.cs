using Dispatchly.Api.Auth;
using Dispatchly.Application;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;

namespace Dispatchly.Api.Controllers;

[ApiController]
[Route("api/v1/customer")]
[Authorize(Roles = nameof(Role.Customer))]
public sealed class CustomerController(CustomerQueries customers) : ControllerBase
{
    /// <summary>The signed-in customer's saved addresses ("Home"), in the order they were saved.</summary>
    [HttpGet("addresses")]
    [ProducesResponseType(StatusCodes.Status200OK)]
    [ProducesResponseType(StatusCodes.Status404NotFound)]
    public Task<IReadOnlyList<CustomerAddress>> Addresses(CancellationToken ct) =>
        customers.AddressesAsync(User.CustomerId(), ct);
}
