using Dispatchly.Domain.Orders;
using Dispatchly.IntegrationTests.Support;
using Microsoft.EntityFrameworkCore;
using Npgsql;

namespace Dispatchly.IntegrationTests;

/// <summary>The migrations match the model, and the database itself refuses a rider two active orders.</summary>
public sealed class SchemaTests(PostgisServer postgis)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Fact]
    public async Task The_migrations_match_the_model()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.None);

        Assert.False(await app.QueryAsync(db => Task.FromResult(db.Database.HasPendingModelChanges())), "The model has changes no migration covers. Run dotnet ef migrations add.");
        Assert.Empty(await app.QueryAsync(db => db.Database.GetPendingMigrationsAsync(Ct)));
    }

    [Fact]
    public async Task The_database_refuses_a_second_active_order_for_a_rider()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.DemoCity);
        var riderId = await app.DemoRiderIdAsync();
        // The demo rider is on DL-4810, and DL-4822 is still searching.
        Assert.Equal(OrderStatus.Assigned, await app.QueryAsync(db => db.Orders.Where(o => o.Code == "DL-4810").Select(o => o.Status).SingleAsync(Ct)));
        Assert.Equal(riderId, await app.QueryAsync(db => db.Orders.Where(o => o.Code == "DL-4810").Select(o => o.RiderId).SingleAsync(Ct)));

        var error = await Assert.ThrowsAsync<PostgresException>(() => app.ExecuteAsync(db =>
            db.Database.ExecuteSqlAsync($"UPDATE orders SET rider_id = {riderId}, status = 'Assigned' WHERE code = 'DL-4822'", Ct)));

        Assert.Equal(PostgresErrorCodes.UniqueViolation, error.SqlState);
        Assert.Equal("ix_orders_one_active_order_per_rider", error.ConstraintName);
        // Delivered orders don't count: the demo rider has already finished some today.
        Assert.True(await app.QueryAsync(db => db.Orders.CountAsync(o => o.RiderId == riderId && o.Status == OrderStatus.Delivered, Ct)) > 0);
    }
}
