using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Aven.Bridge;

/// <summary>Entrée d'espace de travail (parité WorkspaceEntry de electron/workspaces.ts).</summary>
public sealed record WorkspaceEntry(string Path, string Name);

/// <summary>
/// Registre des espaces de travail — port de electron/workspaces.ts (v10.0.0, jalon
/// parité) : fichier <c>workspaces.json</c> dans le dossier de données natif, MÊME
/// FORMAT DISQUE que l'Electron (<c>{"list":[{path,name}],"active":…}</c>, JSON
/// compact atomique). Aucun espace imposé (v9.1.5) : registre absent ou sans « active »
/// = l'écran de choix s'affiche. Le registre Electron existant est importé UNE fois
/// au premier lancement (chaînes copiées telles quelles → réutilisables telles quelles).
/// </summary>
public static class WorkspacesService
{
    public static string Fichier(string dataDir) => Path.Combine(dataDir, "workspaces.json");

    private sealed record Registre(List<WorkspaceEntry> Entries, string? Active);

    private static Registre Read(string dataDir)
    {
        try
        {
            var root = JsonNode.Parse(File.ReadAllText(Fichier(dataDir))) as JsonObject;
            var entries = new List<WorkspaceEntry>();
            if (root?["list"] is JsonArray tableau)
            {
                foreach (var item in tableau)
                {
                    var chemin = JsonAide.Texte(item, "path");
                    if (chemin is null) continue;
                    entries.Add(new WorkspaceEntry(chemin, JsonAide.Texte(item, "name") ?? Path.GetFileName(chemin)));
                }
            }
            return new Registre(entries, JsonAide.Texte(root, "active"));
        }
        catch
        {
            /* première utilisation, fichier absent ou illisible */
        }
        return new Registre([], null);
    }

    private static void Write(string dataDir, Registre registre)
    {
        var liste = new JsonArray();
        foreach (var entry in registre.Entries)
            liste.Add(new JsonObject { ["path"] = entry.Path, ["name"] = entry.Name });
        var root = new JsonObject { ["list"] = liste };
        if (registre.Active is not null) root["active"] = registre.Active;
        AtomicFile.WriteJsonCompact(Fichier(dataDir), root); // parité writeJsonAtomic (compact)
    }

    public static IReadOnlyList<WorkspaceEntry> List(string dataDir) => Read(dataDir).Entries;

    /// <summary>Espace actif : UNIQUEMENT celui enregistré explicitement (jamais de repli par défaut).</summary>
    public static WorkspaceEntry? Active(string dataDir)
    {
        var registre = Read(dataDir);
        if (registre.Active is null) return null;
        return registre.Entries.Find(w => w.Path == registre.Active);
    }

    /// <summary>Ajoute (ou met à jour) un espace connu SANS l'activer — parité registerWorkspace.</summary>
    public static WorkspaceEntry Register(string dataDir, string dir, string name)
    {
        var clean = Path.GetFullPath(dir);
        var propre = name.Trim();
        var entry = new WorkspaceEntry(clean, propre.Length > 0 ? propre : Path.GetFileName(clean));
        var registre = Read(dataDir);
        var index = registre.Entries.FindIndex(w => Path.GetFullPath(w.Path) == clean);
        var entries = new List<WorkspaceEntry>(registre.Entries);
        if (index >= 0) entries[index] = entry; else entries.Add(entry);
        Write(dataDir, new Registre(entries, registre.Active));
        return entry;
    }

    /// <summary>Active un espace déjà enregistré — parité setActiveWorkspace (refus si inconnu ou disparu).</summary>
    public static void SetActive(string dataDir, string dir)
    {
        var clean = Path.GetFullPath(dir);
        var registre = Read(dataDir);
        if (!registre.Entries.Any(w => Path.GetFullPath(w.Path) == clean))
            throw new InvalidOperationException($"Espace de travail inconnu : {dir}");
        if (!Directory.Exists(clean))
            throw new InvalidOperationException("Le dossier de travail n’existe plus.");
        Write(dataDir, new Registre(registre.Entries, clean));
    }

    /// <summary>Retire un espace ; retirer l'espace actif ramène au CHOIX (parité removeWorkspace).</summary>
    public static IReadOnlyList<WorkspaceEntry> Remove(string dataDir, string dir)
    {
        var clean = Path.GetFullPath(dir);
        var registre = Read(dataDir);
        var entries = registre.Entries.Where(w => Path.GetFullPath(w.Path) != clean).ToList();
        var active = registre.Active is not null && Path.GetFullPath(registre.Active) == clean ? null : registre.Active;
        Write(dataDir, new Registre(entries, active));
        return entries;
    }

    /// <summary>Valide un chemin avant usage (hors liste ou dossier disparu = refus) — parité validateWorkspacePath.</summary>
    public static string Validate(string dataDir, string dir)
    {
        var clean = Path.GetFullPath(dir);
        var registre = Read(dataDir);
        if (!registre.Entries.Any(w => Path.GetFullPath(w.Path) == clean))
            throw new InvalidOperationException("Espace de travail non autorisé.");
        if (!Directory.Exists(clean))
            throw new InvalidOperationException("Le dossier de travail n’existe plus.");
        return clean;
    }

    /// <summary>
    /// Import initial du registre Electron Classic (v10.0.0) : si le registre NATIF
    /// est absent et que le registre Classic existe, ses espaces (et son actif) sont
    /// copiés tels quels — l'utilisateur retrouve ses espaces sans rien ressaisir.
    /// N'écrit JAMAIS côté Electron.
    /// </summary>
    public static IReadOnlyList<WorkspaceEntry> ListWithElectronImport(string dataDir, string electronDir)
    {
        var source = Path.Combine(electronDir, "workspaces.json");
        if (File.Exists(Fichier(dataDir)) || !File.Exists(source)) return List(dataDir);
        try
        {
            var root = JsonNode.Parse(File.ReadAllText(source)) as JsonObject;
            if (root?["list"] is JsonArray { Count: > 0 })
                AtomicFile.WriteJsonCompact(Fichier(dataDir), root); // même format : copie telle quelle
        }
        catch { /* registre Classic illisible : registre vide → écran de choix */ }
        return List(dataDir);
    }

    /// <summary>Validation du NOM d'espace — parité workspace:createNew (v9.0.0).</summary>
    public static void ValidateName(string clean)
    {
        if (!Regex.IsMatch(clean, @"^[^<>:""/\\|?*]+$") || clean is "." or ".." ||
            Regex.IsMatch(clean, @"^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\.|$)", RegexOptions.IgnoreCase))
            throw new InvalidOperationException("Nom d’espace de travail invalide.");
    }
}
