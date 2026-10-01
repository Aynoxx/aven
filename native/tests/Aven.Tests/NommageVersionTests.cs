using Xunit;

namespace Aven.Tests;

/// <summary>Localise la racine du dépôt depuis le répertoire de sortie des tests
/// (les tests de cohérence lisent des fichiers versionnés : manifeste, README,
/// assets du terminal).</summary>
public static class RepoRoot
{
    public static string Trouver()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            if (File.Exists(Path.Combine(dir.FullName, "MIGRATION-WINUI.md"))) return dir.FullName;
        }
        throw new InvalidOperationException("Racine du dépôt introuvable depuis " + AppContext.BaseDirectory);
    }
}

/// <summary>
/// Décision §5.4 : « Aven 10.0 (native) » RETENU — la version majeure marque le
/// changement de moteur ; le README bilingue distingue « Aven Classic (v9.x) » et
/// « Aven natif (v10.0) » pendant la double publication. Preuve de cohérence :
/// le manifeste MSIX et le README restent alignés sur 10.0.0.0 (la version est
/// aussi affichée dans Paramètres via MainWindow.AppVersion).
/// </summary>
public class NommageVersionTests
{
    [Fact]
    public void Le_manifeste_reste_aligné_sur_10_0_0_0()
    {
        var manifeste = File.ReadAllText(Path.Combine(RepoRoot.Trouver(), "native", "src", "Aven.Native", "Package.appxmanifest"));
        Assert.Contains("Version=\"10.0.0.0\"", manifeste);
    }

    [Fact]
    public void Le_readme_presents_la_double_publication_v9x_et_v10()
    {
        var readme = File.ReadAllText(Path.Combine(RepoRoot.Trouver(), "README.md"));
        Assert.Contains("v10.0", readme); // section « Aven natif (v10.0, WinUI 3) »
        Assert.Contains("v9.x", readme); // la version Electron reste publiée en parallèle
    }
}
