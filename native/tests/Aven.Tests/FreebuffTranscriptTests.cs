using Aven.Bridge;
using System.Diagnostics;
using Xunit;

namespace Aven.Tests;

/// <summary>
/// Port 1:1 de tests/freebuff-transcript.test.mjs : les MÊMES cas réels observés
/// dans le TUI Freebuff (screenshots v9.6.0) doivent donner les MÊMES résultats en C#.
/// </summary>
public class FreebuffTranscriptTests
{
    // ── Rogner les bordures ────────────────────────────────────────────────
    [Theory]
    [InlineData("│ 40/40 Freebucks remaining            │", "40/40 Freebucks remaining")]
    [InlineData("| The AI code reviewer                     Ad |", "The AI code reviewer                     Ad")]
    [InlineData("├──────┬──────┤", "")]
    [InlineData("│      │", "")]
    public void TrimBorders_rogne_les_bordures_de_boîtes(string entrée, string attendu) =>
        Assert.Equal(attendu, FreebuffTranscript.TrimBorders(entrée));

    // ── Lignes de pure décoration ──────────────────────────────────────────
    [Theory]
    [InlineData("├──────┬──────┤", true)]
    [InlineData("   ", true)]
    [InlineData("Enter a coding task or / for commands", false)]
    public void IsDecorationOnly_détecte_les_lignes_non_parole(string entrée, bool attendu) =>
        Assert.Equal(attendu, FreebuffTranscript.IsDecorationOnly(entrée));

    [Fact]
    public void Le_pipeline_rogne_AVANT_de_rejeter_la_décoration() =>
        Assert.True(FreebuffTranscript.IsDecorationOnly(FreebuffTranscript.TrimBorders("│      │")));

    // ── Barre de session ───────────────────────────────────────────────────
    [Theory]
    [InlineData("40/40 Freebucks remaining", true)]
    [InlineData("40/40 freebucks remaining", true)]
    [InlineData("40/40 Freebucks remaining   ", true)]
    [InlineData("5 day streak", true)]
    [InlineData("2h 30m restant", true)]
    [InlineData("2h left today", true)]
    [InlineData("session quota: 40", true)]
    [InlineData("Corrige le bug d'authentification", false)]
    [InlineData("Analyse le fichier src/main.ts", false)]
    public void IsSessionBar_capture_le_quota_et_la_durée(string entrée, bool attendu) =>
        Assert.Equal(attendu, FreebuffTranscript.IsSessionBar(entrée));

    // ── Bruit : pubs, invitations, écran d'accueil, barres d'état ──────────
    [Theory]
    [InlineData("The AI code reviewer", true)]
    [InlineData("AI agents that review and test PRs with full context of the codebase.", true)]
    [InlineData("Try it free  greptile.com", true)]
    [InlineData("✦ Refer friends → earn Freebucks:", true)]
    [InlineData("Copy invite link  Learn More ↗", true)]
    [InlineData("5 day streak", true)]
    [InlineData("Your first message starts the session.", true)]
    [InlineData("Enter a coding task or / for commands", true)]
    [InlineData("← for history · ? for help", true)]
    [InlineData("GLM 5.3 Flash · max · ~/Downloads/Aven · /model to change · Chat: New chat", true)]
    [InlineData("Ad", true)]
    [InlineData("Corrige le bug d'authentification", false)]
    [InlineData("Voici l'analyse du fichier :", false)]
    public void IsNoise_filtre_les_pubs_et_écrans(string entrée, bool attendu) =>
        Assert.Equal(attendu, FreebuffTranscript.IsNoise(entrée));

    // ── Lignes utilisateur ─────────────────────────────────────────────────
    [Theory]
    [InlineData("❯ corrige le bug d'authentification", true)]
    [InlineData("> résume le projet", true)]
    [InlineData("vous: résume le projet", true)]
    [InlineData("Freebuff démarre l'analyse", false)]
    public void IsUserLine_marque_le_prompt(string entrée, bool attendu) =>
        Assert.Equal(attendu, FreebuffTranscript.IsUserLine(entrée));

    // ── Fast-path v9.6.1 : équivalence ─────────────────────────────────────
    [Theory]
    [InlineData("│ ─── ═══ │", false)]
    [InlineData("───", false)]
    [InlineData("40/40 Freebucks remaining", true)]
    [InlineData("Salut !", true)]
    public void HasSpeech_est_le_fast_path_Unicode(string entrée, bool attendu) =>
        Assert.Equal(attendu, FreebuffTranscript.HasSpeech(entrée));

    // ── Intégration buildTranscript ────────────────────────────────────────
    [Fact]
    public void BuildTranscript_extrait_session_et_filtre_le_bruit()
    {
        var raw = new[]
        {
            "│ Your first message starts the session.        │",
            "│ 40/40 Freebucks remaining          │",
            "│ 5 day streak                │",
            "│ ✦ Refer friends → earn Freebucks: │",
            "│ Copy invite link  Learn More ↗    │",
            "│ The AI code reviewer                Ad │",
            "│ AI agents that review and test PRs with full context of the codebase. │",
            "│ Try it free  greptile.com           │",
            "│ ❯ Enter a coding task or / for commands │",
            "GLM 5.3 Flash · max · ~/Downloads/Aven · /model to change · Chat: New chat",
            "← for history · ? for help",
            "│ Bonjour, voici l'analyse demandée :         │",
            "│ le fichier src/main.ts contient l'erreur.   │",
        };
        var transcript = FreebuffTranscript.Build(raw);
        Assert.Equal("40/40 Freebucks remaining", transcript.SessionBar);
        Assert.Equal(
            new[] { "Bonjour, voici l'analyse demandée :", "le fichier src/main.ts contient l'erreur." },
            transcript.Lines.Select(l => l.Text).ToArray());
        Assert.All(transcript.Lines, l => Assert.False(l.User));
    }

    [Fact]
    public void BuildTranscript_marque_les_lignes_de_prompt_utilisateur()
    {
        var transcript = FreebuffTranscript.Build(new[] { "❯ Corrige le bug puis explique", "Voici le correctif appliqué." });
        Assert.Equal(2, transcript.Lines.Count);
        Assert.True(transcript.Lines[0].User);
        Assert.False(transcript.Lines[1].User);
    }

    [Fact]
    public void Le_fast_path_ne_change_rien_aux_lignes_sans_lettres()
    {
        var transcript = FreebuffTranscript.Build(new[] { "│ ────── │", "│ ──── │", "│ texte visible │" });
        Assert.Equal(new[] { "texte visible" }, transcript.Lines.Select(l => l.Text).ToArray());
    }

    // ── Garde anti-freeze : coût borné (5000 lignes < 200 ms, parité v9.6.1) ──
    [Fact]
    public void BuildTranscript_filtre_5000_lignes_de_décoration_en_moins_de_200_ms()
    {
        var bulk = Enumerable.Range(0, 5000)
            .Select(i => i % 7 == 0 ? "│ texte du TUI │" : "│ ──────────── │")
            .ToArray();
        var horloge = Stopwatch.StartNew();
        FreebuffTranscript.Build(bulk);
        horloge.Stop();
        Assert.True(horloge.ElapsedMilliseconds < 200, $"trop lent : {horloge.ElapsedMilliseconds} ms pour 5000 lignes");
    }
}
