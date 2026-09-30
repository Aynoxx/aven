using System.Text.Json;
using System.Text.Json.Nodes;

namespace Aven.Bridge;

/// <summary>Préférences utilisateur (parité Prefs de electron/prefs.ts).</summary>
public sealed record Prefs(bool Notifications, bool FreebuffResume);

/// <summary>
/// Préférences utilisateur — port de electron/prefs.ts : fichier `prefs.json` dans
/// le dossier de données de l'app, lecture tolérante (défaut : notifications actives,
/// reprise Freebuff inactive — parité stricte des « !== false » et « === true »),
/// écriture JSON ATOMIQUE COMPACTE (parité writeJsonAtomic — SANS indentation, à la
/// différence du meta des notes qui utilise la variante Pretty).
/// </summary>
public static class SettingsService
{
    public static string Fichier(string dataDir) => Path.Combine(dataDir, "prefs.json");

    public static Prefs Load(string dataDir)
    {
        try
        {
            var raw = JsonNode.Parse(File.ReadAllText(Fichier(dataDir))) as JsonObject;
            if (raw is null) return new(true, false);
            return new(
                Notifications: raw["notifications"] is not JsonValue n || !n.TryGetValue<bool>(out var notif) || notif,
                FreebuffResume: raw["freebuffResume"] is JsonValue f && f.TryGetValue<bool>(out var resume) && resume);
        }
        catch
        {
            return new(true, false);
        }
    }

    public static Prefs SaveNotifications(string dataDir, bool notifications) =>
        Save(dataDir, Load(dataDir) with { Notifications = notifications });

    public static Prefs SaveFreebuffResume(string dataDir, bool freebuffResume) =>
        Save(dataDir, Load(dataDir) with { FreebuffResume = freebuffResume });

    private static Prefs Save(string dataDir, Prefs prefs)
    {
        // Parité writeJsonAtomic : JSON COMPACT, atomique via le helper partagé.
        var objet = new JsonObject
        {
            ["notifications"] = prefs.Notifications,
            ["freebuffResume"] = prefs.FreebuffResume,
        };
        AtomicFile.WriteJsonCompact(Fichier(dataDir), objet);
        return prefs;
    }
}
