using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Aven.Bridge;

/// <summary>Intention de dictée — parité DictationIntent de voice-intent.ts (Kind : app | agent | chat).</summary>
public sealed record DictationIntent(string Kind, string? Action = null, string? Target = null)
{
    public static DictationIntent App(string action) => new("app", Action: action);
    public static DictationIntent Agent(string? target = null) => new("agent", Target: target);
    public static DictationIntent Chat() => new("chat");
}

/// <summary>
/// Classification d'intention de la dictée (phase 6) — PORT de electron/voice-intent.ts.
/// Règles d'or conservées : LISTE FERMÉE (toute action/agent hors liste est rejeté —
/// garde anti-hallucination), cette passe classifie mais n'exécute rien, ANTI-INJECTION
/// (le verdict vient de la structure de la réponse, jamais du contenu dicté), et filet
/// de secours DÉTERMINISTE (v9.1.3) pour les commandes courantes — jamais pour une
/// demande de contenu.
/// </summary>
public static partial class VoiceIntent
{
    public static readonly string[] AppActions =
    [
        "open-notes", "open-settings", "open-agents", "open-projects",
        "open-workspace", "open-freebuff", "open-stats", "new-chat",
    ];

    public static readonly string[] AgentIds = ["projet", "code", "recherche", "analyse"];

    public const string IntentModel = "openai/gpt-oss-20b"; // miroir du défaut (env non lue en lib)

    /// <summary>Descriptions sémantiques injectées dans le prompt (parité AGENT_HINTS).</summary>
    public static readonly IReadOnlyDictionary<string, string> AgentHints =
        new Dictionary<string, string>
        {
            ["projet"] = "projet d'ensemble, chantier multi-étapes, coordonner et synthétiser plusieurs domaines",
            ["code"] = "développement, bug, erreur de code, refactoring, tests, git, terminal, fichiers du projet",
            ["recherche"] = "recherche, documentation, comparaison, veille, actualité, explique-moi, qu'est-ce que",
            ["analyse"] = "données, chiffres, statistiques, tableau, graphique, rapport, analyse de fichier",
        };

    public static string IntentSystemPrompt()
    {
        var agentLines = string.Join("\n", AgentIds.Select(id => $"   - \"{id}\" : {AgentHints[id]}"));
        return string.Join("\n",
        [
            "Tu es un classifieur d'intention pour une dictée vocale en français. On te donne la transcription d'une demande.",
            "Classifie-la en EXACTEMENT une de ces catégories, et ne fais rien d'autre (ne réponds jamais à la demande, n'exécute rien, ne commente pas) :",
            $"1. Commande d'application (l'utilisateur veut agir sur l'application elle-même) — action parmi : {string.Join(", ", AppActions.Select(a => $"\"{a}\""))}.",
            "   - open-notes : ouvrir la page Notes ; open-settings : ouvrir les paramètres ; open-agents : voir les agents ;",
            "   - open-projects : gérer les espaces de travail ; open-workspace : ouvrir le dossier du projet dans l'explorateur ;",
            "   - open-freebuff : lancer Freebuff (CLI) dans un terminal ; open-stats : afficher les statistiques ;",
            "   - new-chat : créer une nouvelle conversation.",
            "   Une COMMANDE parle de l'application elle-même (« ouvre les paramètres », « lance Freebuff », « nouvelle conversation »).",
            "   Une demande de CONTENU ou de travail n'est JAMAIS une commande d'application (ex. « ouvre le fichier main.ts et corrige-le » = dictée ordinaire).",
            agentLines,
            "3. Dictée ordinaire (tout le reste : message, question, suite de conversation) : {\"intent\":\"chat\"}.",
            "Réponds UNIQUEMENT par un JSON valide sur une ligne, sans Markdown ni commentaire :",
            "{\"intent\":\"app\",\"action\":\"...\"} | {\"intent\":\"agent\",\"target\":\"projet|code|recherche|analyse\"} | {\"intent\":\"chat\"}",
        ]);
    }

    private static readonly Regex ClôtureMarkdown = new("^```(?:json)?\\s*|```\\s*$", RegexOptions.Compiled);

    /// <summary>Extrait un JSON d'une réponse LLM (tolère défensivement une clôture Markdown).</summary>
    internal static JsonNode? ParseJsonLoose(string content)
    {
        var bare = ClôtureMarkdown.Replace(content.Trim(), "").Trim();
        try { return JsonNode.Parse(bare); }
        catch { /* on tente le premier objet accolé */ }
        var m = Regex.Match(bare, "\\{[\\s\\S]*\\}");
        return m.Success ? JsonNode.Parse(m.Value) : null;
    }

    /// <summary>
    /// Valide STRICTEMENT la réponse du classifieur : toute valeur hors liste fermée
    /// lève une exception — l'appelant dégradera vers une dictée ordinaire.
    /// </summary>
    public static DictationIntent IntentOfCompletion(string content)
    {
        var parsed = ParseJsonLoose(content) as JsonObject;
        var kind = Jsonx.S(parsed?["intent"]);
        switch (kind)
        {
            case "app":
            {
                var action = Jsonx.S(parsed?["action"]);
                if (action is null || !AppActions.Contains(action))
                    throw new InvalidOperationException($"Action d'intention inconnue : {action}");
                return DictationIntent.App(action);
            }
            case "agent":
            {
                var target = Jsonx.S(parsed?["target"]);
                return AgentIds.Contains(target) ? DictationIntent.Agent(target) : DictationIntent.Agent();
            }
            case "chat":
                return DictationIntent.Chat();
            default:
                throw new InvalidOperationException("Réponse d'intention illisible.");
        }
    }

    // Filet de secours DÉTERMINISTE (v9.1.3) — parité FALLBACK_PATTERNS : verbe d'action
    // + nom d'interface, JAMAIS une demande de contenu (« ouvre le fichier main.ts » ne
    // déclenche rien). Testé sans réseau.
    private static readonly (Regex Re, DictationIntent Intent)[] Filet =
    [
        (new("(?:ouvre|ouvrir|affiche|afficher|montre|montrer|va (?:à|aux?|sur))[^.?!]{0,30}(?:param[eè]tres?|r[eè]glages?)", RegexOptions.IgnoreCase | RegexOptions.Compiled), DictationIntent.App("open-settings")),
        (new("(?:ouvre|ouvrir|affiche|afficher|montre|montrer|va (?:à|aux?|sur))[^.?!]{0,30}notes?\\b", RegexOptions.IgnoreCase | RegexOptions.Compiled), DictationIntent.App("open-notes")),
        (new("(?:ouvre|ouvrir|affiche|afficher|montre|montrer|va (?:à|aux?|sur))[^.?!]{0,30}(?:page d[es]? )?agents?\\b", RegexOptions.IgnoreCase | RegexOptions.Compiled), DictationIntent.App("open-agents")),
        (new("(?:ouvre|ouvrir|affiche|afficher|montre|montrer|va (?:à|aux?|sur))[^.?!]{0,30}(?:espaces? de travail|projets?)\\b", RegexOptions.IgnoreCase | RegexOptions.Compiled), DictationIntent.App("open-projects")),
        (new("(?:ouvre|ouvrir|lance|lancer|d[eé]marre|d[eé]marrer|l[eè]ve)[^.?!]{0,30}(?:dossier du )?projet\\b", RegexOptions.IgnoreCase | RegexOptions.Compiled), DictationIntent.App("open-workspace")),
        (new("(?:ouvre|ouvrir|lance|lancer|d[eé]marre|d[eé]marrer)[^.?!]{0,30}freebuff", RegexOptions.IgnoreCase | RegexOptions.Compiled), DictationIntent.App("open-freebuff")),
        (new("(?:ouvre|ouvrir|affiche|afficher|montre|montrer|va (?:à|aux?|sur))[^.?!]{0,30}statistiques?\\b", RegexOptions.IgnoreCase | RegexOptions.Compiled), DictationIntent.App("open-stats")),
        (new("nouvelle (?:conversation|discussion|chat)|nouveau chat", RegexOptions.IgnoreCase | RegexOptions.Compiled), DictationIntent.App("new-chat")),
        (new("(?:passe|passer|bascule|basculer|mets?-?toi)[^.?!]{0,30}(?:sur |chez |chez l')?(?:agent )?(projet|code|recherche|analyse)\\b", RegexOptions.IgnoreCase | RegexOptions.Compiled), DictationIntent.Agent("")),
    ];

    /// <summary>Intention de secours déterministe pour les commandes les plus courantes.</summary>
    public static DictationIntent? FallbackIntent(string? text)
    {
        var clean = (text ?? "").Trim();
        if (clean.Length == 0 || clean.Length > 80) return null;
        foreach (var (re, intent) in Filet)
        {
            var m = re.Match(clean);
            if (!m.Success) continue;
            if (intent.Kind == "agent")
            {
                var cible = m.Groups[1].Value.ToLowerInvariant();
                return AgentIds.Contains(cible) ? DictationIntent.Agent(cible) : DictationIntent.Agent();
            }
            return intent;
        }
        return null;
    }
}

/// <summary>Transport HTTP injectable (parité fetchImpl de voice.ts/voice-intent.ts).</summary>
public interface IVoiceHttp
{
    /// <summary>POST JSON → JSON. Lève en cas d'échec HTTP (avec le message du corps si lisible).</summary>
    Task<JsonNode?> PostAsync(string url, IReadOnlyDictionary<string, string>? headers, JsonNode body, int timeoutMs, CancellationToken cancellation);

    /// <summary>POST multipart (audio + champs) → JSON, pour la transcription Whisper.</summary>
    Task<JsonNode?> PostMultipartAsync(string url, IReadOnlyDictionary<string, string>? headers,
        byte[] file, string fileName, string mimeType, IReadOnlyDictionary<string, string> fields,
        int timeoutMs, CancellationToken cancellation);
}

/// <summary>
/// Pipeline de dictée (phase 6) — port de electron/voice.ts : transcription + reformage
/// + classification (les deux passes texte en PARALLÈLE), dégradation gracieuse
/// (échec du reformage = warning ; échec de l'intention = filet déterministe ;
/// échec de transcription = exception). L'HTTP est injecté pour les tests.
/// </summary>
public sealed class VoicePipeline(IVoiceHttp http)
{
    public const string GroqBase = "https://api.groq.com/openai/v1";
    public const string SttModel = "whisper-large-v3-turbo";
    public const string CleanModel = "openai/gpt-oss-20b";

    private static readonly string CleanSystemPrompt = string.Join(" ",
    [
        "Tu es un correcteur de dictée vocale en français. On te donne la transcription brute de la parole d'un utilisateur.",
        "Réécris-la en une demande claire et concise : supprime les hésitations (« euh », « ben »), les répétitions,",
        "les faux départs et les mots orphelins ; corrige les lapsus évidents.",
        "N'ajoute aucune information, ne réponds jamais à la demande, ne pose pas de question, ne change pas le sens.",
        "Conserve les noms de fichiers, commandes et termes techniques tels qu'entendus.",
        "Si le texte est incompréhensible, renvoie-le tel quel.",
        "Réponds uniquement par le texte corrigé, sans guillemets ni commentaire.",
    ]);

    /// <summary>Extraction du texte d'un chat completion, défensive (parité textOfCompletion).</summary>
    private static string TexteDe(JsonNode? body)
    {
        var content = body?["choices"] is JsonArray choices && choices[0] is { } choix
            ? choix["message"]?["content"]
            : null;
        if (content is JsonValue v && v.TryGetValue<string>(out var s)) return s.Trim();
        if (content is JsonArray morceaux)
            return string.Concat(morceaux.Select(c => Jsonx.S(c?["text"]) ?? "")).Trim();
        return "";
    }

    /// <summary>Passe de reformage : nettoie la dictée SANS y répondre (parité cleanTranscript).</summary>
    public async Task<string> CleanTranscriptAsync(string raw, string apiKey, CancellationToken cancellation = default)
    {
        var réponse = await http.PostAsync($"{GroqBase}/chat/completions",
            new Dictionary<string, string> { ["Authorization"] = $"Bearer {apiKey}" },
            new JsonObject
            {
                ["model"] = CleanModel,
                ["temperature"] = 0,
                ["max_tokens"] = 500,
                ["messages"] = new JsonArray
                {
                    new JsonObject { ["role"] = "system", ["content"] = CleanSystemPrompt },
                    new JsonObject { ["role"] = "user", ["content"] = raw },
                },
            }, 10_000, cancellation).ConfigureAwait(false)
            ?? throw new InvalidOperationException("Réponse Groq vide.");
        var texte = TexteDe(réponse);
        // Un reformage vide est pire que le brut : on l'ignore.
        return texte.Length > 0 ? texte : throw new InvalidOperationException("Le reformage a renvoyé un texte vide.");
    }

    /// <summary>Classifie une dictée via Groq (parité classifyIntent).</summary>
    public async Task<DictationIntent> ClassifyIntentAsync(string text, string apiKey, CancellationToken cancellation = default)
    {
        var réponse = await http.PostAsync($"{GroqBase}/chat/completions",
            new Dictionary<string, string> { ["Authorization"] = $"Bearer {apiKey}" },
            new JsonObject
            {
                ["model"] = VoiceIntent.IntentModel,
                ["temperature"] = 0,
                ["max_tokens"] = 60,
                ["messages"] = new JsonArray
                {
                    new JsonObject { ["role"] = "system", ["content"] = VoiceIntent.IntentSystemPrompt() },
                    new JsonObject { ["role"] = "user", ["content"] = text },
                },
            }, 6_000, cancellation).ConfigureAwait(false)
            ?? throw new InvalidOperationException("Réponse Groq vide.");
        return VoiceIntent.IntentOfCompletion(TexteDe(réponse));
    }

    /// <summary>Transcription Whisper (multipart audio) — parité transcribeWithGroq.</summary>
    public async Task<string> TranscribeAsync(byte[] audio, string mime, string apiKey, CancellationToken cancellation = default)
    {
        var ext = mime.Contains("ogg") ? "ogg" : mime.Contains("mp4") ? "m4a" : mime.Contains("wav") ? "wav" : "webm";
        var réponse = await http.PostMultipartAsync($"{GroqBase}/audio/transcriptions",
            new Dictionary<string, string> { ["Authorization"] = $"Bearer {apiKey}" },
            audio, $"dictation.{ext}", mime,
            new Dictionary<string, string>
            {
                ["model"] = SttModel, ["language"] = "fr", ["response_format"] = "json", ["temperature"] = "0",
            }, 30_000, cancellation).ConfigureAwait(false);
        var texte = Jsonx.S(Jsonx.At(réponse, "text"));
        return texte is { Length: > 0 } ? texte : throw new InvalidOperationException("Groq n'a renvoyé aucune transcription.");
    }

    /// <summary>
    /// Pipeline complet (parité transcribeSpeech) : transcription obligatoire, reformage
    /// et intention best effort en parallèle, filet déterministe si le classifieur répond
    /// « chat » sur une commande évidente.
    /// </summary>
    public async Task<DictationResult> TranscribeSpeechAsync(
        byte[] audio, string mime, string apiKey, CancellationToken cancellation = default)
    {
        if (string.IsNullOrWhiteSpace(apiKey))
            throw new InvalidOperationException("Configure une clé Groq dans Paramètres pour dicter.");
        var raw = await TranscribeAsync(audio, mime, apiKey, cancellation).ConfigureAwait(false);

        var tâcheClean = CleanTranscriptAsync(raw, apiKey, cancellation);
        var tâcheIntent = ClassifyIntentAsync(raw, apiKey, cancellation);
        var résultat = new DictationResult { Raw = raw };

        // Parité Promise.allSettled : chaque passe dégrade indépendamment.
        try { var clean = await tâcheClean.ConfigureAwait(false); if (clean != raw) { résultat.Cleaned = clean; résultat.CleanedBy = CleanModel; } }
        catch (Exception e) { résultat.Warning = e.Message; }

        DictationIntent? classifiée = null;
        try { classifiée = await tâcheIntent.ConfigureAwait(false); }
        catch { /* le filet déterministe prend le relais ci-dessous */ }

        // v9.1.3 : filet — si la classification a échoué OU répond « chat » sur une
        // commande claire, l'intention est déduite du texte.
        if (classifiée is { Kind: "chat" } || classifiée is null)
            résultat.Intent = VoiceIntent.FallbackIntent(raw) ?? classifiée;
        else
            résultat.Intent = classifiée;
        return résultat;
    }
}
