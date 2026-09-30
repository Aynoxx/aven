using System.Text.Json.Nodes;

namespace Aven.Bridge;

/// <summary>Un message du transcript (parité ChatMsg de electron/operations.ts).</summary>
public sealed record ChatMsg(
    string Id,
    string Role,
    string Text,
    string? Agent = null,
    string? Model = null,
    bool Child = false,
    IReadOnlyList<ToolMsg>? Tools = null,
    string? Error = null,
    long? Created = null);

public sealed record ToolMsg(string Id, string Name, string Status, string? Output = null);

/// <summary>Référence de modèle « fournisseur/modèle » — parité model-ref.ts (coupe au PREMIER « / »).</summary>
public static class ModelRef
{
    public static (string ProviderID, string Id) Parse(string reference)
    {
        var i = reference.IndexOf('/');
        return i < 0 ? (reference, "") : (reference[..i], reference[(i + 1)..]);
    }

    public static string? Of(JsonNode? model) =>
        model is null ? null
        : Jsonx.S(model["providerID"]) is { } p && Jsonx.S(model["id"]) is { } id ? $"{p}/{id}" : null;
}

/// <summary>
/// Opérations de conversation (phase 3 du protocole MIGRATION-WINUI.md) — port de
/// electron/operations.ts sur le host JSON-RPC. Streaming : les événements push du
/// moteur sont réduits par <see cref="ConversationLive.Apply"/> (parité web/src/stream.ts),
/// le client publie chaque état immuable ; l'UI n'a qu'à afficher le dernier snapshot.
/// </summary>
public sealed class ConversationClient(EngineClient engine)
{
    private const string TitreDefaut = "Nouvelle conversation";
    private const int TitreMax = 60;

    /// <summary>Dernier état « en direct » publié (immuable : garde une référence, affiche-le).</summary>
    public event Action<ConversationLive>? LiveChanged;

    private ConversationLive _live = ConversationLive.Empty;
    public ConversationLive Live => _live;

    private Action<EngineEvent>? _abonnement;

    private static string TitreDepuis(string text)
    {
        var clean = string.Join(" ", text.Trim().Split(new[] { ' ', '\t', '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries));
        return clean.Length > TitreMax ? clean[..(TitreMax - 1)] + "…" : clean;
    }

    /// <summary>Abonne la réduction d'événements : child = la session d'un sous-agent (parité App.tsx).
    /// Réabonne proprement (désabonne l'ancien handler) si la conversation change.</summary>
    public void Subscribe(string chatId)
    {
        if (_abonnement is { } ancien) engine.EventReceived -= ancien;
        _abonnement = ev =>
        {
            var sid = Jsonx.S(Jsonx.At(ev.Data, "sessionID"));
            if (sid is null) return;
            var (live, _) = ConversationLive.Apply(_live, ev.Type, sid != chatId, ev.Data);
            Interlocked.Exchange(ref _live, live);
            LiveChanged?.Invoke(live);
        };
        engine.EventReceived += _abonnement;
    }

    // ── Conversations ─────────────────────────────────────────────────────────

    /// <summary>Crée une conversation : parité createChat (modèle épinglé, sinon session supprimée).</summary>
    public async Task<(string Id, string Title, string Agent, string Model)> CreateChatAsync(
        string agent, string workspace, CancellationToken cancellation = default)
    {
        var model = await engine.CallAsync("router.pick", new { agent }, cancellation).ConfigureAwait(false)
            ?? throw new InvalidOperationException($"Aucun modèle disponible pour l'agent « {agent} ». Vérifie les fournisseurs actifs et la table de priorités.");
        var reference = Jsonx.S(model) ?? "";
        var (provider, id) = ModelRef.Parse(reference);

        var créé = await engine.CallAsync("session.create", new
        {
            title = TitreDefaut,
            agent,
            location = new { directory = workspace },
            model = new { providerID = provider, id },
        }, cancellation).ConfigureAwait(false) ?? throw new InvalidOperationException("session.create sans réponse.");

        // Certaines versions du serveur ne renvoient pas le modèle dans session.create() :
        // on relit la session pour afficher le modèle effectivement sélectionné.
        var fresh = await engine.CallAsync("session.get", new { sessionID = Jsonx.S(créé["id"]) }, cancellation).ConfigureAwait(false);
        var resolved = ModelRef.Of(fresh?["model"]) ?? ModelRef.Of(créé["model"]);
        if (resolved is null)
        {
            await engine.CallAsync("session.remove", new { sessionID = Jsonx.S(créé["id"]) }, cancellation).ConfigureAwait(false);
            throw new InvalidOperationException($"L'agent « {agent} » n'a pas pu recevoir le modèle « {reference} ». OpenCode a créé une session sans modèle explicite.");
        }
        return (Jsonx.S(créé["id"]) ?? "", Jsonx.S(créé["title"]) ?? TitreDefaut,
            Jsonx.S(fresh?["agent"]) ?? Jsonx.S(créé["agent"]) ?? agent, resolved);
    }

    /// <summary>Envoie un message : titre auto au 1er message, beforeSend, prompt — parité send.</summary>
    public async Task SendAsync(string sessionId, string text, CancellationToken cancellation = default)
    {
        var clean = text.Trim();
        if (clean.Length == 0) throw new ArgumentException("Message vide", nameof(text));

        try
        {
            var info = await engine.CallAsync("session.get", new { sessionID = sessionId }, cancellation).ConfigureAwait(false);
            if ((Jsonx.S(info?["title"]) ?? TitreDefaut) == TitreDefaut)
            {
                var existing = await engine.CallAsync("message.list", new { sessionID = sessionId, order = "asc", limit = 1 }, cancellation).ConfigureAwait(false);
                if (existing?["data"] is not JsonArray array || array.Count == 0)
                    await engine.CallAsync("session.update", new { sessionID = sessionId, title = TitreDepuis(clean) }, cancellation).ConfigureAwait(false);
            }
        }
        catch { /* jamais bloquant pour l'envoi du message (parité operations.ts) */ }

        await engine.CallAsync("router.beforeSend", new { sessionID = sessionId, text = clean }, cancellation).ConfigureAwait(false);
        await engine.CallAsync("session.prompt", new { sessionID = sessionId, text = clean }, cancellation).ConfigureAwait(false);
    }

    /// <summary>Arrête le tour en cours (Échap côté interface) — best effort (parité interrupt).</summary>
    public async Task InterruptAsync(string sessionId, CancellationToken cancellation = default)
    {
        try { await engine.CallAsync("session.interrupt", new { sessionID = sessionId }, cancellation).ConfigureAwait(false); }
        catch { /* le serveur peut être parti */ }
    }

    public Task<JsonNode?> ChainForAsync(string agent, CancellationToken cancellation = default) =>
        engine.CallAsync("router.chainFor", new { agent }, cancellation);

    public Task<JsonNode?> ReplyFormAsync(string sessionId, string formId, object answer, CancellationToken cancellation = default) =>
        engine.CallAsync("session.form.reply", new { sessionID = sessionId, formID = formId, answer }, cancellation);

    public Task<JsonNode?> CancelFormAsync(string sessionId, string formId, CancellationToken cancellation = default) =>
        engine.CallAsync("session.form.cancel", new { sessionID = sessionId, formID = formId }, cancellation);

    /// <summary>Répond à une demande d'autorisation (once / always / reject) — parité permission.reply.</summary>
    public Task<JsonNode?> ReplyPermissionAsync(string sessionId, string requestId, string decision, CancellationToken cancellation = default) =>
        engine.CallAsync("permission.reply", new { sessionID = sessionId, requestID = requestId, decision }, cancellation);

    // ── Transcripts ───────────────────────────────────────────────────────────

    /// <summary>Transcript complet : session principale + sous-agents rattachés, tri chronologique (parité messages).</summary>
    public async Task<IReadOnlyList<ChatMsg>> MessagesAsync(string sessionId, string workspace, CancellationToken cancellation = default)
    {
        var main = await TranscriptAsync(sessionId, child: false, cancellation).ConfigureAwait(false);
        var sessions = await engine.CallAsync("session.list", new { directory = workspace, order = "asc", limit = 200 }, cancellation).ConfigureAwait(false);
        var children = (sessions?["data"] as JsonArray ?? [])
            .Where(s => Jsonx.S(Jsonx.At(s, "parentID")) == sessionId)
            .Select(s => Jsonx.S(Jsonx.At(s, "id")) ?? "")
            .Where(id => id.Length > 0)
            .ToArray();

        // Parité mapConcurrent(4) : les transcripts des sous-agents en parallèle, 4 à la fois.
        var attached = new List<ChatMsg>();
        await Parallel.ForEachAsync(
            children,
            new ParallelOptions { MaxDegreeOfParallelism = 4, CancellationToken = cancellation },
            async (childId, token) =>
            {
                foreach (var message in await TranscriptAsync(childId, child: true, token).ConfigureAwait(false))
                {
                    lock (attached) attached.Add(message);
                }
            }).ConfigureAwait(false);

        return main.Concat(attached).OrderBy(m => m.Created ?? 0).ToArray();
    }

    /// <summary>message.list → ChatMsg (mapping défensif de messagesOf, operations.ts).</summary>
    private async Task<IReadOnlyList<ChatMsg>> TranscriptAsync(string sessionId, bool child, CancellationToken cancellation)
    {
        var page = await engine.CallAsync("message.list", new { sessionID = sessionId, order = "asc", limit = 200 }, cancellation).ConfigureAwait(false);
        var out_ = new List<ChatMsg>();
        foreach (var message in page?["data"] as JsonArray ?? [])
        {
            if (message is not JsonObject m) continue;
            var created = Jsonx.N(Jsonx.At(Jsonx.At(m, "time"), "created"));
            if (Jsonx.S(m["type"]) == "user")
            {
                out_.Add(new ChatMsg(Jsonx.S(m["id"]) ?? "", "user", Jsonx.S(m["text"]) ?? "", Child: child, Created: created));
            }
            else if (Jsonx.S(m["type"]) == "assistant")
            {
                var content = m["content"] as JsonArray ?? [];
                out_.Add(new ChatMsg(
                    Jsonx.S(m["id"]) ?? "",
                    "assistant",
                    string.Join("", content.Where(c => Jsonx.S(Jsonx.At(c, "type")) == "text").Select(c => Jsonx.S(Jsonx.At(c, "text")) ?? "")),
                    Agent: Jsonx.S(m["agent"]),
                    Model: ModelRef.Of(m["model"]),
                    Child: child,
                    Tools: [.. content.Where(c => Jsonx.S(Jsonx.At(c, "type")) == "tool").Select(c =>
                        new ToolMsg(Jsonx.S(Jsonx.At(c, "id")) ?? "", Jsonx.S(Jsonx.At(c, "name")) ?? "", Jsonx.S(Jsonx.At(Jsonx.At(c, "state"), "status")) ?? "unknown",
                            SortieOutil(Jsonx.At(c, "state"))))],
                    Error: Jsonx.S(Jsonx.At(Jsonx.At(m, "error"), "message")),
                    Created: created));
            }
        }
        return out_;
    }

    private static string? SortieOutil(JsonNode? state)
    {
        if (state is null) return null;
        var candidate = Jsonx.At(state, "output") ?? Jsonx.At(state, "result") ?? Jsonx.At(state, "text");
        return candidate switch
        {
            JsonValue v when v.TryGetValue<string>(out var text) => text,
            JsonArray array => string.Join("\n", array.Select(n =>
                Jsonx.S(n) ?? (Jsonx.At(n, "text") is { } t ? Jsonx.S(t) ?? "" : "")).Where(s => s.Length > 0)) is { Length: > 0 } joined ? joined : null,
            _ => null,
        };
    }
}
