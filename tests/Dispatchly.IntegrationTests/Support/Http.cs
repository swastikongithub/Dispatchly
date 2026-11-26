using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace Dispatchly.IntegrationTests.Support;

public static class Http
{
    /// <summary>The API's JSON: camelCase, enums as names.</summary>
    public static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web)
    {
        Converters = { new JsonStringEnumConverter() },
    };

    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    public static Task<HttpResponseMessage> PostJsonAsync(this HttpClient client, string url, object? body = null) =>
        body is null ? client.PostAsync(url, content: null, Ct) : client.PostAsJsonAsync(url, body, Json, Ct);

    public static Task<HttpResponseMessage> PutJsonAsync(this HttpClient client, string url, object body) =>
        client.PutAsJsonAsync(url, body, Json, Ct);

    public static async Task<T> GetJsonAsync<T>(this HttpClient client, string url) =>
        await (await client.GetAsync(url, Ct)).ReadAsync<T>();

    /// <summary>The body of a successful response; fails the test with the body otherwise.</summary>
    public static async Task<T> ReadAsync<T>(this HttpResponseMessage response, HttpStatusCode expected = HttpStatusCode.OK)
    {
        var body = await response.Content.ReadAsStringAsync(Ct);
        Assert.True(response.StatusCode == expected, $"Expected {(int)expected}, got {(int)response.StatusCode}: {body}");
        return JsonSerializer.Deserialize<T>(body, Json) ?? throw new InvalidOperationException("Empty body.");
    }

    /// <summary>Asserts a problem-details response with this status and, if given, this <c>code</c>.</summary>
    public static async Task AssertProblemAsync(this HttpResponseMessage response, HttpStatusCode status, string? code = null)
    {
        var body = await response.Content.ReadAsStringAsync(Ct);
        Assert.True(response.StatusCode == status, $"Expected {(int)status}, got {(int)response.StatusCode}: {body}");
        Assert.Equal("application/problem+json", response.Content.Headers.ContentType?.MediaType);
        if (code is not null)
        {
            using var problem = JsonDocument.Parse(body);
            Assert.Equal(code, problem.RootElement.TryGetProperty("code", out var value) ? value.GetString() : null);
        }
    }
}
