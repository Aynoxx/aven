using System.Text.RegularExpressions;

namespace Aven.Bridge;

/// <summary>Une ligne du transcript filtré (parité TranscriptLine de freebuff-transcript.ts).</summary>
public sealed record TranscriptLine(string Text, bool User);

/// <summary>Transcript filtré + barre de session extraite (parité du retour de buildTranscript).</summary>
public sealed record Transcript(IReadOnlyList<TranscriptLine> Lines, string SessionBar);

/// <summary>
/// v9.6.0 — filtrage du transcript de l'agent Freebuff : PORT 1:1 de
/// web/src/freebuff-transcript.ts (module pur, mêmes regex, même fast-path, même
/// priorité de barre de session). Le TUI Freebuff mélange discours, bordures, pubs
/// et barres d'état : ce module transforme le buffer terminal en conversation lisible.
/// Les cas de test de « tests/freebuff-transcript.test.mjs » sont réécrits en xUnit.
/// </summary>
public static partial class FreebuffTranscript
{
    // Bordures de boîtes TUI : ─-╿ couvre le bloc « box drawing » U+2500-U+257F.
    private static readonly Regex BorduresDébut = new("^[\\s│║┃|┆┊┌┐└┘╭╮╰╯├┤┬┴┼─━═]+", RegexOptions.Compiled);
    private static readonly Regex BorduresFin = new("[\\s│║┃|┆┊┌┐└┘╭╮╰╯├┤┬┴┼─━═]+$", RegexOptions.Compiled);
    // ⚠ plage ─-╿ = bloc box-drawing U+2500-U+257F (le tiret NON échappé est un intervalle).
    private static readonly Regex DécorationSeule = new("^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏✓✔✗·∙•←↑→↓—─-╿+/=\\\\^|]*$", RegexOptions.Compiled);
    private static readonly Regex LettreOuChiffre = new("[\\p{L}\\p{N}]", RegexOptions.Compiled);

    public static string TrimBorders(string line) =>
        BorduresFin.Replace(BorduresDébut.Replace(line, ""), "");

    /// <summary>Une ligne résiduelle n'est plus que de la décoration (bordures, spinners, règles).</summary>
    public static bool IsDecorationOnly(string line)
    {
        var t = line.Trim();
        return t.Length == 0 || DécorationSeule.IsMatch(t);
    }

    public static bool HasSpeech(string line) => LettreOuChiffre.IsMatch(line);

    // ── Barre de session (quota Freebucks, durée restante, streak) ────────────
    private static readonly Regex[] MotifsSession =
    [
        new(@"\d+\s*/\s*\d+\s*(?:freebucks?|crédits?|credits?|quota)", RegexOptions.IgnoreCase | RegexOptions.Compiled),
        new(@"(?:freebucks?|crédits?|credits?|quota)\s*[\w\s]{0,20}\d+\s*/\s*\d+", RegexOptions.IgnoreCase | RegexOptions.Compiled),
        new(@"\d+\s*(?:h|hr|hrs|m|min|mins|s|sec|secs)\b[^\n]{0,40}(?:restant|left|remaining|quota)", RegexOptions.IgnoreCase | RegexOptions.Compiled),
        new(@"(?:restant|left|remaining|quota)[^\n]{0,40}\d+\s*(?:h|hr|hrs|m|min|mins|s|sec|secs)\b", RegexOptions.IgnoreCase | RegexOptions.Compiled),
        new(@"\d+\s*(?:day|days|jour|jours)\s+streak", RegexOptions.IgnoreCase | RegexOptions.Compiled),
        new(@"\b(?:daily|session|quota)\b[^\n]{0,60}\d", RegexOptions.IgnoreCase | RegexOptions.Compiled),
    ];

    public static bool IsSessionBar(string line) =>
        MotifsSession.Any(re => re.IsMatch(line));

    /// <summary>Priorité d'affichage : le quota (« 40/40 Freebucks ») l'emporte sur le streak.</summary>
    public static int SessionBarScore(string line) =>
        Regex.IsMatch(line, @"\d+\s*/\s*\d+\s*(?:freebucks?|crédits?|credits?)", RegexOptions.IgnoreCase) ? 2 : 1;

    // ── Bruit non-parole : pubs, invitations, écran d'accueil, barres d'état ──
    private static readonly Regex[] MotifsBruit =
    [
        new(@"\bgreptile\b", RegexOptions.IgnoreCase | RegexOptions.Compiled),
        new(@"\brefer\s+friends?\b", RegexOptions.IgnoreCase | RegexOptions.Compiled),
        new(@"\bearn\s+freebucks?\b", RegexOptions.IgnoreCase | RegexOptions.Compiled),
        new(@"copy\s+invite", RegexOptions.IgnoreCase | RegexOptions.Compiled),
        new(@"\bday\s+streak\b", RegexOptions.IgnoreCase | RegexOptions.Compiled),
        new(@"\btry\s+it\s+free\b", RegexOptions.IgnoreCase | RegexOptions.Compiled),
        new(@"\bthe\s+ai\s+code\s+reviewer\b", RegexOptions.IgnoreCase | RegexOptions.Compiled),
        new(@"\bagents?\s+that\s+(?:review|test)\b", RegexOptions.IgnoreCase | RegexOptions.Compiled),
        new(@"^\s*ad\s*$", RegexOptions.IgnoreCase | RegexOptions.Compiled),
        new(@"your\s+first\s+message\s+starts", RegexOptions.IgnoreCase | RegexOptions.Compiled),
        new(@"enter\s+a\s+coding\s+task\s+or\s+/", RegexOptions.IgnoreCase | RegexOptions.Compiled),
        new(@"\bfor\s+history\b.*\bfor\s+help\b", RegexOptions.IgnoreCase | RegexOptions.Compiled),
        new(@"^\s*←?\s*for\s+history", RegexOptions.IgnoreCase | RegexOptions.Compiled),
        new(@"\bmodel\s+to\s+change\b", RegexOptions.IgnoreCase | RegexOptions.Compiled),
        new(@"\bChat:\s*New\s+chat\b", RegexOptions.IgnoreCase | RegexOptions.Compiled),
    ];

    public static bool IsNoise(string line) =>
        MotifsBruit.Any(re => re.IsMatch(line));

    /// <summary>Ligne de prompt utilisateur : « ❯ … », « &gt; … » ou « vous/tu/moi : … ».</summary>
    public static bool IsUserLine(string line) =>
        Regex.IsMatch(line, @"^\s*[❯>»]\s*\S") ||
        Regex.IsMatch(line, @"^\s*(?:vous|tu|moi)\s*[:>]", RegexOptions.IgnoreCase);

    /// <summary>Transforme les lignes brutes du TUI en conversation (parité buildTranscript).</summary>
    public static Transcript Build(IEnumerable<string> rawLines)
    {
        var lines = new List<TranscriptLine>();
        var sessionBar = "";
        var sessionScore = -1;
        foreach (var raw in rawLines)
        {
            var trimmed = TrimBorders(raw);
            if (trimmed.Length == 0 || IsDecorationOnly(trimmed)) continue;
            // Fast-path v9.6.1 : sans lettre ni chiffre, la ligne ne peut être ni session,
            // ni bruit, ni discours — un seul test Unicode évite les ~26 regex.
            if (!HasSpeech(trimmed)) continue;
            if (IsSessionBar(trimmed))
            {
                var score = SessionBarScore(trimmed);
                if (score > sessionScore) { sessionBar = trimmed.Trim(); sessionScore = score; }
                continue;
            }
            if (IsNoise(trimmed)) continue;
            lines.Add(new TranscriptLine(Regex.Replace(trimmed, @"\s+$", ""), IsUserLine(trimmed)));
        }
        return new Transcript(lines, sessionBar);
    }
}
