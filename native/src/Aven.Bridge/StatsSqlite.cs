using System.Globalization;
using Microsoft.Data.Sqlite;

namespace Aven.Bridge;

/// <summary>
/// Stockage SQLite des dictées — décision §5.3 du protocole (MIGRATION-WINUI.md) :
/// SQLite ADOPTÉ. Le critère « getStats sur 1 an » est IMPOSSIBLE à remplir par
/// stats.json : il ne porte qu'un compteur (total/day/dayCount), aucun historique ;
/// SQLite agrège les lignes journalières en une requête. La base vit à côté du JSON
/// (workspace/.opencode-app/stats.db), WAL + busy_timeout pour la concurrence deux
/// apps (mêmes garanties que les notes). stats.json RESTE écrit à chaque incrément
/// (format Electron byte-parité) : c'est l'EXPORT de compatibilité — l'app Classic
/// ne connaît que lui. Migration : un stats.json préexistant est importé UNE fois
/// (marqueur meta migrated=1) au premier accès.
/// </summary>
public static class StatsSqlite
{
    /// <summary>Attente maximale d'un verrou d'écriture (deux apps simultanées).</summary>
    public const int BusyTimeoutMs = 5000;
    private const int Tentatives = 3;

    private static string Chemin(string workspace) => Path.Combine(workspace, ".opencode-app", "stats.db");

    /// <summary>Aujourd'hui en ISO local (parité todayStr de stats.ts).</summary>
    private static string Jour(DateTimeOffset instant) =>
        instant.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    /// <summary>Ouvre la base : création du schéma, WAL, migration idempotente du JSON.</summary>
    private static SqliteConnection Ouvrir(string workspace)
    {
        Directory.CreateDirectory(Path.Combine(workspace, ".opencode-app"));
        var conn = new SqliteConnection(new SqliteConnectionStringBuilder { DataSource = Chemin(workspace) }.ToString());
        conn.Open();
        Exécuter(conn, $"PRAGMA journal_mode=WAL;PRAGMA busy_timeout={BusyTimeoutMs};PRAGMA synchronous=NORMAL;");
        Exécuter(conn,
            "CREATE TABLE IF NOT EXISTS dictations (day TEXT PRIMARY KEY, count INTEGER NOT NULL);" +
            "CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);");
        MigrerLeJson(conn, workspace);
        return conn;
    }

    /// <summary>Importe stats.json UNE fois si la base vient de naître (marqueur migrated).</summary>
    private static void MigrerLeJson(SqliteConnection conn, string workspace)
    {
        if (Meta(conn, "migrated") is not null) return;
        var json = StatsService.ReadDictationStats(workspace); // tolérant (fichier absent/corrompu → zéros)
        using var tx = conn.BeginTransaction();
        if (json.Total > 0) Définir(conn, "total", json.Total.ToString(CultureInfo.InvariantCulture), tx);
        if (json.Day.Length > 0) Définir(conn, "day", json.Day, tx);
        if (json.DayCount > 0) Définir(conn, "dayCount", json.DayCount.ToString(CultureInfo.InvariantCulture), tx);
        if (json.Total > 0 && json.Day.Length > 0 && json.DayCount > 0)
            UpsertJour(conn, json.Day, json.DayCount, tx); // le compteur du jour courant devient l'« historique » initial
        Définir(conn, "migrated", "1", tx);
        tx.Commit();
    }

    private static string? Meta(SqliteConnection conn, string clé)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT value FROM meta WHERE key = @k";
        cmd.Parameters.AddWithValue("@k", clé);
        return cmd.ExecuteScalar() as string;
    }

    private static void Définir(SqliteConnection conn, string clé, string valeur, SqliteTransaction? tx = null)
    {
        using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = "INSERT INTO meta (key, value) VALUES (@k, @v) ON CONFLICT(key) DO UPDATE SET value = @v";
        cmd.Parameters.AddWithValue("@k", clé);
        cmd.Parameters.AddWithValue("@v", valeur);
        cmd.ExecuteNonQuery();
    }

    private static void UpsertJour(SqliteConnection conn, string jour, long count, SqliteTransaction? tx = null)
    {
        using var cmd = conn.CreateCommand();
        cmd.Transaction = tx;
        cmd.CommandText = "INSERT INTO dictations (day, count) VALUES (@d, @c) ON CONFLICT(day) DO UPDATE SET count = @c";
        cmd.Parameters.AddWithValue("@d", jour);
        cmd.Parameters.AddWithValue("@c", count);
        cmd.ExecuteNonQuery();
    }

    /// <summary>Incrémente le compteur (sémantique IDENTIQUE à stats.ts : reset journalier)
    /// en SQLite, puis écrit l'export JSON de compatibilité (parité writeJsonAtomicPretty).</summary>
    public static DictationStats CountDictation(string workspace, DateTimeOffset? now = null)
    {
        var instant = now ?? DateTimeOffset.Now;
        var jour = Jour(instant);
        for (var tentative = 1; ; tentative++)
        {
            try
            {
                using var conn = Ouvrir(workspace);
                using var tx = conn.BeginTransaction(); // BEGIN : le read-modify-write reste atomique
                var total = long.TryParse(Meta(conn, "total"), NumberStyles.Integer, CultureInfo.InvariantCulture, out var t) ? t : 0;
                var ancienJour = Meta(conn, "day") ?? "";
                var dayCount = long.TryParse(Meta(conn, "dayCount"), NumberStyles.Integer, CultureInfo.InvariantCulture, out var d) ? d : 0;
                total++;
                var nouveauDayCount = ancienJour == jour ? dayCount + 1 : 1;
                Définir(conn, "total", total.ToString(CultureInfo.InvariantCulture), tx);
                Définir(conn, "day", jour, tx);
                Définir(conn, "dayCount", nouveauDayCount.ToString(CultureInfo.InvariantCulture), tx);
                UpsertJour(conn, jour, nouveauDayCount, tx);
                tx.Commit();
                var stats = new DictationStats(total, jour, nouveauDayCount);
                StatsService.WriteStats(workspace, stats); // export Classic (même format byte)
                return stats;
            }
            catch (SqliteException) when (tentative < Tentatives)
            {
                // busy_timeout a déjà attendu ; un dernier conflit se retente — la
                // concurrence deux apps est couverte par TwoAppsConcurrencyTests.
            }
        }
    }

    /// <summary>Lecture du compteur (affichage) — crée/migre la base si nécessaire.</summary>
    public static DictationStats ReadDictationStats(string workspace)
    {
        using var conn = Ouvrir(workspace);
        var total = long.TryParse(Meta(conn, "total"), NumberStyles.Integer, CultureInfo.InvariantCulture, out var t) ? t : 0;
        var jour = Meta(conn, "day") ?? "";
        var dayCount = long.TryParse(Meta(conn, "dayCount"), NumberStyles.Integer, CultureInfo.InvariantCulture, out var d) ? d : 0;
        return new(total, jour, dayCount);
    }

    /// <summary>
    /// getStats sur N jours (le critère de la décision §5.3) : lignes journalières
    /// présentes dans la fenêtre, triées croissant (Day, Count). Une requête, quel
    /// que soit le volume — c'est ce que le JSON de compatibilité ne peut pas faire.
    /// </summary>
    public static IReadOnlyList<(string Day, long Count)> History(string workspace, int days, DateTimeOffset? now = null)
    {
        var aujourdhui = Jour(now ?? DateTimeOffset.Now);
        var depuis = DateOnly.Parse(aujourdhui, CultureInfo.InvariantCulture)
            .AddDays(-(days - 1)).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        using var conn = Ouvrir(workspace);
        using var cmd = conn.CreateCommand();
        cmd.CommandText = "SELECT day, count FROM dictations WHERE day >= @d ORDER BY day";
        cmd.Parameters.AddWithValue("@d", depuis);
        using var reader = cmd.ExecuteReader();
        var lignes = new List<(string, long)>();
        while (reader.Read()) lignes.Add((reader.GetString(0), reader.GetInt64(1)));
        return lignes;
    }

    private static void Exécuter(SqliteConnection conn, string sql)
    {
        using var cmd = conn.CreateCommand();
        cmd.CommandText = sql;
        cmd.ExecuteNonQuery();
    }
}
