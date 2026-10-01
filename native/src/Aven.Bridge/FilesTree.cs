namespace Aven.Bridge;

/// <summary>
/// Nœud de l'arborescence de l'explorateur — la spec de phase 4 (« TreeView +
/// GridView ») était implémentée en fil d'ariane + liste ; ceci ajoute l'ARBRE.
/// Enfants : null = pas un dossier OU PAS ENCORE chargé (lazy, l'UI charge à
/// l'expansion) ; liste vide = dossier vide ; rempli = chargé.
/// </summary>
public sealed record FileTreeNode(string Nom, string Relatif, bool EstDossier, IReadOnlyList<FileTreeNode>? Enfants);

public static class FilesTree
{
    /// <summary>
    /// Construit l'arbre sur `profondeur` niveaux (1 = nœuds sans enfants chargés).
    /// Tri (dossiers puis noms) et cloisonnement safeResolve viennent de
    /// FilesService.List — rien n'est réimplémenté : l'arbre n'est qu'une
    /// RESTRUCTURATION des mêmes entrées.
    /// </summary>
    public static IReadOnlyList<FileTreeNode> Construire(string root, string relative = "", int profondeur = 1)
    {
        if (profondeur < 1) throw new ArgumentOutOfRangeException(nameof(profondeur));
        return FilesService.List(root, relative)
            .Select(e => new FileTreeNode(
                e.Name,
                e.Path,
                e.Kind == "dir",
                e.Kind == "dir" && profondeur > 1 ? Construire(root, e.Path, profondeur - 1) : null))
            .ToList();
    }
}
