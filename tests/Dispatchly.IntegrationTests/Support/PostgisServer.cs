using Dispatchly.Domain.Dispatch;
using Dispatchly.Infrastructure;
using Microsoft.Extensions.DependencyInjection;
using Npgsql;
using Testcontainers.PostgreSql;

[assembly: AssemblyFixture(typeof(Dispatchly.IntegrationTests.Support.PostgisServer))]

namespace Dispatchly.IntegrationTests.Support;

public enum Seed
{
    /// <summary>Migrated, no rows: the test builds an exact world with <see cref="World"/>.</summary>
    None,

    /// <summary>The demo city from PLAN.md §12, with the canon orders and demo accounts.</summary>
    DemoCity,
}

/// <summary>
/// One PostGIS container for the whole run. Every test gets a database of its own, copied from a
/// template that is migrated (and seeded, for <see cref="Seed.DemoCity"/>) once, so tests can't
/// see each other's changes and can run in parallel.
/// </summary>
public sealed class PostgisServer : IAsyncLifetime
{
    // The same image as docker-compose.yml.
    private const string Image = "postgis/postgis:17-3.5";

    private readonly PostgreSqlContainer _container = new PostgreSqlBuilder(Image)
        // Room for the concurrency tests next to everything else running in parallel. These
        // databases are thrown away, so durability doesn't matter.
        .WithCommand("-c", "max_connections=400", "-c", "fsync=off", "-c", "synchronous_commit=off", "-c", "full_page_writes=off")
        .Build();

    private readonly SemaphoreSlim _create = new(1, 1);
    private readonly HashSet<Seed> _templates = [];
    private int _databases;

    public async ValueTask InitializeAsync() => await _container.StartAsync();

    public async ValueTask DisposeAsync() => await _container.DisposeAsync();

    /// <summary>Creates a fresh database for one test and returns its connection string.</summary>
    public async Task<string> CreateDatabaseAsync(Seed seed, CancellationToken ct)
    {
        var name = $"test_{Interlocked.Increment(ref _databases)}";
        // One at a time: copying a template needs it to have no other sessions.
        await _create.WaitAsync(ct);
        try
        {
            var template = await TemplateAsync(seed, ct);
            await ExecuteAsync($"CREATE DATABASE {name} TEMPLATE {template}", ct);
        }
        finally
        {
            _create.Release();
        }
        return ConnectionString(name, pooling: true);
    }

    private async Task<string> TemplateAsync(Seed seed, CancellationToken ct)
    {
        var name = seed == Seed.None ? "template_empty" : "template_demo_city";
        if (_templates.Contains(seed))
        {
            return name;
        }

        await ExecuteAsync($"CREATE DATABASE {name}", ct);
        // No pooling, so no connection outlives the setup and the template can be copied.
        var services = new ServiceCollection()
            .AddLogging()
            .AddSingleton(new DispatchPolicy())
            .AddSingleton(TimeProvider.System)
            .AddInfrastructure(ConnectionString(name, pooling: false))
            .BuildServiceProvider();
        await using (services)
        {
            await services.InitializeDatabaseAsync(seed: seed == Seed.DemoCity, ct);
        }
        _templates.Add(seed);
        return name;
    }

    private async Task ExecuteAsync(string sql, CancellationToken ct)
    {
        await using var connection = new NpgsqlConnection(ConnectionString("postgres", pooling: false));
        await connection.OpenAsync(ct);
        await using var command = new NpgsqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync(ct);
    }

    private string ConnectionString(string database, bool pooling) =>
        new NpgsqlConnectionStringBuilder(_container.GetConnectionString())
        {
            Database = database,
            Pooling = pooling,
            // Enough for 50 concurrent requests plus the test's own queries.
            MaxPoolSize = 120,
            IncludeErrorDetail = true,
        }.ConnectionString;
}
