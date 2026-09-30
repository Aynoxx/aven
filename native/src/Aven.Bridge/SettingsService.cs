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
        // Byte-parité writeJsonAtomic : JSON compact, UTF-8 sans BOM, temp puis remplacement.
        var objet = new JsonObject
        {
            ["notifications"] = prefs.Notifications,
            ["freebuffResume"] = prefs.FreebuffResume,
        };
        var cible = Fichier(dataDir);
        Directory.CreateDirectory(dataDir);
        var temp = cible + ".tmp-" + Guid.NewGuid().ToString("N");
        File.WriteAllText(temp, objet.ToJsonString(), new System.Text.UTF8Encoding(false));
        File.Move(temp, cible, overwrite: true);
        return prefs;
    }
}
