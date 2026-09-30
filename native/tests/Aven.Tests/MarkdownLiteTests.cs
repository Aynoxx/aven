using Aven.Bridge;
using Xunit;

namespace Aven.Tests;

/// <summary>
/// Le parseur Markdown-lite (parité réduite de RichMarkdown) : gras/italique/code,
/// titres, blocs de code. AUCUN contenu ne devient autre chose que du texte à
/// afficher — les « liens » et le HTML restent littéraux (politique sécurité du web).
/// </summary>
public class MarkdownLiteTests
{
    [Fact]
    public void Gras_italique_et_code_deviennent_des_segments_stylés()
    {
        var segments = MarkdownLite.Segmenter("du **gras** et de l'*italique* et du `code`");
        Assert.Equal(6, segments.Count);
        Assert.Equal("du ", segments[0].Text);
        Assert.Equal(("gras", true, false), (segments[1].Text, segments[1].Bold, segments[1].Italic));
        Assert.Equal((" et de l'", false, false), (segments[2].Text, segments[2].Bold, segments[2].Italic));
        Assert.Equal(("italique", false, true), (segments[3].Text, segments[3].Bold, segments[3].Italic));
        Assert.Equal((" et du ", false, false), (segments[4].Text, segments[4].Bold, segments[4].Italic));
        Assert.Equal(("code", false, false, true), (segments[5].Text, segments[5].Bold, segments[5].Italic, segments[5].Code));
    }

    [Fact]
    public void Les_titres_renvoient_leur_niveau_et_leur_texte()
    {
        var blocs = MarkdownLite.Parse("# Titre\ncourant\n## Sous-titre");
        var titre = Assert.IsType<MdLine>(blocs[0]);
        Assert.Equal(1, titre.HeadingLevel);
        Assert.Equal("Titre", Assert.Single(titre.Segments).Text);
        Assert.Equal(0, Assert.IsType<MdLine>(blocs[1]).HeadingLevel);
        Assert.Equal(2, Assert.IsType<MdLine>(blocs[2]).HeadingLevel);
    }

    [Fact]
    public void Les_blocs_de_code_capturent_le_langage_et_le_corps()
    {
        var blocs = MarkdownLite.Parse("avant\n```ts\nconst a = 1;\nconst b = 2;\n```\naprès");
        Assert.Equal(3, blocs.Count);
        var code = Assert.IsType<MdCodeBlock>(blocs[1]);
        Assert.Equal("ts", code.Language);
        Assert.Equal(["const a = 1;", "const b = 2;"], code.Lines);
    }

    [Fact]
    public void Html_et_liens_restent_du_texte_litteral()
    {
        var segments = MarkdownLite.Segmenter("<img src=x onerror=alert(1)> et [clique](http://x)");
        var texte = string.Concat(segments.Select(s => s.Text));
        Assert.Contains("<img src=x onerror=alert(1)>", texte);
        Assert.Contains("[clique](http://x)", texte);
        Assert.All(segments, s => Assert.False(s.Bold || s.Italic || s.Code));
    }

    [Fact]
    public void Le_texte_sans_balises_passe_intact_et_vide_ne_plante_pas()
    {
        Assert.Single(MarkdownLite.Segmenter("simple"));
        Assert.Empty(MarkdownLite.Parse(null));
        Assert.Empty(MarkdownLite.Parse(""));
        // Astérisques non fermés : littéraux, jamais de boucle infinie.
        Assert.Equal("* * **", string.Concat(MarkdownLite.Segmenter("* * **").Select(s => s.Text)));
    }
}
