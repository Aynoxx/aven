using System.Text.Json.Nodes;

namespace Aven.Bridge;

/// <summary>Demande d'autorisation d'outil (événement permission.asked) — parité Ask de web/src/stream.ts.</summary>
public sealed record PermissionAsk(
    string Id,
    string SessionId,
    string Action,
    IReadOnlyList<string> Resources,
    string? Message);

/// <summary>Question posée par l'agent (outil « question », événement form.created) — forme brute conservée comme côté web.</summary>
public sealed record AgentForm(string Id, JsonNode? Raw);

/// <summary>Un outil en cours pendant le tour (parité live.tools).</summary>
public sealed record ToolLive(string Name, string Status, bool Child);

/// <summary>Texte en direct d'un message assistant (parité live.texts) — l'append se fait au dernier bloc, jamais de re-render global.</summary>
public sealed record MessageLive(string Text, bool Child);

/// <summary>
/// État « en direct » d'un tour d'agent — parité exacte de web/src/stream.ts (type Live).
/// Imuable : chaque <see cref="Apply"/> renvoie un NOUVEL état (copieincrémentale) ;
/// la couche UI peut publier le snapshot à tout instant sans re-rendu global.
/// </summary>
public sealed record ConversationLive(
    bool Busy,
    IReadOnlyList<string> Order,
    IReadOnlyDictionary<string, MessageLive> Texts,
    IReadOnlyDictionary<string, ToolLive> Tools,
    IReadOnlyList<PermissionAsk> Asks,
    IReadOnlyList<AgentForm> Forms,
    string? Error)
{
    public static readonly ConversationLive Empty =
        new(false, [], new Dictionary<string, MessageLive>(), new Dictionary<string, ToolLive>(), [], [], null);

    /// <summary>
    /// Réduit un événement du moteur dans l'état (port ligne à ligne de applyEvent, stream.ts).
    /// « child » = événement d'une session de sous-agent (le tour principal ne doit pas
    /// en tenir compte : parité `sid !== chatId` de App.tsx). « finished » = fin du tour principal.
    /// </summary>
    public static (ConversationLive Live, bool Finished) Apply(
        ConversationLive live, string type, bool child, JsonNode? data)
    {
        switch (type)
        {
            case "session.execution.started":
                if (child) return (live, false);
                return (live with { Busy = true, Error = null }, false);

            case "session.text.delta":
            {
                var id = Jsonx.S(Jsonx.At(data, "assistantMessageID")) ?? "";
                var delta = Jsonx.S(Jsonx.At(data, "delta")) ?? "";
                var prev = live.Texts.GetValueOrDefault(id) ?? new MessageLive("", child);
                var texts = new Dictionary<string, MessageLive>(live.Texts) { [id] = prev with { Text = prev.Text + delta } };
                var order = live.Texts.ContainsKey(id) ? live.Order : live.Order.Append(id).ToArray();
                return (live with { Order = order, Texts = texts }, false);
            }

            case "session.tool.input.started":
            {
                var id = Jsonx.S(Jsonx.At(data, "id")) ?? "";
                var tools = new Dictionary<string, ToolLive>(live.Tools)
                {
                    [id] = new(Jsonx.S(Jsonx.At(data, "name")) ?? "", "running", child),
                };
                return (live with { Tools = tools }, false);
            }

            case "session.tool.success":
            case "session.tool.failed":
            {
                var id = Jsonx.S(Jsonx.At(data, "id")) ?? "";
                var prev = live.Tools.GetValueOrDefault(id) ?? new ToolLive("outil", "running", child);
                var status = type == "session.tool.success" ? "completed" : "error";
                var tools = new Dictionary<string, ToolLive>(live.Tools) { [id] = prev with { Status = status } };
                return (live with { Tools = tools }, false);
            }

            case "permission.asked":
            {
                var resources = (Jsonx.At(data, "resources") as JsonArray)?
                    .Select(n => Jsonx.S(n) ?? "")
                    .ToArray() ?? [];
                var ask = new PermissionAsk(
                    Jsonx.S(Jsonx.At(data, "id")) ?? "",
                    Jsonx.S(Jsonx.At(data, "sessionID")) ?? "",
                    Jsonx.S(Jsonx.At(data, "action")) ?? "",
                    resources,
                    Jsonx.S(Jsonx.At(data, "message")));
                return (live with { Asks = live.Asks.Append(ask).ToArray() }, false);
            }

            case "permission.replied":
            {
                var requestId = Jsonx.S(Jsonx.At(data, "requestID")) ?? "";
                return (live with { Asks = live.Asks.Where(a => a.Id != requestId).ToArray() }, false);
            }

            case "form.created":
            {
                var form = Jsonx.At(data, "form");
                return (live with { Forms = live.Forms.Append(new AgentForm(Jsonx.S(Jsonx.At(form, "id")) ?? "", form)).ToArray() }, false);
            }

            case "form.replied":
            case "form.cancelled":
            {
                var id = Jsonx.S(Jsonx.At(data, "id")) ?? "";
                return (live with { Forms = live.Forms.Where(f => f.Id != id).ToArray() }, false);
            }

            // Fin du tour : uniquement pour la session principale (un sous-agent qui finit
            // ne termine pas le tour) — parité stream.ts.
            case "session.execution.succeeded":
            case "session.execution.interrupted":
                if (child) return (live, false);
                return (live with { Busy = false }, true);

            case "session.execution.failed":
                if (child) return (live, false);
                return (live with
                {
                    Busy = false,
                    Error = Jsonx.S(Jsonx.At(Jsonx.At(data, "error"), "message")) ?? "Erreur inconnue",
                }, true);

            default:
                return (live, false);
        }
    }
}

/// <summary>Lectures JSON tolérantes (les événements du moteur sont best effort, jamais bloquants).</summary>
internal static class Jsonx
{
    public static JsonNode? At(JsonNode? node, string key) => node is JsonObject o ? o[key] : null;

    public static string? S(JsonNode? node) => node is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    public static long? N(JsonNode? node) =>
        node is JsonValue v && v.TryGetValue<double>(out var d) && d > 0 ? (long)d : null;
}

/// <summary>Lectures JSON tolérantes exposées aux assemblages consommateurs (fenêtre, tests).</summary>
public static class JsonAide
{
    /// <summary>Texte d'une clé d'un objet JSON (null si absent ou non textuel).</summary>
    public static string? Texte(JsonNode? node, string clé) => Jsonx.S(Jsonx.At(node, clé));
}
