using System.Diagnostics;
using Aven.Bridge;
using Xunit;

namespace Aven.Tests;

/// <summary>
/// Décision §5.3 du protocole : SQLite ADOPTÉ pour les stats. Preuves : parité
/// séquentielle avec le format JSON de stats.ts, migration du stats.json existant,
/// getStats 1 an rapide (impossible en JSON : aucun historique), concurrence deux
/// connexions, export JSON relu par le VRAI Node (compatibilité Classic).
/// </summary>
public class StatsSqliteTests : IDisposable
{
    private readonly string _ws = Path.Combine(Path.GetTempPath(), "aven-stats-db-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        try { Directory.Delete(_ws, recursive: true); } catch { }
    }

    private static readonly DateTimeOffset Jour1 = new(2026, 9, 30, 10, 0, 0, TimeSpan.Zero);
    private static readonly DateTimeOffset Jour2 = new(2026, 10, 1, 9, 0, 0, TimeSpan.Zero);

    [Fact]
    public void Parité_séquentielle_avec_le_format_JSON()
    {
        var wsJson = Path.Combine(Path.GetTempPath(), "aven-stats-json-" + Guid.NewGuid().ToString("N"));
        try
        {
            // Même séquence d'instants sur les deux moteurs.
            var viaJson = StatsService.CountDictation(wsJson, Jour1);
            viaJson = StatsService.CountDictation(wsJson, Jour1);
            viaJson = StatsService.CountDictation(wsJson, Jour2);

            var viaSqlite = StatsSqlite.CountDictation(_ws, Jour1);
            viaSqlite = StatsSqlite.CountDictation(_ws, Jour1);
            viaSqlite = StatsSqlite.CountDictation(_ws, Jour2);

            Assert.Equal((viaJson.Total, viaJson.Day, viaJson.DayCount), (viaSqlite.Total, viaSqlite.Day, viaSqlite.DayCount));
            Assert.Equal((3, "2026-10-01", 1), (viaSqlite.Total, viaSqlite.Day, viaSqlite.DayCount));

            // L'export SQLite est byte-identique au JSON écrit par l'ancien service.
            var jsonSqlite = File.ReadAllText(Path.Combine(_ws, ".opencode-app", "stats.json"));
            var jsonPur = File.ReadAllText(Path.Combine(wsJson, ".opencode-app", "stats.json"));
            Assert.Equal(jsonPur, jsonSqlite);

            // Lecture froide SQLite.
            var relu = StatsSqlite.ReadDictationStats(_ws);
            Assert.Equal(3, relu.Total);
            Assert.Equal(1, relu.DayCount);
        }
        finally
        {
            try { Directory.Delete(wsJson, recursive: true); } catch { }
        }
    }

    [Fact]
    public void Migration_importe_un_stats_json_préexistant()
    {
        Directory.CreateDirectory(Path.Combine(_ws, ".opencode-app"));
        var fichier = Path.Combine(_ws, ".opencode-app", "stats.json");
        File.WriteAllText(fichier, "{\n  \"total\": 7,\n  \"day\": \"2026-09-30\",\n  \"dayCount\": 2\n}");

        // Premier accès : la base naît et importe le compteur JSON.
        var lu = StatsSqlite.ReadDictationStats(_ws);
        Assert.Equal((7, "2026-09-30", 2), (lu.Total, lu.Day, lu.DayCount));

        var suite = StatsSqlite.CountDictation(_ws, Jour1);
        Assert.Equal(8, suite.Total);
        Assert.Equal(3, suite.DayCount);

        // La migration a posé le marqueur : le JSON peut changer ensuite SANS être réimporté.
        File.WriteAllText(fichier, "{\n  \"total\": 999,\n  \"day\": \"2020-01-01\",\n  \"dayCount\": 999\n}");
        Assert.Equal(8, StatsSqlite.ReadDictationStats(_ws).Total);
    }

    [Fact]
    public void GetStats_sur_un_an_une_requête_et_rapide()
    {
        // 365 jours, une dictée par jour — 365 transactions (grâce WAL, normal).
        var début = new DateTimeOffset(2025, 10, 1, 8, 0, 0, TimeSpan.Zero);
        for (var i = 0; i < 365; i++) StatsSqlite.CountDictation(_ws, début.AddDays(i));

        var chrono = Stopwatch.StartNew();
        var an = StatsSqlite.History(_ws, 365, début.AddDays(364));
        chrono.Stop();

        Assert.Equal(365, an.Count);
        Assert.Equal(365, an.Sum(l => l.Count));
        Assert.Equal("2025-10-01", an[0].Day);
        Assert.Equal("2026-09-30", an[^1].Day);
        // Critère de la décision §5.3 : getStats 1 an = UNE requête (le JSON ne peut
        // pas du tout répondre : il n'a aucun historique).
        Assert.True(chrono.ElapsedMilliseconds < 500, $"History(365) trop lent : {chrono.ElapsedMilliseconds} ms");
    }

    [Fact]
    public async Task Deux_connexions_écrivent_simultanément_sans_perte()
    {
        var tâches = Enumerable.Range(0, 2).Select(_ => Task.Run(() =>
        {
            for (var i = 0; i < 25; i++) StatsSqlite.CountDictation(_ws, Jour1);
        }));
        await Task.WhenAll(tâches);
        Assert.Equal(50, StatsSqlite.ReadDictationStats(_ws).Total);
        Assert.Equal(50, StatsSqlite.History(_ws, 30, Jour1).Single().Count);
    }

    [Fact]
    public void Le_vrai_Node_relit_le_JSON_exporté()
    {
        StatsSqlite.CountDictation(_ws, Jour1);
        StatsSqlite.CountDictation(_ws, Jour1);
        StatsSqlite.CountDictation(_ws, Jour1);

        var sortie = Process.Start(new ProcessStartInfo
        {
            FileName = "node",
            Arguments = "-e \"const s=JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'));console.log('total='+s.total+' dc='+s.dayCount)\" \"" + Path.Combine(_ws, ".opencode-app", "stats.json") + "\"",
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = System.Text.Encoding.UTF8,
            UseShellExecute = false,
            CreateNoWindow = true,
        }) ?? throw new InvalidOperationException("node introuvable");
        var outStd = sortie.StandardOutput.ReadToEnd();
        sortie.WaitForExit(15000);

        Assert.Equal(0, sortie.ExitCode);
        Assert.Contains("total=3", outStd);
        Assert.Contains("dc=3", outStd);
    }
}
