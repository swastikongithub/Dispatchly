using Dispatchly.Application;
using Dispatchly.Domain;
using Microsoft.AspNetCore.Diagnostics;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Dispatchly.Api;

/// <summary>
/// Turns use-case failures into RFC 9457 problem details with a stable <c>code</c> clients can
/// switch on, e.g. 422 <c>wrong_delivery_code</c> or 409 <c>no_free_rider</c>.
/// </summary>
internal sealed class ErrorHandler(IProblemDetailsService problems, ILogger<ErrorHandler> logger) : IExceptionHandler
{
    private static readonly HashSet<string> BadRequestCodes = ["invalid_items", "drop_too_far"];

    public async ValueTask<bool> TryHandleAsync(HttpContext context, Exception exception, CancellationToken ct)
    {
        var (status, code, title) = exception switch
        {
            NotFoundException => (StatusCodes.Status404NotFound, "not_found", "Not found"),
            InvalidRequestException e => (StatusCodes.Status400BadRequest, e.Code, "Invalid request"),
            ConflictException e => (StatusCodes.Status409Conflict, e.Code, "Conflict"),
            DomainException { Code: "wrong_delivery_code" } e => (StatusCodes.Status422UnprocessableEntity, e.Code, "Wrong delivery code"),
            DomainException e when BadRequestCodes.Contains(e.Code) => (StatusCodes.Status400BadRequest, e.Code, "Invalid request"),
            DomainException e => (StatusCodes.Status409Conflict, e.Code, "Conflict"),
            // Lost a race with another update; the client can refetch and retry.
            DbUpdateConcurrencyException => (StatusCodes.Status409Conflict, "concurrent_update", "Conflict"),
            DbUpdateException { InnerException: PostgresException { SqlState: PostgresErrorCodes.UniqueViolation } } =>
                (StatusCodes.Status409Conflict, "concurrent_update", "Conflict"),
            _ => (0, "", ""),
        };
        if (status == 0)
        {
            return false;
        }
        if (status == StatusCodes.Status409Conflict && code == "concurrent_update")
        {
            logger.LogWarning(exception, "Concurrent update on {Path}", context.Request.Path);
        }

        context.Response.StatusCode = status;
        return await problems.TryWriteAsync(new ProblemDetailsContext
        {
            HttpContext = context,
            Exception = exception,
            ProblemDetails =
            {
                Status = status,
                Title = title,
                Detail = exception.Message,
                Extensions = { ["code"] = code },
            },
        });
    }
}
