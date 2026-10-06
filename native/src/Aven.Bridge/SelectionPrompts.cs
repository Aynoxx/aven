namespace Aven.Bridge;

/// <summary>
/// Actions sur sélection (Lot 4, parité web/src/selection-actions.ts v8.9.0) :
/// sélectionner du texte dans une réponse propose Copier / Corriger / Expliquer /
/// Faire relire. Pur : les prompts sont construits ici, testés sans UI. Le texte
/// cité atterrit TOUJOURS dans le composeur : l'utilisateur valide avec Entrée.
/// </summary>
public static class SelectionPrompts
{
    /// <summary>Garde-fou : une sélection démesurée ne doit pas noyer le composeur.</summary>
    public const int Max = 4000;

    /// <summary>Sélection utile : bords rognés, longueur plafonnée (parité selectionWithin).</summary>
    public static string Rogner(string sélection)
    {
        var texte = sélection.Trim();
        if (texte.Length == 0) return "";
        return texte.Length > Max ? texte[..Max] + "…" : texte;
    }

    /// <summary>Prompt prérempli dans le composeur selon l'action choisie (parité buildPrompt).</summary>
    public static string Prompt(string action, string sélection)
    {
        var texte = Rogner(sélection);
        if (texte.Length == 0) return "";
        return action switch
        {
            "fix" => "Corrige ce code :\n\n```\n" + texte + "\n```",
            "explain" => "Explique ce code :\n\n```\n" + texte + "\n```",
            // v9.4.0 : « Faire relire » — la relecture est confiée à l'agent
            // code-reviewer, qui détecte les problèmes SANS modifier le code.
            "review" => "Fais relire ce code par l'agent code-reviewer et montre-moi son rapport :\n\n```\n" + texte + "\n```",
            // « Envoyer à l'agent » : citation en bloc, la demande s'écrit à la suite.
            _ => string.Join("\n", texte.Split('\n').Select(l => "> " + l)) + "\n\n",
        };
    }
}
