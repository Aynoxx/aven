using System.Text.Json;
using System.Text.Json.Nodes;

namespace Aven.Bridge;

/// <summary>Compteurs persistants de dictées (parité DictationStats de electron/stats.ts).</summary>
public sealed record DictationStats(long Total, string Day, long DayCount);

/// <summary>Chiffres affichables du panneau de stats (parité AggregatedStats de web/src/types.ts).</summary>
public sealed record AggregatedStats(
    long TotalChats,
    long ArchivedChats,
    IReadOnlyList<(string Agent, long Count)> PerAgent,
    long DictationsTotal,
    long DictationsToday,
    IReadOnlyList<(string Model, long Count)> TopModels);

/// <summary>
/// Statistiques Aven — port de electron/stats.ts : compteurs de dictées persistants
/// (`.opencode-app/stats.json`, même convention de dossier que les autres méta) et
/// agrégations PURES (testées sans disque). Même format disque que l'Electron.
/// </summary>
public static class StatsService
{
    private static string Fichier(string workspace) => Path.Combine(workspace, ".opencode-app", "stats.json");

    /// <summary>Aujourd'hui en ISO local (parité todayStr : année-mois-jour paddés).</summary>
    private static string Aujourdhui(DateTimeOffset now) =>
        now.ToString("yyyy-MM-dd", System.Globalization.CultureInfo.InvariantCulture);

    private static DictationStats ReadStats(string workspace)
    {
        try
        {
            var raw = JsonNode.Parse(File.ReadAllText(Fichier(workspace))) as JsonObject;
            if (raw is null) return new(0, "", 0);
            return new(
                raw["total"] is JsonValue t && t.TryGetValue<double>(out var total) && total >= 0 ? (long)total : 0,
                raw["day"]?.GetValue<string>() ?? "",
                raw["dayCount"] is JsonValue d && d.TryGetValue<double>(out var jour) && jour >= 0 ? (long)jour : 0);
        }
        catch
        {
            return new(0, "", 0);
        }
    }

    /// <summary>Incrémente le compteur de dictées (reset journalier — parité countDictation).</summary>
    public static DictationStats CountDictation(string workspace, DateTimeOffset? now = null)
    {
        var instant = now ?? DateTimeOffset.Now;
        var jour = Aujourdhui(instant);
        var stats = ReadStats(workspace);
        var total = stats.Total + 1;
        var mêmeJour = stats.Day == jour;
        var dayCount = mêmeJour ? stats.DayCount + 1 : 1;
        WriteStats(workspace, new DictationStats(total, jour, dayCount));
        return new(total, jour, dayCount);
    }

    public static DictationStats ReadDictationStats(string workspace) => ReadStats(workspace);

    private static void WriteStats(string workspace, DictationStats stats)
    {
        // Parité writeJsonAtomicPretty via le helper partagé (indenté \n, sans BOM).
        var objet = new JsonObject
        {
            ["total"] = stats.Total,
            ["day"] = stats.Day,
            ["dayCount"] = stats.DayCount,
        };
        AtomicFile.WriteJsonPretty(Fichier(workspace), objet);
    }

    // ── Agrégations pures (parité aggregateStats — testées sans disque) ───────

    public sealed record ChatLite(string Id, string? Agent, bool Archived);

    public sealed record StatsPayload(IReadOnlyList<ChatLite> Chats, DictationStats Dictations, IReadOnlyDictionary<string, long> ModelCounters);

    /// <summary>Agrège les données brutes en chiffres affichables (pure, parité aggregateStats).</summary>
    public static AggregatedStats Aggregate(StatsPayload payload, IEnumerable<string> agentIds)
    {
        var actifs = payload.Chats.Where(c => !c.Archived).ToList();
        var perAgent = agentIds
            .Select(agent => (Agent: agent, Count: (long)actifs.Count(c => c.Agent == agent)))
            .Where(e => e.Count > 0)
            .OrderByDescending(e => e.Count)
            .ToList();
        var autres = actifs.Count - perAgent.Sum(e => e.Count);
        if (autres > 0) perAgent.Add(("autre", autres));

        var topModels = payload.ModelCounters
            .Where(kv => kv.Value > 0)
            .OrderByDescending(kv => kv.Value)
            .Take(5)
            .Select(kv => (Model: kv.Key, Count: kv.Value))
            .ToList();

        return new AggregatedStats(
            actifs.Count,
            payload.Chats.Count - actifs.Count,
            perAgent,
            payload.Dictations.Total,
            payload.Dictations.DayCount,
            topModels);
    }
}
