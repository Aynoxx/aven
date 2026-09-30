using System.Collections.Concurrent;
using Aven.Bridge;
using Xunit;

namespace Aven.Tests;

/// <summary>
/// Port de announcer.ts (v8.7.9) : grammaire minimale des phrases, COALESCENCE
/// (la plus récente du même type gagne, jamais de file d'attente), MUTE (une frappe
/// coupe tout), la voix est injectée — tous les cas testés sans vraie voix.
/// </summary>
public class AnnouncerTests
{
    private static IReadOnlyDictionary<string, string> D(params (string Clé, string Valeur)[] entrées) =>
        entrées.ToDictionary(e => e.Clé, e => e.Valeur);

    // ── Phrases pures (phraseFor) ───────────────────────────────────────────

    [Fact]
    public void Les_événements_deveniennent_des_phrases_courtes()
    {
        Assert.Equal("C'est parti.", AnnouncerPhrases.PhraseFor("session.execution.started", D())!.Text);
        Assert.Equal("Terminé.", AnnouncerPhrases.PhraseFor("session.execution.succeeded", D())!.Text);
        Assert.Equal("Interrompu.", AnnouncerPhrases.PhraseFor("session.execution.interrupted", D())!.Text);
    }

    [Fact]
    public void Lechec_est_résumé_jamais_lu_en_entier()
    {
        var phrase = AnnouncerPhrases.PhraseFor("session.execution.failed",
            D(("errorMessage", "Quota dépassé. Voici le détail complet et long de l'erreur. Et encore autre chose.")))!;
        Assert.StartsWith("Échec : Quota dépassé.", phrase.Text);
        Assert.True(phrase.Text.Length < 100); // grammaire minimale : résumé, pas lecture
    }

    [Fact]
    public void La_permission_est_annoncé_en_langage_humain()
    {
        var phrase = AnnouncerPhrases.PhraseFor("permission.asked", D(("action", "write")))!;
        Assert.Contains("écrire un fichier", phrase.Text);
        Assert.Equal("Aven demande la permission « bash ». Réponds à l'écran.",
            AnnouncerPhrases.PhraseFor("permission.asked", D(("action", "bash")))!.Text);
    }

    [Fact]
    public void Les_notices_de_saturations_sont_annoncées_le_changement_de_priorité_est_du_bruit()
    {
        Assert.Equal("Modèle saturé, passage sur le suivant.",
            AnnouncerPhrases.PhraseFor("router.notice", D(("text", "Modèle : A bascule sur B (priorité code)")))!.Text);
        Assert.Equal("Tous les modèles de cet agent sont momentanément saturés.",
            AnnouncerPhrases.PhraseFor("router.notice", D(("text", "Fournisseur indisponible")))!.Text);
        Assert.Null(AnnouncerPhrases.PhraseFor("router.notice", D(("text", "Modèle : A (priorité code)"))));
        Assert.Null(AnnouncerPhrases.PhraseFor("message.part.updated", D()));
    }

    // ── Announcer : coalescence + mute ──────────────────────────────────────

    private sealed class VoixTest
    {
        public ConcurrentQueue<string> Dites = [];
        public Task Dire(string texte) { Dites.Enqueue(texte); return Task.CompletedTask; }
    }

    /// <summary>La vidange est asynchrone : on attend l'état attendu, pas un délai fixe.</summary>
    private static async Task Attendre(Func<bool> condition)
    {
        var début = Environment.TickCount64;
        while (!condition() && Environment.TickCount64 - début < 2000)
            await Task.Delay(10);
        await Task.Delay(30); // répit : laisser d'éventuelles phrases résiduelles arriver
    }

    [Fact]
    public async Task Les_phrases_du_même_type_coalescent_la_plus_récente_gagne()
    {
        var voix = new VoixTest();
        // settleMs > 0 : la fenêtre de stabilisation est CE QUI permet la coalescence
        // après désenfilage (parité announcer.ts).
        var annonceur = new Announcer(voix.Dire, settleMs: 30);
        annonceur.Handle("session.execution.succeeded", D());
        annonceur.Handle("session.execution.succeeded", D());
        annonceur.Handle("permission.asked", D(("action", "read")));
        await Attendre(() => voix.Dites.Count >= 2);

        // « C'est parti. » (info) a été remplacé par la permission (info plus récente) ;
        // « Terminé. » (result) survit — deux kinds, deux files de coalescence.
        Assert.Equal(["Terminé.", "Aven demande la permission « read ». Réponds à l'écran."],
            voix.Dites.ToArray()); // jamais plus d'une phrase par type — jamais de file
    }

    [Fact]
    public async Task Le_mute_coupe_tout_et_la_file_est_abandonnée()
    {
        var voix = new VoixTest();
        var annonceur = new Announcer(voix.Dire, settleMs: 30);
        annonceur.Handle("session.execution.started", D());
        annonceur.Mute(); // l'utilisateur tape pendant la fenêtre de stabilisation
        await Task.Delay(300); // la vidange vérifie le mute À SON RÉVEIL : déterministe

        Assert.Empty(voix.Dites); // rien n'a été dit après le mute
    }

    [Fact]
    public async Task Désactiver_coupe_et_ignorer_tout_nouvel_événement()
    {
        var voix = new VoixTest();
        var annonceur = new Announcer(voix.Dire);
        annonceur.SetEnabled(false);
        annonceur.Handle("session.execution.started", D());
        await Task.Delay(300);
        Assert.Empty(voix.Dites);
        Assert.False(annonceur.Activé);
    }
}
