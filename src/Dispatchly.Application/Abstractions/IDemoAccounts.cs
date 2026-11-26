namespace Dispatchly.Application.Abstractions;

/// <summary>The seeded accounts that "Try as Rider / Customer" signs into (PLAN.md §1.3).</summary>
public interface IDemoAccounts
{
    Task<DemoAccount?> RiderAsync(CancellationToken ct);

    Task<DemoAccount?> CustomerAsync(CancellationToken ct);
}

public sealed record DemoAccount(int Id, string Name);
