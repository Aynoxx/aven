namespace Aven.Bridge;

/// <summary>Un fragment de texte stylé (parité des spans de RichMarkdown).</summary>
public sealed record MdSegment(string Text, bool Bold = false, bool Italic = false, bool Code = false);

/// <summary>Une ligne rendue (titre si HeadingLevel &gt; 0).</summary>
public sealed record MdLine(IReadOnlyList<MdSegment> Segments, int HeadingLevel = 0);

/// <summary>Un bloc de code fermé (``` fences) — parité du bloc « Copier » côté web.</summary>
public sealed record MdCodeBlock(IReadOnlyList<string> Lines, string Language);

/// <summary>
/// Rendu Markdown-lite des bulles de chat (parité RichMarkdown côté web, réduite à
/// ce que le chat affiche réellement) : titres, **gras**, *italique*, `code`,
/// blocs ``` fences. Les liens restent du TEXTE (même politique que le web : le
/// contenu d'un modèle n'ouvre rien, pas de navigation depuis du texte généré).
/// PUR : sans WinUI, l'AST est vérifié en xUnit et le rendu XAML reste trivial.
/// </summary>
public static class MarkdownLite
{
    /// <summary>Parse un texte Markdown en blocs (lignes ou blocs de code).</summary>
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
                blocs.Add(new MdLine(Segmenter(line[niveau..].Trim()), niveau));
            else
                blocs.Add(new MdLine(Segmenter(line)));
            i++;
        }
        return blocs;
    }

    /// <summary>Gras/italique/code par balayage — le contenu reste toujours du TEXTE.</summary>
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
