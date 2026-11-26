using System.Text;
using Dispatchly.Domain.Customers;
using Dispatchly.Domain.Geo;
using Dispatchly.Domain.Orders;
using Dispatchly.Domain.Restaurants;
using Dispatchly.Domain.Riders;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;

namespace Dispatchly.Infrastructure.Data;

public sealed class DispatchlyDbContext(DbContextOptions<DispatchlyDbContext> options) : DbContext(options)
{
    public const string OrderNumberSequence = "order_number_seq";

    public DbSet<Rider> Riders => Set<Rider>();
    public DbSet<Restaurant> Restaurants => Set<Restaurant>();
    public DbSet<Customer> Customers => Set<Customer>();
    public DbSet<Order> Orders => Set<Order>();
    public DbSet<OrderEvent> OrderEvents => Set<OrderEvent>();

    protected override void ConfigureConventions(ModelConfigurationBuilder configurationBuilder)
    {
        // Enums as readable strings, so SQL and the raw assignment query can say status = 'Available'.
        configurationBuilder.Properties<RiderStatus>().HaveConversion<string>().HaveMaxLength(16);
        configurationBuilder.Properties<OrderStatus>().HaveConversion<string>().HaveMaxLength(16);
        configurationBuilder.Properties<PaymentMethod>().HaveConversion<string>().HaveMaxLength(16);
        configurationBuilder.Properties<OrderEventType>().HaveConversion<string>().HaveMaxLength(24);
        configurationBuilder.Properties<GeoPoint>()
            .HaveConversion<GeoPointConverter>()
            .HaveColumnType(Geography.Point);
    }

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.HasPostgresExtension("postgis");
        // Order codes continue from the canon orders in the seed (DL-4810 … DL-4823, PLAN.md §12).
        modelBuilder.HasSequence<int>(OrderNumberSequence).StartsAt(4824);
        modelBuilder.ApplyConfigurationsFromAssembly(typeof(DispatchlyDbContext).Assembly);
        UseSnakeCase(modelBuilder);
    }

    /// <summary>snake_case tables, columns, keys and indexes, so hand-written SQL reads naturally.</summary>
    private static void UseSnakeCase(ModelBuilder modelBuilder)
    {
        foreach (var entity in modelBuilder.Model.GetEntityTypes())
        {
            if (entity.IsMappedToJson())
            {
                continue;
            }
            entity.SetTableName(Snake(entity.GetTableName()!));
            var table = StoreObjectIdentifier.Table(entity.GetTableName()!);
            foreach (var property in entity.GetProperties())
            {
                var column = property.GetColumnName(table);
                if (column is not null && column != "xmin")
                {
                    property.SetColumnName(Snake(column));
                }
            }
            foreach (var key in entity.GetKeys())
            {
                key.SetName(Snake(key.GetName()!));
            }
            foreach (var foreignKey in entity.GetForeignKeys())
            {
                foreignKey.SetConstraintName(Snake(foreignKey.GetConstraintName()!));
            }
            foreach (var index in entity.GetIndexes())
            {
                index.SetDatabaseName(Snake(index.GetDatabaseName()!));
            }
        }
    }

    internal static string Snake(string name)
    {
        var builder = new StringBuilder(name.Length + 8);
        for (var i = 0; i < name.Length; i++)
        {
            var c = name[i];
            if (char.IsUpper(c))
            {
                var previousIsLower = i > 0 && (char.IsLower(name[i - 1]) || char.IsDigit(name[i - 1]));
                var nextIsLower = i + 1 < name.Length && char.IsLower(name[i + 1]);
                if (i > 0 && name[i - 1] != '_' && (previousIsLower || (nextIsLower && char.IsUpper(name[i - 1]))))
                {
                    builder.Append('_');
                }
                builder.Append(char.ToLowerInvariant(c));
            }
            else
            {
                builder.Append(c);
            }
        }
        return builder.ToString();
    }
}

internal static class Geography
{
    public const string Point = "geography (point, 4326)";
    public const string LineString = "geography (linestring, 4326)";
}
