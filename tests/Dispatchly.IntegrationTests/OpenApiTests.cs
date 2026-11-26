using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using Dispatchly.IntegrationTests.Support;

namespace Dispatchly.IntegrationTests;

/// <summary>
/// The web app's typed client is generated from web/src/app/core/api/openapi.json. This test
/// keeps that file equal to what the API serves: when they differ it rewrites the file and fails,
/// so the change shows up in the diff (and CI fails until the new contract is committed).
/// </summary>
public sealed class OpenApiTests(PostgisServer postgis)
{
    private static readonly JsonSerializerOptions Format = new()
    {
        WriteIndented = true,
        IndentSize = 2,
        NewLine = "\n",
        Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
    };

    [Fact]
    public async Task The_committed_openapi_document_matches_the_api()
    {
        await using var app = await TestApp.StartAsync(postgis, Seed.None);

        var served = await app.Client().GetStringAsync("/openapi/v1.json", TestContext.Current.CancellationToken);

        var document = JsonNode.Parse(served)!.AsObject();
        // Where the API runs isn't part of the contract (the web app calls it on its own origin).
        document.Remove("servers");
        var expected = document.ToJsonString(Format) + "\n";
        var path = Path.Combine(RepositoryRoot(), "web", "src", "app", "core", "api", "openapi.json");
        var committed = File.Exists(path) ? File.ReadAllText(path).ReplaceLineEndings("\n") : null;
        if (committed != expected)
        {
            Directory.CreateDirectory(Path.GetDirectoryName(path)!);
            File.WriteAllText(path, expected);
            Assert.Fail($"The API contract changed, so {path} was rewritten. Run `npm run api` in web/ to regenerate the client, then commit both.");
        }
    }

    private static string RepositoryRoot()
    {
        for (var directory = new DirectoryInfo(AppContext.BaseDirectory); directory is not null; directory = directory.Parent)
        {
            if (File.Exists(Path.Combine(directory.FullName, "Dispatchly.slnx")))
            {
                return directory.FullName;
            }
        }
        throw new InvalidOperationException("Couldn't find Dispatchly.slnx above " + AppContext.BaseDirectory);
    }
}
