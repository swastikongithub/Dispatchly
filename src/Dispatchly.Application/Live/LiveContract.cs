using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using Dispatchly.Domain.Riders;

namespace Dispatchly.Application.Live;

// The real-time contract (PLAN.md §3.6, docs/realtime.md). The mobile app depends on it, so
// change it only with approval (CLAUDE.md).

/// <summary>The SignalR groups. Clients join them through the hub's Join… methods.</summary>
public static class LiveGroups
{
    /// <summary>Dispatchers: the whole city.</summary>
    public const string Dispatch = "dispatch";

    /// <summary>Anyone, e.g. the landing page: rider positions and stats, no names or orders.</summary>
    public const string Public = "public";

    /// <summary>The customer who placed the order.</summary>
    public static string Order(string code) => $"order:{code}";

    /// <summary>The rider themself.</summary>
    public static string Rider(int riderId) => string.Create(CultureInfo.InvariantCulture, $"rider:{riderId}");
}

/// <summary>The messages the server sends. Every one carries the server time it was built at.</summary>
public static class LiveMessages
{
    /// <summary>dispatch, public. <see cref="Application.RidersBatch"/> every tick.</summary>
    public const string RidersBatch = "riders:batch";

    /// <summary>dispatch, public. (<see cref="LiveStats"/>, at) when a number changes.</summary>
    public const string StatsChanged = "stats:changed";

    /// <summary>dispatch: (<see cref="OrderSummary"/>, at). order:{code}: (<see cref="OrderDetails"/>, at).</summary>
    public const string OrderChanged = "order:changed";

    /// <summary>order:{code}. <see cref="Application.RiderPosition"/> every tick while a rider has the order.</summary>
    public const string RiderPosition = "rider:position";

    /// <summary>order:{code}. <see cref="Application.EtaChanged"/> when the shown minute or lateness changes.</summary>
    public const string EtaChanged = "eta:changed";

    /// <summary>rider:{id}. (<see cref="RiderTaskView"/>, at) when an order is given to the rider.</summary>
    public const string TaskAssigned = "task:assigned";

    /// <summary>rider:{id}. (<see cref="RiderTaskView"/>, at) when the task changes, is taken away or is delivered.</summary>
    public const string TaskChanged = "task:changed";
}

/// <summary>Writes a <see cref="RiderPoint"/> as <c>[id, lat, lng, bearing, "Status"]</c>, and reads it back.</summary>
public sealed class RiderPointJsonConverter : JsonConverter<RiderPoint>
{
    public override RiderPoint Read(ref Utf8JsonReader reader, Type typeToConvert, JsonSerializerOptions options)
    {
        Expect(ref reader, JsonTokenType.StartArray);
        Next(ref reader, JsonTokenType.Number);
        var id = reader.GetInt32();
        Next(ref reader, JsonTokenType.Number);
        var lat = reader.GetDouble();
        Next(ref reader, JsonTokenType.Number);
        var lng = reader.GetDouble();
        Next(ref reader, JsonTokenType.Number);
        var bearing = reader.GetInt32();
        Next(ref reader, JsonTokenType.String);
        var status = Enum.Parse<RiderStatus>(reader.GetString()!);
        Next(ref reader, JsonTokenType.EndArray);
        return new RiderPoint(id, lat, lng, bearing, status);
    }

    public override void Write(Utf8JsonWriter writer, RiderPoint value, JsonSerializerOptions options)
    {
        writer.WriteStartArray();
        writer.WriteNumberValue(value.Id);
        writer.WriteNumberValue(value.Lat);
        writer.WriteNumberValue(value.Lng);
        writer.WriteNumberValue(value.Bearing);
        writer.WriteStringValue(value.Status.ToString());
        writer.WriteEndArray();
    }

    private static void Next(ref Utf8JsonReader reader, JsonTokenType type)
    {
        if (!reader.Read())
        {
            throw new JsonException("A rider point ended early.");
        }
        Expect(ref reader, type);
    }

    private static void Expect(ref Utf8JsonReader reader, JsonTokenType type)
    {
        if (reader.TokenType != type)
        {
            throw new JsonException($"A rider point is [id, lat, lng, bearing, status]; found {reader.TokenType} where {type} belongs.");
        }
    }
}
