namespace Dispatchly.Domain;

/// <summary>
/// A business rule was broken, e.g. delivering an order that isn't picked up yet.
/// <see cref="Code"/> is stable and machine-readable; the message is for logs and developers.
/// </summary>
public sealed class DomainException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}
