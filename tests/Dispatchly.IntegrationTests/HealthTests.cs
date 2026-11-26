using System.Net;
using Dispatchly.IntegrationTests.Support;

namespace Dispatchly.IntegrationTests;

public sealed class HealthTests(PostgisServer postgis)
{
    [Fact]
    public async Task Health_reports_healthy_when_the_database_is_reachable()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.None);

        var response = await app.Client().GetAsync("/health", TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal("Healthy", await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
    }
}
