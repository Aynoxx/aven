using Aven.Bridge;
using Xunit;

namespace Aven.Tests;

/// <summary>
/// Port de electron/stats.ts : compteur de dictées persistant (même stats.json,
/// même reset journalier) et agrégations pures — mêmes chiffres que l'app Electron
/// sur les mêmes entrées.
/// </summary>
public class StatsServiceTests : IDisposable
{
    private readonly string _ws = Path.Combine(Path.GetTempPath(), "aven-stats-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        try { Directory.Delete(_ws, recursive: true); } catch { }
    }

    [Fact]
    public void Le_compteur_de_dictées_s_incrémente_et_persiste()
    {
        var jour = new DateTimeOffset(2026, 9, 30, 10, 0, 0, TimeSpan.Zero);
        StatsService.CountDictation(_ws, jour);
        StatsService.CountDictation(_ws, jour);
        var stats = StatsService.CountDictation(_ws, jour);

        Assert.Equal((3, "2026-09-30", 3), (stats.Total, stats.Day, stats.DayCount));

        // Relecture froide (fichier réouvert) — format parité stats.json.
        var relu = StatsService.ReadDictationStats(_ws);
        Assert.Equal(3, relu.Total);
        Assert.Equal(3, relu.DayCount);

        var json = File.ReadAllText(Path.Combine(_ws, ".opencode-app", "stats.json"));
        Assert.Contains("\"total\": 3", json);
        Assert.Contains("\"day\": \"2026-09-30\"", json);
    }

    [Fact]
    public void Le_compteur_journalier_se_reset_au_changement_de_jour()
    {
        var lundi = new DateTimeOffset(2026, 9, 28, 8, 0, 0, TimeSpan.Zero);
        var mardi = new DateTimeOffset(2026, 9, 29, 8, 0, 0, TimeSpan.Zero);
        StatsService.CountDictation(_ws, lundi);
        StatsService.CountDictation(_ws, lundi);
        var stats = StatsService.CountDictation(_ws, mardi);
        Assert.Equal((3, "2026-09-29", 1), (stats.Total, stats.Day, stats.DayCount));
    }

    [Fact]
    public void Un_fichier_corrompu_repart_de_zéro()
    {
        Directory.CreateDirectory(Path.Combine(_ws, ".opencode-app"));
        File.WriteAllText(Path.Combine(_ws, ".opencode-app", "stats.json"), "{ oops");
        var stats = StatsService.CountDictation(_ws);
        Assert.Equal((1, stats.Day, 1), (stats.Total, stats.Day, stats.DayCount));
    }

    [Fact]
    public void Les_agrégations_sont_identiques_à_celles_de_lelectron()
    {
        var payload = new StatsService.StatsPayload(
        [
            new("c1", "projet", false),
            new("c2", "projet", false),
            new("c3", "code", false),
            new("c4", "analyse", true),
        ],
        new DictationStats(7, "2026-09-30", 2),
        new Dictionary<string, long> { ["free/a"] = 3, ["free/b"] = 5, ["free/c"] = 0 });

        var stats = StatsService.Aggregate(payload, new[] { "projet", "code", "recherche", "analyse" });

        Assert.Equal(3, stats.TotalChats);
        Assert.Equal(1, stats.ArchivedChats);
        Assert.Equal([("projet", 2), ("code", 1)], stats.PerAgent);
        Assert.Equal(7, stats.DictationsTotal);
        Assert.Equal(2, stats.DictationsToday);
        Assert.Equal([("free/b", 5), ("free/a", 3)], stats.TopModels); // top 5, compteurs nuls exclus
    }
}
