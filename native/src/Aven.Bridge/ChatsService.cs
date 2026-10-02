using System.Text.Json.Nodes;

namespace Aven.Bridge;

/// <summary>
/// Métadonnées de conversations de l'espace — port de electron/archive.ts et
/// electron/agent-names.ts (jalon parité conversations, v10.0.0) : fichiers JSON de
/// <c>.opencode-app/</c>, MÊME format disque que l'Electron (tableau compact de chaînes,
/// objet de noms), aucune dépendance moteur (testable sans host).
/// </summary>
public static class ChatsService
{
    private static string Dir(string workspace) => Path.Combine(workspace, ".opencode-app");

    public static string ArchivedFile(string workspace) => Path.Combine(Dir(workspace), "archived.json");

    public static string AgentNamesFile(string workspace) => Path.Combine(Dir(workspace), "agent-names.json");

    /// <summary>Ids archivés (parité listArchived) : fichier absent ou illisible = ensemble vide.</summary>
    public static HashSet<string> ListArchived(string workspace)
    {
        var ids = new HashSet<string>();
        try
        {
            if (JsonNode.Parse(File.ReadAllText(ArchivedFile(workspace))) is JsonArray tableau)
            {
                foreach (var item in tableau)
                {
                    if (Jsonx.S(item) is { Length: > 0 } id) ids.Add(id);
                }
            }
        }
        catch { /* première utilisation ou JSON corrompu : rien d'archivé */ }
        return ids;
    }

    public static bool IsArchived(string workspace, string id) => ListArchived(workspace).Contains(id);

    /// <summary>Ajoute ou retire une entrée d'archive — parité setArchived (écriture atomique compacte).</summary>
    public static void SetArchived(string workspace, string id, bool archived)
    {
        var ids = ListArchived(workspace);
        if (archived) ids.Add(id); else ids.Remove(id);
        var liste = new JsonArray();
        foreach (var i in ids) liste.Add(i);
        AtomicFile.WriteJsonCompact(ArchivedFile(workspace), liste);
    }

    /// <summary>Noms AFFICHÉS des agents (parité loadNames) : chaînes non vides uniquement.</summary>
    public static Dictionary<string, string> LoadAgentNames(string workspace)
    {
        var noms = new Dictionary<string, string>();
        try
        {
            if (JsonNode.Parse(File.ReadAllText(AgentNamesFile(workspace))) is JsonObject brut)
            {
                foreach (var (id, valeur) in brut)
                {
                    if (Jsonx.S(valeur) is { } nom && nom.Trim().Length > 0)
                        noms[id] = nom.Trim();
                }
            }
        }
        catch { /* fichier absent ou illisible : aucun nom personnalisé */ }
        return noms;
    }
}
