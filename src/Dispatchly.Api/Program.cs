using System.Text.Json.Serialization;
using Dispatchly.Api;
using Dispatchly.Api.Auth;
using Dispatchly.Application;
using Dispatchly.Application.Abstractions;
using Dispatchly.Application.Orders;
using Dispatchly.Application.Riders;
using Dispatchly.Domain.Dispatch;
using Dispatchly.Infrastructure;

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
builder.Services.AddSingleton<ILiveEvents, NoLiveEvents>();
builder.Services.AddScoped<AssignmentService>();
builder.Services.AddScoped<OrderService>();
builder.Services.AddScoped<RiderService>();
builder.Services.AddScoped<RestaurantQueries>();
builder.Services.AddScoped<StatsQueries>();
if (configuration.GetValue("Workers:AssignmentRetry", defaultValue: true))
{
    builder.Services.AddHostedService<AssignmentRetryWorker>();
}

builder.Services.AddDemoAuth(configuration);

// Enums travel as their names ("Searching"), in responses and in the OpenAPI document.
builder.Services.AddControllers().AddJsonOptions(o => o.JsonSerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.ConfigureHttpJsonOptions(o => o.SerializerOptions.Converters.Add(new JsonStringEnumConverter()));
builder.Services.AddProblemDetails();
builder.Services.AddExceptionHandler<ErrorHandler>();
builder.Services.AddOpenApi(options => options.AddDocumentTransformer((document, _, _) =>
{
    document.Info.Title = "Dispatchly API";
    document.Info.Description = "REST API v1. The SignalR contract is in docs/realtime.md.";
    return Task.CompletedTask;
}));
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
app.MapHealthChecks("/health");

await app.RunAsync();
