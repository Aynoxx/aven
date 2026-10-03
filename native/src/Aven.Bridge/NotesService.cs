using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Aven.Bridge;

/// <summary>Une note de l'espace (parité Note de web/src/types.ts).</summary>
public sealed record Note(string Id, string Title, string Markdown, long Updated);

/// <summary>
/// Notes Markdown de l'espace — port fidèle de electron/notes.ts et notes-meta.ts :
/// MÊME FORMAT DISQUE. Les deux applications (Electron et native) lisent et écrivent
/// les mêmes fichiers, souvent en même temps sur le même espace :
///  · notes            : `workspace/.opencodeapp/notes/*.md` (sans tiret, convention historique)
///  · métadonnées      : `workspace/.opencode-app/notes-meta.json` (avec tiret, comme les autres méta)
/// Toute la sémantique est conservée : titre dérivé du premier `# `, id dérivé du titre
/// (accents retirés) avec suffixes de collision, refus de traversée de chemin,
/// écriture JSON atomique indentée, quotas d'épinglage et de tags.
/// </summary>
public static class NotesService
{
    public const int MaxPinned = 20;
    public const int MaxNoteTags = 6;

    private static string NoteDir(string workspace) => Path.Combine(workspace, ".opencodeapp", "notes");

    /// <summary>Dossier des notes de l'espace (parité notesDir).</summary>
    public static string Dir(string workspace) => NoteDir(workspace);

    private static string MetaFile(string workspace) => Path.Combine(workspace, ".opencode-app", "notes-meta.json");

    /// <summary>Id dérivé du titre : minuscules, accents retirés, non-alnum → tiret, 70 car. (parité safeId).</summary>
    public static string SafeId(string value)
    {
        var normalized = RetirerAccents(value.ToLowerInvariant());
        var id = new string(normalized.Select(c => char.IsAsciiLetterOrDigit(c) ? c : '-').ToArray());
        id = Regex.Replace(id, "-{2,}", "-").Trim('-');
        var coupe = id.Length > 70 ? id[..70].TrimEnd('-') : id;
        return coupe.Length > 0 ? coupe : $"note-{DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()}";
    }

    /// <summary>Titre nettoyé : espaces réduits, 120 car., jamais vide (parité cleanTitle).</summary>
    public static string CleanTitle(string? value)
    {
        var clean = string.IsNullOrWhiteSpace(value) ? "" : Regex.Replace(value.Trim(), "\\s+", " ");
        clean = clean.Length > 120 ? clean[..120].Trim() : clean;
        return clean.Length > 0 ? clean : "Sans titre";
    }

    private static string RetirerAccents(string value) =>
        value.Normalize(NormalizationForm.FormD).Replace("\u0301", "")
             .Aggregate(new StringBuilder(), (sb, c) => char.GetUnicodeCategory(c) == UnicodeCategory.NonSpacingMark ? sb : sb.Append(c))
             .ToString().Normalize(NormalizationForm.FormC);

    private static string NotePath(string workspace, string id)
    {
        var clean = Path.GetFileName(id);
        if (clean.Length == 0 || clean != id || !clean.EndsWith(".md", StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Note invalide");
        return Path.Combine(NoteDir(workspace), clean);
    }

    private static void EnsureNoteDir(string workspace) => Directory.CreateDirectory(NoteDir(workspace));

    private static Note Lire(string workspace, string id, string markdown, DateTime mtime) =>
        new(id, TitreDe(id, markdown), markdown, new DateTimeOffset(mtime).ToUnixTimeMilliseconds());

    private static string TitreDe(string id, string markdown)
    {
        var première = Regex.Match(markdown, "^#\\s+(.+)$", RegexOptions.Multiline);
        return CleanTitle(première.Success ? première.Groups[1].Value : id.Replace(".md", ""));
    }

    /// <summary>Liste triée par id décroissant (parité listNotes).</summary>
    public static IReadOnlyList<Note> List(string workspace)
    {
        EnsureNoteDir(workspace);
        return Directory.GetFiles(NoteDir(workspace), "*.md")
            .Select(chemin => Path.GetFileName(chemin))
            .Select(id => Lire(workspace, id, File.ReadAllText(Path.Combine(NoteDir(workspace), id)), File.GetLastWriteTimeUtc(Path.Combine(NoteDir(workspace), id))))
            .OrderByDescending(n => n.Id, StringComparer.Ordinal)
            .ToArray();
    }

    public static Note Get(string workspace, string id)
    {
        var file = NotePath(workspace, id);
        if (!File.Exists(file)) throw new InvalidOperationException("Note introuvable");
        return Lire(workspace, id, File.ReadAllText(file), File.GetLastWriteTimeUtc(file));
    }

    /// <summary>
    /// Crée ou met à jour une note (parité saveNote) : id vide = création (id dérivé du
    /// titre, suffixe -2/-3… en collision) ; le titre est écrit en 1re ligne SEULEMENT
    /// s'il n'y en a pas déjà un dans le corps ; retour à la ligne final garanti.
    /// </summary>
    public static Note Save(string workspace, string id, string? title, string? markdown)
    {
        EnsureNoteDir(workspace);
        var titre = CleanTitle(title);
        var corps = markdown ?? "";
        var finalId = (id ?? "").Trim();
        if (finalId.Length == 0)
        {
            var base_ = SafeId(titre);
            finalId = $"{base_}.md";
            var n = 2;
            while (File.Exists(NotePath(workspace, finalId)))
            {
                finalId = $"{base_}-{n}.md";
                n++;
            }
        }
        var contenu = Regex.IsMatch(corps, "^#\\s+", RegexOptions.Multiline) ? corps : $"# {titre}\n\n{corps}";
        if (!contenu.EndsWith('\n')) contenu += "\n";
        // UTF-8 SANS BOM explicitement (le parseur Node lit du utf8 brut ; byte-parité).
        File.WriteAllText(NotePath(workspace, finalId), contenu, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
        return Get(workspace, finalId);
    }

    /// <summary>Nom de fichier pour l'export .md (parité notes:export) : caractères
    /// interdits Windows remplacés par « _ », tronqué à 80, jamais vide.</summary>
    public static string NomExport(string? titre)
    {
        var propre = Regex.Replace(titre ?? "", "[\\\\/:*?\"<>|]", "_");
        var coupe = propre.Length > 80 ? propre[..80] : propre;
        return coupe.Length > 0 ? coupe : "note";
    }

    /// <summary>Texte injecté au composeur par « Joindre à la conversation »
    /// (parité attachToConversation de web/src/NotesView.tsx).</summary>
    public static string TexteJoindre(Note note) =>
        $"Voici ma note « {note.Title} » :\n\n{note.Markdown}";

    // ── Métadonnées (parité notes-meta.ts) ────────────────────────────────────

    private static (List<string> Pinned, Dictionary<string, List<string>> Tags) ReadMeta(string workspace)
    {
        try
        {
            var raw = JsonNode.Parse(File.ReadAllText(MetaFile(workspace))) as JsonObject;
            if (raw is null) return ([], []);
            var pinned = raw["pinned"] as JsonArray is { } liste
                ? liste.Where(n => n is JsonValue v && v.TryGetValue<string>(out _)).Select(n => n!.GetValue<string>()).ToList()
                : [];
            var tags = new Dictionary<string, List<string>>();
            if (raw["tags"] is JsonObject table)
            {
                foreach (var (id_, valeurs) in table)
                {
                    if (valeurs is not JsonArray arrondi) continue;
                    var cleanId = CheminSur(id_ ?? "");
                    var propres = arrondi.Where(n => n is JsonValue v && v.TryGetValue<string>(out var t) && !string.IsNullOrWhiteSpace(t))
                        .Select(n => n!.GetValue<string>().Trim()[..Math.Min(30, n!.GetValue<string>().Trim().Length)])
                        .Distinct().Take(MaxNoteTags).ToList();
                    if (cleanId.Length > 0 && propres.Count > 0) tags[cleanId] = propres;
                }
            }
            return (pinned, tags);
        }
        catch
        {
            return ([], []);
        }
    }

    private static string CheminSur(string id)
    {
        // défense : jamais de traversée de chemin (les \ normalisés AVANT basename).
        var clean = Path.GetFileName(id.Replace('\\', '/'));
        return clean == id ? clean : Path.GetFileName(clean.Replace('\\', '/'));
    }

    public static IReadOnlyList<string> LoadPinned(string workspace) => ReadMeta(workspace).Pinned;

    /// <summary>Épingle/détache une note (parité togglePin, quota 20).</summary>
    public static IReadOnlyList<string> TogglePin(string workspace, string id)
    {
        var clean = Path.GetFileName((id ?? "").Replace('\\', '/'));
        if (clean.Length == 0 || clean != id) throw new InvalidOperationException("Note invalide");
        var (pinned, tags) = ReadMeta(workspace);
        if (pinned.Contains(clean)) pinned.Remove(clean);
        else
        {
            if (pinned.Count >= MaxPinned) throw new InvalidOperationException($"Maximum {MaxPinned} notes épinglées.");
            pinned.Add(clean);
        }
        WriteMeta(workspace, pinned, tags);
        return pinned;
    }

    public static IReadOnlyList<string> LoadTags(string workspace, string id)
    {
        var clean = Path.GetFileName((id ?? "").Replace('\\', '/'));
        return ReadMeta(workspace).Tags.GetValueOrDefault(clean) ?? [];
    }

    /// <summary>Remplace les tags d'une note (normalisés) — liste vide = suppression (parité setTags).</summary>
    public static IReadOnlyList<string> SetTags(string workspace, string id, IEnumerable<string>? tags)
    {
        var clean = Path.GetFileName((id ?? "").Replace('\\', '/'));
        if (clean.Length == 0 || clean != id) throw new InvalidOperationException("Note invalide");
        var normalisés = NormalizeTags(tags);
        var (pinned, table) = ReadMeta(workspace);
        if (normalisés.Count > 0) table[clean] = normalisés.ToList();
        else table.Remove(clean);
        WriteMeta(workspace, pinned, table);
        return normalisés;
    }

    /// <summary>Minuscules, sans accents, 30 car., dédoublonnées, 6 max (parité normalizeTags).</summary>
    public static IReadOnlyList<string> NormalizeTags(IEnumerable<string>? tags)
    {
        var out_ = (tags ?? [])
            .Select(t => (t ?? "").Trim().ToLowerInvariant())
            .Select(t => RetirerAccents(t))
            .Select(t => Regex.Replace(Regex.Replace(t, "\\s+", "-"), "[^a-z0-9-]", ""))
            .Select(t => Regex.Replace(Regex.Replace(t, "-{2,}", "-"), "^-+|-+$", ""))
            .Where(t => t.Length > 0)
            .Take(MaxNoteTags);
        return out_.Distinct().ToArray();
    }

    private static void WriteMeta(string workspace, List<string> pinned, Dictionary<string, List<string>> tags)
    {
        var objet = new JsonObject
        {
            ["pinned"] = new JsonArray(pinned.Select(p => (JsonNode)p).ToArray()),
        };
        if (tags.Count > 0)
        {
            var table = new JsonObject();
            foreach (var (id_, liste) in tags) table[id_] = new JsonArray(liste.Select(t => (JsonNode)t).ToArray());
            objet["tags"] = table;
        }
        // Écriture ATOMIQUE indentée (parité writeJsonAtomicPretty) via le helper partagé
        // AtomicFile : retentatives + repli copie, UTF-8 sans BOM, \n seulement.
        AtomicFile.WriteJsonPretty(MetaFile(workspace), objet);
    }
}
