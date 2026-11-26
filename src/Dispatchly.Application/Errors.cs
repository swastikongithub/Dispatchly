namespace Dispatchly.Application;

/// <summary>The thing asked for doesn't exist, or the caller may not see it. Maps to 404.</summary>
public sealed class NotFoundException(string message) : Exception(message);

/// <summary>The request is well-formed but refers to something invalid, e.g. a menu item the restaurant doesn't have. Maps to 400.</summary>
public sealed class InvalidRequestException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}

/// <summary>The request can't be done in the current state, e.g. no other free rider to reassign to. Maps to 409.</summary>
public sealed class ConflictException(string code, string message) : Exception(message)
{
    public string Code { get; } = code;
}
