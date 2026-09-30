using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;

namespace Aven.Bridge;

/// <summary>Entrée de l'explorateur (parité WorkspaceFileEntry de workspace-files.ts).</summary>
public sealed record FileEntry(string Name, string Path, string Kind, long Size, long Modified);

/// <summary>Fichier texte lu (parité WorkspaceTextFile).</summary>
public sealed record TextFile(string Path, long Size, bool Truncated, string Content);

/// <summary>Fil d'ariane (parité Breadcrumb de web/src/types.ts).</summary>
public sealed record Crumb(string Label, string Path);

/// <summary>
/// Explorateur de fichiers de l'espace (phase 4) — port de electron/workspace-files.ts :
/// LECTURE SEULE, toute résolution passe par <see cref="SafeResolve"/> qui ne peut
/// JAMAIS lire ni lister hors de la racine (traversée « .. », chemins absolus,
/// préfixes de lecteur), quel que soit l'appelant.
/// </summary>
public static class FilesService
{
    /// <summary>Taille maximale d'un fichier texte lisible dans l'aperçu (512 Kio, parité).</summary>
    public const int MaxTextBytes = 512 * 1024;

    /// <summary>Répertoires jamais exposés à la racine (config moteur, données d'app).</summary>
    private static readonly HashSet<string> RacinesCachées = new(StringComparer.Ordinal)
    { ".git", "node_modules", ".opencode", ".opencode-app", ".opencodeapp" };

    /// <summary>
    /// Résout un chemin RELATIF à la racine et garantit que le résultat reste DEDANS
    /// (parité ligne à ligne de safeResolve). Le test final est un « path.relative »
    /// fait main — la seule vérité, indépendante des séparateurs et des alias.
    /// </summary>
    public static string SafeResolve(string root, string? relative)
    {
        if (string.IsNullOrEmpty(root)) throw new InvalidOperationException("Aucun espace de travail actif.");
        var clean = (relative ?? "").Replace('\\', '/').Trim();
        if (clean.Length == 0 || clean == ".") return Path.GetFullPath(root);
        // Parité Node : path.isAbsolute(/x) est VRAI même sous Windows, mais un simple
        // « C:foo » (lecteur relatif) ne l'est pas — d'où la regex dédiée en plus.
        if (Path.IsPathRooted(clean) && (clean[0] == '/' || clean[0] == '\\')) throw new InvalidOperationException("Chemin absolu refusé.");
        if (Regex.IsMatch(clean, "^[a-zA-Z]:")) throw new InvalidOperationException("Chemin absolu refusé.");
        var segments = clean.Split('/', StringSplitOptions.RemoveEmptyEntries);
        if (segments.Any(s => s == "..")) throw new InvalidOperationException("Traversée de dossier refusée.");
        var resolved = Path.GetFullPath(Path.Combine(new[] { Path.GetFullPath(root) }.Concat(segments).ToArray()));
        var rel = Relatif(Path.GetFullPath(root), resolved);
        if (rel.Length == 0 || rel.StartsWith("..", StringComparison.Ordinal) || Path.IsPathRooted(rel))
            throw new InvalidOperationException("Chemin hors de l'espace de travail refusé.");
        return resolved;
    }

    /// <summary>path.relative de Node (fait main) : chemin de « de » vers « vers », ../ pour remonter.</summary>
    private static string Relatif(string de, string vers)
    {
        var partiesDe = de.Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries);
        var partiesVers = vers.Split(Path.DirectorySeparatorChar, StringSplitOptions.RemoveEmptyEntries);
        var communs = 0;
        while (communs < partiesDe.Length && communs < partiesVers.Length &&
               string.Equals(partiesDe[communs], partiesVers[communs], StringComparison.OrdinalIgnoreCase))
            communs++;
        var montées = Enumerable.Repeat("..", partiesDe.Length - communs);
        var descentes = partiesVers.Skip(communs);
        var rel = string.Join(Path.DirectorySeparatorChar, montées.Concat(descentes));
        return rel.Length == 0 ? "" : rel;
    }

    /// <summary>Détection binaire rapide : octet NUL dans les 8 premiers Kio (parité looksBinary).</summary>
    public static bool LooksBinary(byte[] buffer)
    {
        var sonde = Math.Min(8192, buffer.Length);
        for (var i = 0; i < sonde; i++)
            if (buffer[i] == 0) return true;
        return false;
    }

    /// <summary>Liste le contenu d'un dossier (tri : dossiers puis noms, parité listWorkspaceDir).</summary>
    public static IReadOnlyList<FileEntry> List(string root, string relative)
    {
        var dir = SafeResolve(root, relative);
        if (!Directory.Exists(dir)) throw new InvalidOperationException("Dossier introuvable dans l'espace de travail.");
        var relatifPropre = relative.Replace('\\', '/').TrimEnd('/');
        var entrées = new List<FileEntry>();
        foreach (var name in Directory.GetFileSystemEntries(dir).Select(Path.GetFileName))
        {
            if (name is null) continue;
            if (relatifPropre.Length == 0 && RacinesCachées.Contains(name)) continue;
            FileInfo info;
            try
            {
                info = new FileInfo(Path.Combine(dir, name));
                if (!info.Exists && !Directory.Exists(Path.Combine(dir, name))) continue;
            }
            catch { continue; } // disparu entre readdir et stat : ignoré
            var dossier = Directory.Exists(Path.Combine(dir, name));
            entrées.Add(new FileEntry(
                name,
                relatifPropre.Length > 0 ? $"{relatifPropre}/{name}" : name,
                dossier ? "dir" : "file",
                !dossier && info.Exists ? info.Length : 0,
                new DateTimeOffset((dossier ? Directory.GetLastWriteTimeUtc(Path.Combine(dir, name)) : info.LastWriteTimeUtc)).ToUnixTimeMilliseconds()));
        }
        return entrées
            .OrderBy(e => e.Kind == "dir" ? 0 : 1)
            .ThenBy(e => e.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    /// <summary>Lit un fichier texte (borné, binaire refusé avec message clair — parité readWorkspaceFile).</summary>
    public static TextFile Read(string root, string relative)
    {
        var file = SafeResolve(root, relative);
        var info = new FileInfo(file);
        if (!info.Exists) throw new InvalidOperationException("Fichier introuvable dans l'espace de travail.");
        if (Directory.Exists(file)) throw new InvalidOperationException("C'est un dossier, pas un fichier.");
        if (info.Length > MaxTextBytes * 4L) throw new InvalidOperationException("Fichier trop volumineux pour l'aperçu (limite : 2 Mio).");
        var buffer = File.ReadAllBytes(file);
        if (LooksBinary(buffer)) throw new InvalidOperationException("Fichier binaire : l'aperçu texte est indisponible.");
        var coupé = buffer.Length > MaxTextBytes;
        return new TextFile(
            relative.Replace('\\', '/'),
            info.Length,
            coupé,
            Encoding.UTF8.GetString(buffer, 0, (int)Math.Min(buffer.Length, MaxTextBytes)));
    }

    /// <summary>Fil d'ariane : segments { label, path } depuis la racine (parité breadcrumbOf).</summary>
    public static IReadOnlyList<Crumb> Breadcrumb(string? relative)
    {
        var segments = (relative ?? "").Replace('\\', '/').Split('/', StringSplitOptions.RemoveEmptyEntries)
            .Where(s => s != ".").ToArray();
        var crumbs = new List<Crumb> { new("Espace", "") };
        var acc = "";
        foreach (var segment in segments)
        {
            acc = acc.Length > 0 ? $"{acc}/{segment}" : segment;
            crumbs.Add(new Crumb(segment, acc));
        }
        return crumbs;
    }
}
