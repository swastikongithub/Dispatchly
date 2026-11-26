using System.Text.Json;
using System.Text.Json.Serialization;
using Dispatchly.Api;
using Dispatchly.Api.Auth;
using Dispatchly.Api.Live;
using Dispatchly.Application;
using Dispatchly.Application.Abstractions;
using Dispatchly.Application.Live;
using Dispatchly.Application.Orders;
using Dispatchly.Application.Riders;
using Dispatchly.Domain.Dispatch;
using Dispatchly.Infrastructure;
using Dispatchly.Simulator;

var builder = WebApplication.CreateBuilder(args);
var configuration = builder.Configuration;

// Secrets (connection string, JWT key) come from user-secrets in Development and from the
// environment elsewhere (ConnectionStrings__Dispatchly, Jwt__SigningKey). See README.
var connectionString = configuration.GetConnectionString("Dispatchly");
if (string.IsNullOrWhiteSpace(connectionString))
{
    throw new InvalidOperationException(
        "Set ConnectionStrings:Dispatchly (user-secrets or the ConnectionStrings__Dispatchly environment variable). See README.");
}
builder.Services.AddInfrastructure(connectionString);

builder.Services.AddSingleton(configuration.GetSection("Dispatch").Get<DispatchPolicy>() ?? new DispatchPolicy());
builder.Services.AddSingleton(TimeProvider.System);
// Live (PLAN.md §3.6): use cases publish through ILiveEvents after they commit.
builder.Services.AddSignalR().AddJsonProtocol(o => Json(o.PayloadSerializerOptions));
builder.Services.AddSingleton<ILiveHub, SignalRLiveHub>();
builder.Services.AddScoped<LivePublisher>();
builder.Services.AddScoped<ILiveEvents, SafeLiveEvents>();
builder.Services.AddScoped<LiveQueries>();
builder.Services.AddScoped<LiveBroadcaster>();
builder.Services.AddSingleton<LiveBroadcastState>();
builder.Services.AddSingleton(configuration.GetSection(LiveOptions.Section).Get<LiveOptions>() ?? new LiveOptions());
builder.Services.AddScoped<AssignmentService>();
builder.Services.AddScoped<OrderService>();
builder.Services.AddScoped<RiderService>();
builder.Services.AddScoped<RestaurantQueries>();
builder.Services.AddScoped<StatsQueries>();
if (configuration.GetValue("Workers:AssignmentRetry", defaultValue: true))
{
    builder.Services.AddHostedService<AssignmentRetryWorker>();
}
if (configuration.GetValue("Workers:LiveBroadcast", defaultValue: true))
{
    builder.Services.AddHostedService<LiveBroadcastWorker>();
}
// The city simulator (PLAN.md §3.7). Run it on one instance only: each one would add its own orders.
builder.Services.AddCitySimulator(configuration.GetSection(SimulatorOptions.Section));

builder.Services.AddDemoAuth(configuration);

// Enums travel as their names ("Searching"), numbers only as JSON numbers: in requests,
// responses and the OpenAPI document (which reads the HTTP JSON options).
builder.Services.AddControllers().AddJsonOptions(o => Json(o.JsonSerializerOptions));
builder.Services.ConfigureHttpJsonOptions(o => Json(o.SerializerOptions));
builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<ErrorHandler>();
builder.Services.AddDispatchlyOpenApi();
builder.Services.AddHealthChecks().AddCheck<DatabaseHealthCheck>("database");

var app = builder.Build();

if (configuration.GetValue("Database:Migrate", defaultValue: false))
{
    await app.Services.InitializeDatabaseAsync(seed: configuration.GetValue("Database:Seed", defaultValue: false), CancellationToken.None);
}

app.UseExceptionHandler();
app.UseStatusCodePages();
if (!app.Environment.IsProduction())
{
    app.MapOpenApi();
}
app.UseAuthentication();
app.UseAuthorization();
app.MapControllers();
app.MapHub<LiveHub>(LiveHub.Path, o => o.CloseOnAuthenticationExpiration = true);
app.MapHealthChecks("/health");

await app.RunAsync();

static void Json(JsonSerializerOptions options)
{
    options.Converters.Add(new JsonStringEnumConverter());
    options.NumberHandling = JsonNumberHandling.Strict;
}
