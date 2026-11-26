using System;
using Microsoft.EntityFrameworkCore.Migrations;
using NetTopologySuite.Geometries;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Dispatchly.Infrastructure.Data.Migrations
{
    /// <inheritdoc />
    public partial class InitialSchema : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterDatabase()
                .Annotation("Npgsql:PostgresExtension:postgis", ",,");

            migrationBuilder.CreateSequence<int>(
                name: "order_number_seq",
                startValue: 4824L);

            migrationBuilder.CreateTable(
                name: "customers",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    phone = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    saved_addresses = table.Column<string>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_customers", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "restaurants",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    area = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    address = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    phone = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    location = table.Column<Point>(type: "geography (point, 4326)", nullable: false),
                    prep_minutes = table.Column<int>(type: "integer", nullable: false),
                    menu = table.Column<string>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_restaurants", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "riders",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    name = table.Column<string>(type: "character varying(100)", maxLength: 100, nullable: false),
                    phone = table.Column<string>(type: "character varying(32)", maxLength: 32, nullable: false),
                    vehicle = table.Column<string>(type: "character varying(60)", maxLength: 60, nullable: false),
                    plate = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    location = table.Column<Point>(type: "geography (point, 4326)", nullable: false),
                    bearing = table.Column<double>(type: "double precision", nullable: false),
                    last_seen_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    online_since = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_riders", x => x.id);
                });

            migrationBuilder.CreateTable(
                name: "orders",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    code = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    restaurant_id = table.Column<int>(type: "integer", nullable: false),
                    customer_id = table.Column<int>(type: "integer", nullable: false),
                    rider_id = table.Column<int>(type: "integer", nullable: true),
                    status = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    drop_location = table.Column<Point>(type: "geography (point, 4326)", nullable: false),
                    drop_address = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    drop_area = table.Column<string>(type: "character varying(80)", maxLength: 80, nullable: false),
                    drop_label = table.Column<string>(type: "character varying(40)", maxLength: 40, nullable: true),
                    total_paise = table.Column<int>(type: "integer", nullable: false),
                    payment = table.Column<string>(type: "character varying(16)", maxLength: 16, nullable: false),
                    delivery_code = table.Column<string>(type: "character(4)", fixedLength: true, maxLength: 4, nullable: false),
                    rider_pay_paise = table.Column<int>(type: "integer", nullable: false),
                    route = table.Column<LineString>(type: "geography (linestring, 4326)", nullable: false),
                    distance_meters = table.Column<double>(type: "double precision", nullable: false),
                    search_radius_meters = table.Column<int>(type: "integer", nullable: false),
                    created_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    ready_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    promised_by = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    estimated_delivery_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    assigned_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    picked_up_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    delivered_at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    xmin = table.Column<uint>(type: "xid", rowVersion: true, nullable: false),
                    items = table.Column<string>(type: "jsonb", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_orders", x => x.id);
                    table.ForeignKey(
                        name: "fk_orders_customers_customer_id",
                        column: x => x.customer_id,
                        principalTable: "customers",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_orders_restaurants_restaurant_id",
                        column: x => x.restaurant_id,
                        principalTable: "restaurants",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "fk_orders_riders_rider_id",
                        column: x => x.rider_id,
                        principalTable: "riders",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "order_events",
                columns: table => new
                {
                    id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    order_id = table.Column<int>(type: "integer", nullable: false),
                    type = table.Column<string>(type: "character varying(24)", maxLength: 24, nullable: false),
                    at = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    data = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("pk_order_events", x => x.id);
                    table.ForeignKey(
                        name: "fk_order_events_orders_order_id",
                        column: x => x.order_id,
                        principalTable: "orders",
                        principalColumn: "id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "ix_order_events_order_id",
                table: "order_events",
                column: "order_id");

            migrationBuilder.CreateIndex(
                name: "ix_orders_code",
                table: "orders",
                column: "code",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "ix_orders_customer_id",
                table: "orders",
                column: "customer_id");

            migrationBuilder.CreateIndex(
                name: "ix_orders_delivered_at",
                table: "orders",
                column: "delivered_at");

            migrationBuilder.CreateIndex(
                name: "ix_orders_one_active_order_per_rider",
                table: "orders",
                column: "rider_id",
                unique: true,
                filter: "status IN ('Assigned', 'PickedUp', 'InTransit')");

            migrationBuilder.CreateIndex(
                name: "ix_orders_restaurant_id",
                table: "orders",
                column: "restaurant_id");

            migrationBuilder.CreateIndex(
                name: "ix_orders_rider_id_delivered_at",
                table: "orders",
                columns: new[] { "rider_id", "delivered_at" });

            migrationBuilder.CreateIndex(
                name: "ix_orders_status_created_at",
                table: "orders",
                columns: new[] { "status", "created_at" });

            migrationBuilder.CreateIndex(
                name: "ix_restaurants_location",
                table: "restaurants",
                column: "location")
                .Annotation("Npgsql:IndexMethod", "gist");

            migrationBuilder.CreateIndex(
                name: "ix_riders_location",
                table: "riders",
                column: "location")
                .Annotation("Npgsql:IndexMethod", "gist");

            migrationBuilder.CreateIndex(
                name: "ix_riders_status",
                table: "riders",
                column: "status");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "order_events");

            migrationBuilder.DropTable(
                name: "orders");

            migrationBuilder.DropTable(
                name: "customers");

            migrationBuilder.DropTable(
                name: "restaurants");

            migrationBuilder.DropTable(
                name: "riders");

            migrationBuilder.DropSequence(
                name: "order_number_seq");
        }
    }
}
