using System.Security.Claims;
using System.Text;
using Dispatchly.Api.Live;
using Dispatchly.Application;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Dispatchly.Api.Auth;

/// <summary>JWT settings. The signing key comes from user-secrets or the environment, never from source.</summary>
public sealed class JwtOptions
{
    public const string Section = "Jwt";

    public string Issuer { get; init; } = "dispatchly";
    public string Audience { get; init; } = "dispatchly";

    /// <summary>At least 32 bytes (HMAC-SHA256). Required.</summary>
    public string SigningKey { get; init; } = "";

    public TimeSpan Lifetime { get; init; } = TimeSpan.FromHours(12);

    public SymmetricSecurityKey Key() => new(Encoding.UTF8.GetBytes(SigningKey));
}

public static class ClaimNames
{
    public const string Role = "role";
    public const string Name = "name";
    public const string RiderId = "rider_id";
    public const string CustomerId = "customer_id";
}

public static class DemoAuth
{
    public static IServiceCollection AddDemoAuth(this IServiceCollection services, IConfiguration configuration)
    {
        var jwt = configuration.GetSection(JwtOptions.Section).Get<JwtOptions>() ?? new JwtOptions();
        if (Encoding.UTF8.GetByteCount(jwt.SigningKey) < 32)
        {
            throw new InvalidOperationException(
                "Set Jwt:SigningKey to a random value of at least 32 characters (user-secrets or the Jwt__SigningKey environment variable). See README.");
        }
        services.AddSingleton(jwt);
        services
            .AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
            .AddJwtBearer(options =>
            {
                options.MapInboundClaims = false;
                options.TokenValidationParameters = new TokenValidationParameters
                {
                    ValidIssuer = jwt.Issuer,
                    ValidAudience = jwt.Audience,
                    IssuerSigningKey = jwt.Key(),
                    ValidAlgorithms = [SecurityAlgorithms.HmacSha256],
                    RoleClaimType = ClaimNames.Role,
                    NameClaimType = ClaimNames.Name,
                    ClockSkew = TimeSpan.FromSeconds(30),
                };
                // Browsers can't set headers on a WebSocket, so the live hub takes the token from
                // ?access_token= (on the hub's path only).
                options.Events = new JwtBearerEvents
                {
                    OnMessageReceived = context =>
                    {
                        var token = context.Request.Query["access_token"].ToString();
                        if (token.Length > 0 && context.Request.Path.StartsWithSegments(LiveHub.Path))
                        {
                            context.Token = token;
                        }
                        return Task.CompletedTask;
                    },
                };
            });
        services.AddAuthorization();
        services.AddSingleton<TokenIssuer>();
        return services;
    }

    /// <summary>The caller as a <see cref="Viewer"/>: their role and their rider or customer id.</summary>
    public static Viewer ToViewer(this ClaimsPrincipal user)
    {
        var role = Enum.Parse<Role>(user.FindFirstValue(ClaimNames.Role) ?? throw new InvalidOperationException("No role claim."));
        return new Viewer(role, IdClaim(user, ClaimNames.CustomerId), IdClaim(user, ClaimNames.RiderId));
    }

    public static int RiderId(this ClaimsPrincipal user) =>
        IdClaim(user, ClaimNames.RiderId) ?? throw new InvalidOperationException("No rider_id claim.");

    public static int CustomerId(this ClaimsPrincipal user) =>
        IdClaim(user, ClaimNames.CustomerId) ?? throw new InvalidOperationException("No customer_id claim.");

    private static int? IdClaim(ClaimsPrincipal user, string type) =>
        int.TryParse(user.FindFirstValue(type), out var id) ? id : null;
}

public sealed class TokenIssuer(JwtOptions options, TimeProvider clock)
{
    private readonly JsonWebTokenHandler _handler = new();

    public (string Token, DateTimeOffset ExpiresAt) Issue(Role role, string name, int? riderId = null, int? customerId = null)
    {
        var now = clock.GetUtcNow();
        var expiresAt = now + options.Lifetime;
        var claims = new Dictionary<string, object>
        {
            [JwtRegisteredClaimNames.Sub] = riderId is { } r ? $"rider:{r}" : customerId is { } c ? $"customer:{c}" : "dispatcher:demo",
            [ClaimNames.Role] = role.ToString(),
            [ClaimNames.Name] = name,
        };
        if (riderId is { } rider)
        {
            claims[ClaimNames.RiderId] = rider;
        }
        if (customerId is { } customer)
        {
            claims[ClaimNames.CustomerId] = customer;
        }
        var token = _handler.CreateToken(new SecurityTokenDescriptor
        {
            Issuer = options.Issuer,
            Audience = options.Audience,
            Claims = claims,
            IssuedAt = now.UtcDateTime,
            NotBefore = now.UtcDateTime,
            Expires = expiresAt.UtcDateTime,
            SigningCredentials = new SigningCredentials(options.Key(), SecurityAlgorithms.HmacSha256),
        });
        return (token, expiresAt);
    }
}
