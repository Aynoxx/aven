namespace Aven.Bridge;

/// <summary>Un fragment de texte stylé (parité des spans de RichMarkdown). Link : URL
/// d'un lien [label](url) — affiché comme le WEB (span inert : le label se voit,
/// l'URL ne s'ouvre JAMAIS, pas de navigation depuis du texte généré).</summary>
public sealed record MdSegment(string Text, bool Bold = false, bool Italic = false, bool Code = false, string? Link = null);

/// <summary>Une ligne rendue (titre si HeadingLevel &gt; 0).</summary>
public sealed record MdLine(IReadOnlyList<MdSegment> Segments, int HeadingLevel = 0);

/// <summary>Un bloc de code fermé (``` fences) — parité du bloc « Copier » côté web.</summary>
public sealed record MdCodeBlock(IReadOnlyList<string> Lines, string Language);

/// <summary>Une puce de liste (parité &lt;ul&gt;&lt;li&gt;) — niveau = indentation/2.</summary>
public sealed record MdBullet(int Niveau, IReadOnlyList<MdSegment> Segments);

/// <summary>Un élément de liste numérotée (parité &lt;ol&gt;&lt;li&gt;).</summary>
public sealed record MdOrdered(int Num, IReadOnlyList<MdSegment> Segments);

/// <summary>Un tableau GFM simple : header (une ligne de cellules) + lignes ; une
/// cellule = segments inline.</summary>
public sealed record MdTable(IReadOnlyList<IReadOnlyList<MdSegment>> Header, IReadOnlyList<IReadOnlyList<IReadOnlyList<MdSegment>>> Rows);

/// <summary>
/// Rendu Markdown-lite des bulles de chat (parité RichMarkdown côté web : titres,
/// **gras**, *italique*, `code`, blocs ``` fences, listes - / *, listes 1. ,
/// tableaux GFM, liens [label](url) AFFICHÉS sans navigation). Le HTML reste du
/// TEXTE littéral (ReactMarkdown sans rehype-raw), aucune exécution. PUR : sans
/// WinUI, l'AST est vérifié en xUnit et le rendu XAML reste trivial.
/// </summary>
public static class MarkdownLite
{
    /// <summary>Parse un texte Markdown en blocs (lignes, listes, tableaux, blocs de code).</summary>
    public static List<object> Parse(string? text)
    {
        var blocs = new List<object>();
        if (string.IsNullOrEmpty(text)) return blocs;
        var lines = text.Replace("\r\n", "\n").Split('\n');
        var i = 0;
        while (i < lines.Length)
        {
            var line = lines[i];
            if (line.StartsWith("```", StringComparison.Ordinal))
            {
                var language = line[3..].Trim();
                var body = new List<string>();
                i++;
                while (i < lines.Length && !lines[i].StartsWith("```", StringComparison.Ordinal))
                {
                    body.Add(lines[i]);
                    i++;
                }
                i++; // la clôture (absente = fin de texte, on ferme quand même)
                blocs.Add(new MdCodeBlock(body, language));
                continue;
            }
            var niveau = line.Length - line.TrimStart('#').Length;
            if (niveau is > 0 and <= 4 && line.Length > niveau && line[niveau] == ' ')
            {
                blocs.Add(new MdLine(Segmenter(line[niveau..].Trim()), niveau));
                i++;
                continue;
            }
            // Tableau GFM : une ligne à | dont la SUIVANTE est la ligne de séparation.
            if (line.Contains('|') && i + 1 < lines.Length && EstSéparateurTableau(lines[i + 1]))
            {
                var header = Cellules(line);
                i += 2;
                var rows = new List<IReadOnlyList<IReadOnlyList<MdSegment>>>();
                while (i < lines.Length && lines[i].Contains('|') && lines[i].Trim().Length > 0)
                {
                    rows.Add(Cellules(lines[i]));
                    i++;
                }
                blocs.Add(new MdTable(header, rows));
                continue;
            }
            // Listes : indentation × 2 = niveau (parité <ul>/<ol> imbriqués).
            var indent = line.Length - line.TrimStart(' ').Length;
            var contenu = line.TrimStart(' ');
            if (indent < 8 && (contenu.StartsWith("- ", StringComparison.Ordinal) || contenu.StartsWith("* ", StringComparison.Ordinal)))
            {
                blocs.Add(new MdBullet(indent / 2, Segmenter(contenu[2..].Trim())));
                i++;
                continue;
            }
            if (indent < 8 && Numérotée(contenu, out var num, out var suite))
            {
                blocs.Add(new MdOrdered(num, Segmenter(suite)));
                i++;
                continue;
            }
            blocs.Add(new MdLine(Segmenter(line)));
            i++;
        }
        return blocs;
    }

    /// <summary>"12." ou "12)" suivi d'une espace (parité ol GFM) → numéro + suite.</summary>
    private static bool Numérotée(string contenu, out int num, out string suite)
    {
        num = 0; suite = "";
        var point = contenu.IndexOfAny(['.', ')']);
        if (point < 1 || point > 9) return false;
        if (!int.TryParse(contenu[..point], out num)) return false;
        if (point + 1 >= contenu.Length || contenu[point + 1] != ' ') return false;
        suite = contenu[(point + 1)..].Trim();
        return suite.Length > 0;
    }

    /// <summary>Ligne de séparation GFM : | --- | :---: | (cellules de tirets, deux-points tolérés).</summary>
    private static bool EstSéparateurTableau(string line)
    {
        var propre = line.Trim().Trim('|');
        if (propre.Length == 0 || !propre.Contains('-')) return false;
        foreach (var cellule in propre.Split('|'))
        {
            var t = cellule.Trim().Trim(':');
            if (t.Length < 1 || !t.All(c => c == '-')) return false;
        }
        return true;
    }

    /// <summary>Découpe une ligne de tableau en cellules segmentées (les | de bord sont lâchés).</summary>
    private static IReadOnlyList<IReadOnlyList<MdSegment>> Cellules(string line)
    {
        var propre = line.Trim();
        if (propre.StartsWith('|')) propre = propre[1..];
        if (propre.EndsWith('|')) propre = propre[..^1];
        return propre.Split('|').Select(c => Segmenter(c.Trim())).ToList();
    }

    /// <summary>Gras/italique/code/liens par balayage — le contenu reste toujours du TEXTE.</summary>
    public static List<MdSegment> Segmenter(string text)
    {
        var segments = new List<MdSegment>();
        var buffer = new System.Text.StringBuilder();
        var i = 0;

        void Vider()
        {
            if (buffer.Length > 0) { segments.Add(new MdSegment(buffer.ToString())); buffer.Clear(); }
        }

        while (i < text.Length)
        {
            // Lien [label](url) : le LABEL s'affiche, l'URL ne s'ouvre jamais (parité
            // RichMarkdown : span mdlink inerte — aucune navigation ni IPC déclenchée).
            if (text[i] == '[')
            {
                var finLabel = text.IndexOf(']', i + 1);
                if (finLabel > i && finLabel + 1 < text.Length && text[finLabel + 1] == '(')
                {
                    var finUrl = text.IndexOf(')', finLabel + 2);
                    var label = finLabel > i ? text[(i + 1)..finLabel] : "";
                    var url = finUrl > finLabel + 2 ? text[(finLabel + 2)..finUrl] : "";
                    if (label.Length > 0 && url.Length > 0 && !label.Contains('[') && !url.Contains(' ') && !url.Contains('('))
                    {
                        Vider();
                        segments.Add(new MdSegment(label, Link: url));
                        i = finUrl + 1;
                        continue;
                    }
                }
            }
            if (text[i] == '`')
            {
                var fin = text.IndexOf('`', i + 1);
                if (fin > i)
                {
                    Vider();
                    segments.Add(new MdSegment(text[(i + 1)..fin], Code: true));
                    i = fin + 1;
                    continue;
                }
            }
            if (text[i] == '*' && i + 1 < text.Length && text[i + 1] == '*')
            {
                var fin = text.IndexOf("**", i + 2, StringComparison.Ordinal);
                if (fin > i + 2) // contenu non vide (le markdown ne met pas en gras du vide)
                {
                    Vider();
                    segments.Add(new MdSegment(text[(i + 2)..fin], Bold: true));
                    i = fin + 2;
                    continue;
                }
            }
            if (text[i] == '*')
            {
                var fin = text.IndexOf('*', i + 1);
                if (fin > i + 1)
                {
                    var contenu = text[(i + 1)..fin];
                    // Parité markdown : l'italique n'ouvre pas sur/ferme pas sur une espace
                    // (« * * ** » reste littéral).
                    if (contenu[0] != ' ' && contenu[^1] != ' ')
                    {
                        Vider();
                        segments.Add(new MdSegment(contenu, Italic: true));
                        i = fin + 1;
                        continue;
                    }
                }
            }
            buffer.Append(text[i]);
            i++;
        }
        Vider();
        return segments;
    }
}
