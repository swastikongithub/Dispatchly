using System.Reflection;

namespace Dispatchly.UnitTests.Architecture;

/// <summary>
/// Guards the layering in PLAN.md §3.2: the Domain holds entities, enums and
/// domain rules only, with no EF Core, no HTTP and no outer Dispatchly layers.
/// </summary>
public sealed class DomainLayerTests
{
    private static readonly string[] ForbiddenPrefixes =
    [
        "Microsoft.EntityFrameworkCore",
        "Npgsql",
        "Microsoft.AspNetCore",
        "Dispatchly.Application",
        "Dispatchly.Infrastructure",
        "Dispatchly.Simulator",
        "Dispatchly.Api",
    ];

    [Fact]
    public void Domain_does_not_reference_ef_core_http_or_outer_layers()
    {
        var domain = Assembly.Load("Dispatchly.Domain");

        var forbidden = domain
            .GetReferencedAssemblies()
            .Select(reference => reference.Name ?? string.Empty)
            .Where(name => ForbiddenPrefixes.Any(prefix => name.StartsWith(prefix, StringComparison.Ordinal)))
            .ToArray();

        Assert.Empty(forbidden);
    }
}
