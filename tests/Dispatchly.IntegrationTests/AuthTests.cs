using System.Net;
using System.Security.Cryptography;
using Dispatchly.Api.Auth;
using Dispatchly.Api.Controllers;
using Dispatchly.Application;
using Dispatchly.IntegrationTests.Support;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Dispatchly.IntegrationTests;

public sealed class AuthTests(PostgisServer postgis)
{
    private static CancellationToken Ct => TestContext.Current.CancellationToken;

    [Theory]
    [InlineData(Role.Dispatcher, "Dispatcher", "/api/v1/orders")]
    [InlineData(Role.Rider, "Neha Gupta", "/api/v1/rider/task")]
    [InlineData(Role.Customer, "Priya Nair", "/api/v1/restaurants?near=28.6315,77.2167")]
    public async Task Demo_sign_in_issues_a_token_for_the_seeded_account(Role role, string name, string probe)
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.DemoCity);

        var session = await (await app.Client().PostJsonAsync("/api/v1/auth/demo", new { role })).ReadAsync<DemoSession>();

        Assert.Equal(role, session.Role);
        Assert.Equal(name, session.Name);
        Assert.Equal(role == Role.Rider ? await app.DemoRiderIdAsync() : null, session.RiderId);
        Assert.Equal(role == Role.Customer ? await app.DemoCustomerIdAsync() : null, session.CustomerId);
        var now = DateTimeOffset.UtcNow;
        Assert.InRange(session.ExpiresAt, now.AddHours(11), now.AddHours(13));
        Assert.Equal(HttpStatusCode.OK, (await app.Client(session.Token).GetAsync(probe, Ct)).StatusCode);
    }

    [Fact]
    public async Task An_unknown_role_is_rejected()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.DemoCity);

        var response = await app.Client().PostJsonAsync("/api/v1/auth/demo", new { role = "Admin" });

        await response.AssertProblemAsync(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task Requests_without_a_valid_token_are_unauthorized()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.DemoCity);
        var jwt = app.Services.GetRequiredService<JwtOptions>();
        var now = DateTime.UtcNow;
        var expired = Token(jwt.Key(), jwt, issuedAt: now.AddHours(-13), expires: now.AddMinutes(-5));
        var otherKey = Token(new SymmetricSecurityKey(RandomNumberGenerator.GetBytes(48)), jwt, issuedAt: now, expires: now.AddHours(1));
        var otherIssuer = Token(jwt.Key(), new JwtOptions { Issuer = "someone-else", Audience = jwt.Audience }, issuedAt: now, expires: now.AddHours(1));

        foreach (var token in new[] { null, "not-a-jwt", expired, otherKey, otherIssuer })
        {
            foreach (var url in new[] { "/api/v1/orders", "/api/v1/rider/task", "/api/v1/stats/live", "/api/v1/restaurants?near=28.6,77.2" })
            {
                var response = await app.Client(token).GetAsync(url, Ct);
                Assert.True(response.StatusCode == HttpStatusCode.Unauthorized, $"{url} with token '{token}' gave {(int)response.StatusCode}");
            }
        }
    }

    [Fact]
    public async Task Each_role_only_reaches_its_own_endpoints()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.DemoCity);
        var customer = app.Customer(await app.DemoCustomerIdAsync());
        var rider = app.Rider(await app.DemoRiderIdAsync());
        var dispatcher = app.Dispatcher();

        (HttpClient Client, HttpMethod Method, string Url)[] forbidden =
        [
            (customer, HttpMethod.Get, "/api/v1/orders"),
            (customer, HttpMethod.Post, "/api/v1/orders/DL-4810/reassign"),
            (customer, HttpMethod.Get, "/api/v1/stats/live"),
            (customer, HttpMethod.Get, "/api/v1/rider/task"),
            (rider, HttpMethod.Get, "/api/v1/orders"),
            (rider, HttpMethod.Get, "/api/v1/orders/DL-4810"),
            (rider, HttpMethod.Post, "/api/v1/orders"),
            (rider, HttpMethod.Get, "/api/v1/restaurants?near=28.6,77.2"),
            (rider, HttpMethod.Get, "/api/v1/stats/live"),
            (dispatcher, HttpMethod.Post, "/api/v1/orders"),
            (dispatcher, HttpMethod.Get, "/api/v1/rider/task"),
            (dispatcher, HttpMethod.Post, "/api/v1/rider/location"),
            (dispatcher, HttpMethod.Get, "/api/v1/restaurants?near=28.6,77.2"),
        ];
        foreach (var (client, method, url) in forbidden)
        {
            // Authorization runs before the body is read, so any body will do.
            var response = method == HttpMethod.Get ? await client.GetAsync(url, Ct) : await client.PostJsonAsync(url, new { });
            Assert.True(response.StatusCode == HttpStatusCode.Forbidden, $"{method} {url} gave {(int)response.StatusCode}");
        }
    }

    private static string Token(SecurityKey key, JwtOptions jwt, DateTime issuedAt, DateTime expires) =>
        new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Issuer = jwt.Issuer,
            Audience = jwt.Audience,
            Claims = new Dictionary<string, object> { [ClaimNames.Role] = nameof(Role.Dispatcher), [ClaimNames.Name] = "Dispatcher" },
            IssuedAt = issuedAt,
            NotBefore = issuedAt,
            Expires = expires,
            SigningCredentials = new SigningCredentials(key, SecurityAlgorithms.HmacSha256),
        });
}
