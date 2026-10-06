using Aven.Bridge;
using Xunit;

namespace Aven.Tests;

/// <summary>
/// Lot 4 (parité selection-actions.ts v8.9.0) : prompts des actions sur sélection —
/// port pur du module web, testé sans UI. Le texte cité atterrit dans le composeur :
/// l'utilisateur valide avec Entrée.
/// </summary>
public class SelectionPromptsTests
{
    [Fact]
    public void Rogner_supprime_les_bords()
    {
        Assert.Equal("code", SelectionPrompts.Rogner("  code  \n"));
    }

    [Fact]
    public void Rogner_vide_ou_blanc_donne_vide()
    {
        Assert.Equal("", SelectionPrompts.Rogner("   \n\t "));
        Assert.Equal("", SelectionPrompts.Rogner(""));
    }

    [Fact]
    public void Rogner_plafonne_a_4000_caracteres()
    {
        var longue = new string('x', 5000);
        var rogné = SelectionPrompts.Rogner(longue);
        Assert.Equal(SelectionPrompts.Max + 1, rogné.Length); // 4000 + l'ellipse
        Assert.EndsWith("…", rogné);
    }

    [Fact]
    public void Fix_explique_et_review_encadrent_le_code()
    {
        Assert.Equal("Corrige ce code :\n\n```\ncode\n```", SelectionPrompts.Prompt("fix", " code "));
        Assert.Equal("Explique ce code :\n\n```\ncode\n```", SelectionPrompts.Prompt("explain", " code "));
        Assert.Equal("Fais relire ce code par l'agent code-reviewer et montre-moi son rapport :\n\n```\ncode\n```",
            SelectionPrompts.Prompt("review", " code "));
    }

    [Fact]
    public void Send_cite_en_bloc_avec_ligne_vide()
    {
        Assert.Equal("> ligne1\n> ligne2\n\n", SelectionPrompts.Prompt("send", "ligne1\nligne2"));
    }

    [Fact]
    public void Sélection_vide_donne_prompt_vide_quelle_que_soit_l_action()
    {
        Assert.Equal("", SelectionPrompts.Prompt("fix", "  "));
        Assert.Equal("", SelectionPrompts.Prompt("send", ""));
    }

    [Fact]
    public void Action_inconnue_revient_a_la_citation_en_bloc()
    {
        Assert.Equal("> x\n\n", SelectionPrompts.Prompt("inconnue", "x"));
    }
}
