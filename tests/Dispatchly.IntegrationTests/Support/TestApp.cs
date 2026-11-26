using System.Net.Http.Headers;
using System.Security.Cryptography;
using Dispatchly.Api.Auth;
using Dispatchly.Application;
using Dispatchly.Infrastructure.Data;
using Dispatchly.Infrastructure.Seeding;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Dispatchly.IntegrationTests.Support;

/// <summary>
/// The real API in memory, on a database of its own. The retry worker is off unless a test turns
/// it on, so what a test sees is what its own requests did.
/// </summary>
public sealed class TestApp : WebApplicationFactory<Program>
{
    private readonly IReadOnlyDictionary<string, string?> _settings;

    private TestApp(string connectionString, IReadOnlyDictionary<string, string?> settings)
    {
        ConnectionString = connectionString;
        _settings = settings;
    }

    public string ConnectionString { get; }

    public static async Task<TestApp> StartAsync(
        PostgisServer postgis,
        Seed seed,
        IReadOnlyDictionary<string, string?>? settings = null)
    {
        var connectionString = await postgis.CreateDatabaseAsync(seed, TestContext.Current.CancellationToken);
        return Start(connectionString, settings);
    }

    /// <summary>Another API instance on the same database, as when the API is scaled out.</summary>
    public static TestApp Start(string connectionString, IReadOnlyDictionary<string, string?>? settings = null)
    {
        var app = new TestApp(connectionString, settings ?? new Dictionary<string, string?>());
        _ = app.Server;
        return app;
    }

    protected override void ConfigureWebHost(IWebHostBuilder builder)
    {
        // Not Development: no user-secrets, no migrate-and-seed on start.
        builder.UseEnvironment("Testing");
        builder.UseSetting("ConnectionStrings:Dispatchly", ConnectionString);
        builder.UseSetting("Jwt:SigningKey", Convert.ToBase64String(RandomNumberGenerator.GetBytes(48)));
        builder.UseSetting("Workers:AssignmentRetry", "false");
        foreach (var (key, value) in _settings)
        {
            builder.UseSetting(key, value);
        }
        // appsettings.json sets Default to Information; warnings and errors are enough here.
        builder.UseSetting("Logging:LogLevel:Default", "Warning");
    }

    public HttpClient Client(string? token = null)
    {
        var client = CreateClient();
        if (token is not null)
        {
            client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        }
        return client;
    }

    public HttpClient Dispatcher() => As(Role.Dispatcher);

    public HttpClient Customer(int customerId) => As(Role.Customer, customerId: customerId);

    public HttpClient Rider(int riderId) => As(Role.Rider, riderId: riderId);

    public string Token(Role role, int? riderId = null, int? customerId = null) =>
        Services.GetRequiredService<TokenIssuer>().Issue(role, role.ToString(), riderId, customerId).Token;

    public async Task<T> QueryAsync<T>(Func<DispatchlyDbContext, Task<T>> query)
    {
        await using var scope = Services.CreateAsyncScope();
        return await query(scope.ServiceProvider.GetRequiredService<DispatchlyDbContext>());
    }

    public async Task ExecuteAsync(Func<DispatchlyDbContext, Task> work)
    {
        await using var scope = Services.CreateAsyncScope();
        await work(scope.ServiceProvider.GetRequiredService<DispatchlyDbContext>());
    }

    // ---- The demo city (Seed.DemoCity) ----------------------------------------------------------

    public Task<int> DemoRiderIdAsync() =>
        QueryAsync(db => db.Riders.Where(r => r.Name == DemoSeeder.DemoRiderName).Select(r => r.Id).SingleAsync(TestContext.Current.CancellationToken));

    public Task<int> DemoCustomerIdAsync() =>
        QueryAsync(db => db.Customers.Where(c => c.Name == DemoSeeder.DemoCustomerName).Select(c => c.Id).SingleAsync(TestContext.Current.CancellationToken));

    public Task<string> DeliveryCodeAsync(string orderCode) =>
        QueryAsync(db => db.Orders.Where(o => o.Code == orderCode).Select(o => o.DeliveryCode).SingleAsync(TestContext.Current.CancellationToken));

    private HttpClient As(Role role, int? riderId = null, int? customerId = null) =>
        Client(Token(role, riderId, customerId));
}
