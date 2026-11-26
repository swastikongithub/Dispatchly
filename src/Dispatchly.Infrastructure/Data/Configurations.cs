using Dispatchly.Domain.Customers;
using Dispatchly.Domain.Orders;
using Dispatchly.Domain.Restaurants;
using Dispatchly.Domain.Riders;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;

namespace Dispatchly.Infrastructure.Data;

internal static class RowVersion
{
    /// <summary>PostgreSQL's xmin system column as an optimistic concurrency token (a shadow property).</summary>
    public static void HasXminRowVersion<T>(this EntityTypeBuilder<T> builder)
        where T : class =>
        builder.Property<uint>("xmin")
            .HasColumnName("xmin")
            .HasColumnType("xid")
            .ValueGeneratedOnAddOrUpdate()
            .IsConcurrencyToken();
}

internal sealed class RiderConfiguration : IEntityTypeConfiguration<Rider>
{
    public void Configure(EntityTypeBuilder<Rider> builder)
    {
        builder.Property(r => r.Name).HasMaxLength(100);
        builder.Property(r => r.Phone).HasMaxLength(32);
        builder.Property(r => r.Vehicle).HasMaxLength(60);
        builder.Property(r => r.Plate).HasMaxLength(20);
        builder.Ignore(r => r.FirstName);
        builder.Ignore(r => r.IsBusy);
        builder.HasXminRowVersion();

        // The assignment query: KNN (<->) and ST_DWithin on the GiST index, filtered by status.
        builder.HasIndex(r => r.Location).HasMethod("gist");
        builder.HasIndex(r => r.Status);
    }
}

internal sealed class RestaurantConfiguration : IEntityTypeConfiguration<Restaurant>
{
    public void Configure(EntityTypeBuilder<Restaurant> builder)
    {
        builder.Property(r => r.Name).HasMaxLength(100);
        builder.Property(r => r.Area).HasMaxLength(80);
        builder.Property(r => r.Address).HasMaxLength(200);
        builder.Property(r => r.Phone).HasMaxLength(32);
        builder.OwnsMany(r => r.Menu, menu => menu.ToJson("menu"));
        builder.Navigation(r => r.Menu).HasField("_menu");
        builder.HasIndex(r => r.Location).HasMethod("gist");
    }
}

internal sealed class CustomerConfiguration : IEntityTypeConfiguration<Customer>
{
    public void Configure(EntityTypeBuilder<Customer> builder)
    {
        builder.Property(c => c.Name).HasMaxLength(100);
        builder.Property(c => c.Phone).HasMaxLength(32);
        builder.OwnsMany(c => c.SavedAddresses, addresses => addresses.ToJson("saved_addresses"));
        builder.Navigation(c => c.SavedAddresses).HasField("_savedAddresses");
    }
}

internal sealed class OrderConfiguration : IEntityTypeConfiguration<Order>
{
    public void Configure(EntityTypeBuilder<Order> builder)
    {
        builder.Property(o => o.Code).HasMaxLength(16);
        builder.HasIndex(o => o.Code).IsUnique();
        builder.Property(o => o.DropAddress).HasMaxLength(200);
        builder.Property(o => o.DropArea).HasMaxLength(80);
        builder.Property(o => o.DropLabel).HasMaxLength(40);
        builder.Property(o => o.DeliveryCode).HasMaxLength(4).IsFixedLength();
        builder.Property(o => o.Route)
            .HasField("_route")
            .UsePropertyAccessMode(PropertyAccessMode.Field)
            .HasConversion(new RouteConverter(), new RouteComparer())
            .HasColumnType(Geography.LineString);
        builder.Ignore(o => o.IsActive);
        builder.Ignore(o => o.IsLate);
        builder.Ignore(o => o.MinutesLate);
        builder.HasXminRowVersion();

        builder.OwnsMany(o => o.Items, items => items.ToJson("items"));
        builder.Navigation(o => o.Items).HasField("_items");

        builder.HasOne(o => o.Restaurant).WithMany().HasForeignKey(o => o.RestaurantId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne(o => o.Customer).WithMany().HasForeignKey(o => o.CustomerId).OnDelete(DeleteBehavior.Restrict);
        builder.HasOne(o => o.Rider).WithMany().HasForeignKey(o => o.RiderId).OnDelete(DeleteBehavior.Restrict);
        builder.HasMany(o => o.Events).WithOne().HasForeignKey(e => e.OrderId).OnDelete(DeleteBehavior.Cascade);
        builder.Navigation(o => o.Events).HasField("_events");

        // A rider has at most one active order, enforced by the database as well as by the
        // locked assignment path: a second assignment would violate this index and roll back.
        builder.HasIndex(o => o.RiderId)
            .IsUnique()
            .HasFilter("status IN ('Assigned', 'PickedUp', 'InTransit')")
            .HasDatabaseName("ix_orders_one_active_order_per_rider");
        builder.HasIndex(o => new { o.Status, o.CreatedAt });
        builder.HasIndex(o => new { o.RiderId, o.DeliveredAt });
        builder.HasIndex(o => o.DeliveredAt);
    }
}

internal sealed class OrderEventConfiguration : IEntityTypeConfiguration<OrderEvent>
{
    public void Configure(EntityTypeBuilder<OrderEvent> builder)
    {
        builder.OwnsOne(e => e.Data, data => data.ToJson("data"));
        builder.HasIndex(e => e.OrderId);
    }
}
