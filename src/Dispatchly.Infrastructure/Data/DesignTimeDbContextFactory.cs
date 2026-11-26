using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Design;

namespace Dispatchly.Infrastructure.Data;

/// <summary>
/// For dotnet-ef only (creating migrations needs no database):
/// <c>dotnet ef migrations add Name --project src/Dispatchly.Infrastructure</c>.
/// </summary>
internal sealed class DesignTimeDbContextFactory : IDesignTimeDbContextFactory<DispatchlyDbContext>
{
    public DispatchlyDbContext CreateDbContext(string[] args)
    {
        var options = new DbContextOptionsBuilder<DispatchlyDbContext>()
            .UseNpgsql("Host=localhost;Database=dispatchly_design", npgsql => npgsql.UseNetTopologySuite())
            .Options;
        return new DispatchlyDbContext(options);
    }
}
