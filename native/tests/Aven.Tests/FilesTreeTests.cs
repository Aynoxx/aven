using Aven.Bridge;
using Xunit;

namespace Aven.Tests;

/// <summary>
/// L'arbre de l'explorateur (spec phase 4 « TreeView + GridView ») : le tri et le
/// cloisonnement viennent de FilesService (safeResolve) — ici on prouve la
/// RESTRUCTURATION : dossiers d'abord, enfants lazys (null) au niveau 1, chargés
/// à la profondeur demandée, traversée refusée.
/// </summary>
public class FilesTreeTests : IDisposable
{
    private readonly string _racine = Path.Combine(Path.GetTempPath(), "aven-tree-" + Guid.NewGuid().ToString("N"));

    public FilesTreeTests()
    {
        // racine/b/c.md, racine/d/sous/e.txt, racine/a.txt — les dossiers b et d
        // trient AVANT a.txt (dossiers d'abord, puis alpha).
        Directory.CreateDirectory(Path.Combine(_racine, "b"));
        Directory.CreateDirectory(Path.Combine(_racine, "vide")); // vraiment vide
        Directory.CreateDirectory(Path.Combine(_racine, "d", "sous"));
        File.WriteAllText(Path.Combine(_racine, "b", "c.md"), "# c");
        File.WriteAllText(Path.Combine(_racine, "d", "sous", "e.txt"), "e");
        File.WriteAllText(Path.Combine(_racine, "a.txt"), "a");
    }

    public void Dispose()
    {
        try { Directory.Delete(_racine, recursive: true); } catch { }
    }

    [Fact]
    public void Niveau_1_trie_dossiers_d_abord_et_reste_lazy()
    {
        var arbre = FilesTree.Construire(_racine);
        Assert.Equal(4, arbre.Count);
        Assert.Equal(("b", true), (arbre[0].Nom, arbre[0].EstDossier));
        Assert.Equal(("d", true), (arbre[1].Nom, arbre[1].EstDossier));
        Assert.Equal(("vide", true), (arbre[2].Nom, arbre[2].EstDossier));
        Assert.Equal(("a.txt", false), (arbre[3].Nom, arbre[3].EstDossier));
        Assert.All(arbre, n => Assert.Null(n.Enfants)); // lazy : l'UI charge à l'expansion
        Assert.Equal("b", arbre[0].Relatif); // chemins relatifs (safeResolve côté UI)
    }

    [Fact]
    public void Profondeur_2_charge_les_enfants_des_dossiers()
    {
        var arbre = FilesTree.Construire(_racine, profondeur: 2);
        Assert.Equal(1, arbre[0].Enfants!.Count); // b → c.md
        Assert.Equal(("c.md", false), (arbre[0].Enfants[0].Nom, arbre[0].Enfants[0].EstDossier));
        Assert.Equal(1, arbre[1].Enfants!.Count); // d → sous (dossier, encore lazy)
        Assert.True(arbre[1].Enfants[0].EstDossier);
        Assert.Equal("d/sous", arbre[1].Enfants[0].Relatif);
        Assert.Null(arbre[1].Enfants[0].Enfants); // profondeur atteinte : le sous-dossier reste lazy
    }

    [Fact]
    public void Un_dossier_vide_donne_une_liste_vide_pas_null()
    {
        var arbre = FilesTree.Construire(_racine, "vide", profondeur: 2);
        Assert.NotNull(arbre);
        Assert.Empty(arbre); // le dossier existe, aucune entrée
    }

    [Fact]
    public void La_traversée_hors_racine_est_refusée()
    {
        Assert.Throws<InvalidOperationException>(() => FilesTree.Construire(_racine, "../evil"));
    }
}
