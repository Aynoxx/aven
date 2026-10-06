namespace Aven.Bridge;

/// <summary>
/// Jalon 7 — port C# 1:1 de <c>electron/notify-policy.ts</c> : Aven avertit quand un
/// agent a besoin de toi, mais JAMAIS quand la fenêtre est au premier plan (tu vois
/// déjà l'écran). Pur : aucun I/O, testable sans Electron — mêmes cas que
/// <c>tests/notify-policy.test.mjs</c> dans <c>NotifyPolicyTests.cs</c>.
/// </summary>
public static class NotifyPolicy
{
    // Clés alignées sur l'union NotifyKind de notify-policy.ts (strings, parité exacte
    // avec les types d'événements moteur portés tels quels).
    public const string TourTermine = "turn-done";
    public const string TourEchoue = "turn-error";
    public const string Permission = "permission";
    public const string Formulaire = "form";

    /// <summary>Toutes les sortes d'événements notifiables (parité KINDS du test Node).</summary>
    public static readonly IReadOnlyList<string> Tous = [TourTermine, TourEchoue, Permission, Formulaire];

    /// <summary>Seuil (ms) au-delà duquel un tour TERMINÉ mérite un toast :
    /// un aller-retour de quelques secondes, l'utilisateur est encore devant l'écran.</summary>
    public const long SeuilTourLongMs = 8000;

    /// <summary>Port exact de <c>shouldNotify</c> : désactivé OU fenêtre au premier plan
    /// ⇒ jamais ; permission/formulaire/échec ⇒ toujours (l'utilisateur doit agir) ;
    /// sinon durée de tour &gt; 8 s.</summary>
    public static bool DevraitNotifier(bool fenetreAuPremierPlan, string type, bool activé, long? dureeTourMs = null)
    {
        if (!activé || fenetreAuPremierPlan) return false;
        if (type is Permission or Formulaire or TourEchoue) return true;
        return (dureeTourMs ?? 0) > SeuilTourLongMs;
    }

    /// <summary>Port exact de <c>notifyContent</c> : libellés courts, sans contenu de
    /// réponse (le corps du toast ne sort JAMAIS le texte du chat).</summary>
    public static (string Titre, string Corps) Contenu(string type, long? dureeMs = null)
    {
        switch (type)
        {
            case TourTermine:
                // Parité JS : durée falsy (0/null) = pas de suffixe ; sinon
                // Math.max(1, Math.round(ms/1000)) — arrondi "away from zero"
                // (Math.Round bancaire de .NET donnerait 12 pour 12,5 s au lieu de 13).
                var suffixe = "";
                if (dureeMs is > 0)
                {
                    var secondes = Math.Max(1, (long)Math.Round(dureeMs.Value / 1000.0, MidpointRounding.AwayFromZero));
                    suffixe = $" en {secondes} s";
                }
                return ("Aven", $"Tour terminé{suffixe}.");
            case TourEchoue:
                return ("Aven", "Le tour de l'agent a échoué.");
            case Permission:
                return ("Aven", "L'agent attend ta permission.");
            case Formulaire:
                return ("Aven", "Un formulaire attend tes réponses.");
            default:
                return ("Aven", "");
        }
    }
}
