using Dispatchly.Application.Abstractions;
using Dispatchly.Infrastructure.Data;
using Dispatchly.Infrastructure.Seeding;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Dispatchly.Infrastructure;

public static class InfrastructureServices
{
    public static IServiceCollection AddInfrastructure(this IServiceCollection services, string connectionString)
    {
        services.AddDbContext<DispatchlyDbContext>(options =>
            options.UseNpgsql(connectionString, npgsql => npgsql.UseNetTopologySuite()));
        services.AddScoped<IDispatchStore, EfDispatchStore>();
        services.AddScoped<IDispatchReader, EfDispatchReader>();
        services.AddScoped<IDemoAccounts, EfDemoAccounts>();
        services.AddScoped<DemoSeeder>();
        return services;
    }

    /// <summary>Applies pending migrations and, if asked, seeds an empty database with the demo city.</summary>
    public static async Task InitializeDatabaseAsync(this IServiceProvider services, bool seed, CancellationToken ct)
    {
        await using var scope = services.CreateAsyncScope();
        var db = scope.ServiceProvider.GetRequiredService<DispatchlyDbContext>();
        await db.Database.MigrateAsync(ct);
        if (seed)
        {
            await scope.ServiceProvider.GetRequiredService<DemoSeeder>().SeedAsync(ct);
        }
    }

    /// <summary>For the health check: can we reach the database?</summary>
    public static Task<bool> CanConnectAsync(IServiceProvider scopedServices, CancellationToken ct) =>
        scopedServices.GetRequiredService<DispatchlyDbContext>().Database.CanConnectAsync(ct);

    private sealed class EfDemoAccounts(DispatchlyDbContext db) : IDemoAccounts
    {
        public Task<DemoAccount?> RiderAsync(CancellationToken ct) =>
            db.Riders
                .Where(r => r.Name == DemoSeeder.DemoRiderName)
                .OrderBy(r => r.Id)
                .Select(r => new DemoAccount(r.Id, r.Name))
                .FirstOrDefaultAsync(ct);

        public Task<DemoAccount?> CustomerAsync(CancellationToken ct) =>
            db.Customers
                .Where(c => c.Name == DemoSeeder.DemoCustomerName)
                .OrderBy(c => c.Id)
                .Select(c => new DemoAccount(c.Id, c.Name))
                .FirstOrDefaultAsync(ct);
    }
}
