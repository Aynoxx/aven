using Aven.Bridge;
using Xunit;

namespace Aven.Tests;

/// <summary>
/// Port des cas de <c>tests/notify-policy.test.mjs</c> (jalon 7) : la politique de
/// notification de bureau — jamais au premier plan, interrupteur respecté, seuil
/// 8 s pour un tour terminé, libellés courts sans contenu de réponse.
/// </summary>
public class NotifyPolicyTests
{
    [Fact]
    public void Jamais_de_notification_quand_la_fenetre_est_au_premier_plan()
    {
        foreach (var type in NotifyPolicy.Tous)
        {
            Assert.False(
                NotifyPolicy.DevraitNotifier(fenetreAuPremierPlan: true, type, activé: true, dureeTourMs: 60_000),
                type);
        }
    }

    [Fact]
    public void Interrupteur_desactive_jamais_rien_mem_en_arriere_plan()
    {
        Assert.False(NotifyPolicy.DevraitNotifier(fenetreAuPremierPlan: false, NotifyPolicy.Permission, activé: false));
    }

    [Fact]
    public void Permission_et_formulaire_toujours_notifies_en_arriere_plan()
    {
        Assert.True(NotifyPolicy.DevraitNotifier(false, NotifyPolicy.Permission, true));
        Assert.True(NotifyPolicy.DevraitNotifier(false, NotifyPolicy.Formulaire, true));
    }

    [Fact]
    public void Tour_termine_notifie_au_dela_de_8_secondes()
    {
        Assert.False(NotifyPolicy.DevraitNotifier(false, NotifyPolicy.TourTermine, true, 7_999));
        Assert.True(NotifyPolicy.DevraitNotifier(false, NotifyPolicy.TourTermine, true, 8_001));
        // Durée inconnue = court (parité : `turnDurationMs ?? 0 > 8000`).
        Assert.False(NotifyPolicy.DevraitNotifier(false, NotifyPolicy.TourTermine, true));
    }

    [Fact]
    public void Tour_echoue_toujours_notifie_en_arriere_plan_mem_sans_duree()
    {
        Assert.True(NotifyPolicy.DevraitNotifier(false, NotifyPolicy.TourEchoue, true));
    }

    [Fact]
    public void Libelles_courts_sans_contenu_de_reponse()
    {
        var (titre, corps) = NotifyPolicy.Contenu(NotifyPolicy.TourTermine, 12_400);
        Assert.Equal("Aven", titre);
        Assert.Equal("Tour terminé en 12 s.", corps);

        Assert.Contains("permission", NotifyPolicy.Contenu(NotifyPolicy.Permission).Corps, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("formulaire", NotifyPolicy.Contenu(NotifyPolicy.Formulaire).Corps, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("échoué", NotifyPolicy.Contenu(NotifyPolicy.TourEchoue).Corps, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void Duree_nulle_ou_absente_ne_produit_pas_de_suffixe()
    {
        Assert.Equal("Tour terminé.", NotifyPolicy.Contenu(NotifyPolicy.TourTermine, 0).Corps);
        Assert.Equal("Tour terminé.", NotifyPolicy.Contenu(NotifyPolicy.TourTermine).Corps);
    }

    [Fact]
    public void Arrondi_des_secondes_comme_le_Math_round_JS()
    {
        // Parité : 12,5 s → 13 côté JS (Math.round "away from zero"), pas 12 (bancaire).
        Assert.Equal("Tour terminé en 13 s.", NotifyPolicy.Contenu(NotifyPolicy.TourTermine, 12_500).Corps);
        // Sous la seconde, plancher à 1 s (Math.max du port).
        Assert.Equal("Tour terminé en 1 s.", NotifyPolicy.Contenu(NotifyPolicy.TourTermine, 200).Corps);
    }
}
