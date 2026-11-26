using Dispatchly.Application;
using Microsoft.AspNetCore.Mvc;
using Microsoft.OpenApi;

namespace Dispatchly.Api;

/// <summary>
/// The OpenAPI document (/openapi/v1.json) the web app's typed client is generated from, so it
/// says exactly what goes over the wire: JSON bodies, problem details with a <c>code</c> on errors.
/// </summary>
internal static class OpenApiSetup
{
    private const string Json = "application/json";
    private const string Problem = "application/problem+json";

    private static readonly Type[] HubOnlyPayloads = [typeof(RidersBatch), typeof(RiderPosition), typeof(EtaChanged)];

    public static IServiceCollection AddDispatchlyOpenApi(this IServiceCollection services) =>
        services.AddOpenApi(options =>
        {
            options.AddDocumentTransformer(async (document, context, ct) =>
            {
                document.Info.Title = "Dispatchly API";
                document.Info.Description = "REST API v1. The SignalR contract is in docs/realtime.md.";
                // Payloads only the hub sends, so clients get types for them too.
                document.Components ??= new OpenApiComponents();
                document.Components.Schemas ??= new Dictionary<string, IOpenApiSchema>();
                foreach (var type in HubOnlyPayloads)
                {
                    document.Components.Schemas.TryAdd(type.Name, await context.GetOrCreateSchemaAsync(type, null, ct));
                }
            });

            // Clients send and get JSON; errors are RFC 9457 problem details.
            options.AddOperationTransformer((operation, _, _) =>
            {
                if (operation.RequestBody?.Content is { Count: > 0 } body)
                {
                    OnlyMediaType(body, Json);
                }
                foreach (var (status, response) in operation.Responses ?? [])
                {
                    if (response.Content is { Count: > 0 } content)
                    {
                        OnlyMediaType(content, status.StartsWith('2') ? Json : Problem);
                    }
                }
                return Task.CompletedTask;
            });

            options.AddSchemaTransformer((schema, context, _) =>
            {
                if (context.JsonTypeInfo.Type == typeof(ProblemDetails) && schema.Properties is { } properties)
                {
                    properties["code"] = new OpenApiSchema
                    {
                        Type = JsonSchemaType.String,
                        Description = "What went wrong, for clients to switch on: e.g. no_free_rider, wrong_delivery_code.",
                    };
                    properties["errors"] = new OpenApiSchema
                    {
                        Type = JsonSchemaType.Object,
                        Description = "Validation errors by field, on 400 responses.",
                        AdditionalProperties = new OpenApiSchema
                        {
                            Type = JsonSchemaType.Array,
                            Items = new OpenApiSchema { Type = JsonSchemaType.String },
                        },
                    };
                }
                // RiderPointJsonConverter writes each one as an array, which the generator can't see.
                if (context.JsonTypeInfo.Type == typeof(IReadOnlyList<RiderPoint>))
                {
                    schema.Items = RiderPointSchema();
                }
                return Task.CompletedTask;
            });
        });

    /// <summary>[id, lat, lng, bearing, status]. OpenAPI 3.1's prefixItems isn't in Microsoft.OpenApi 2.x, so: five numbers or strings.</summary>
    private static OpenApiSchema RiderPointSchema() => new()
    {
        Type = JsonSchemaType.Array,
        Description = "A rider on the map: [id, lat, lng, bearing, status]. lat and lng to 5 decimals, bearing 0–359 clockwise from north, status a RiderStatus name.",
        MinItems = 5,
        MaxItems = 5,
        Items = new OpenApiSchema
        {
            OneOf = [new OpenApiSchema { Type = JsonSchemaType.Number }, new OpenApiSchema { Type = JsonSchemaType.String }],
        },
    };

    private static void OnlyMediaType(IDictionary<string, OpenApiMediaType> content, string mediaType)
    {
        var schema = content.Values.FirstOrDefault()?.Schema;
        content.Clear();
        content[mediaType] = new OpenApiMediaType { Schema = schema };
    }
}
