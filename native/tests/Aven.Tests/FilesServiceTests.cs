using Aven.Bridge;
using Xunit;

namespace Aven.Tests;

/// <summary>
/// Port de workspace-files.ts : la sécurité du safeResolve est le point critique —
/// aucune lecture/listing hors racine possible, mêmes refus que Node (absolu,
/// lecteur, « .. »), listing sans les racines cachées, lecture bornée anti-binaire.
/// </summary>
public class FilesServiceTests : IDisposable
{
    private readonly string _ws = Path.Combine(Path.GetTempPath(), "aven-files-" + Guid.NewGuid().ToString("N"));

    public FilesServiceTests()
    {
        Directory.CreateDirectory(Path.Combine(_ws, "src"));
        Directory.CreateDirectory(Path.Combine(_ws, ".git"));
        Directory.CreateDirectory(Path.Combine(_ws, "node_modules"));
        File.WriteAllText(Path.Combine(_ws, "src", "main.ts"), "const a = 1;\nconst b = 2;\n");
        File.WriteAllText(Path.Combine(_ws, "README.md"), "# Aven\n");
        File.WriteAllText(Path.Combine(_ws, "binaire.bin"), "\u0000\u0000\u0001\u0002");
        File.WriteAllText(Path.Combine(_ws, "gros.txt"), new string('x', FilesService.MaxTextBytes + 1));
    }

    public void Dispose()
    {
        try { Directory.Delete(_ws, recursive: true); } catch { }
    }

    [Theory]
    [InlineData("../secret")]
    [InlineData("src/../../secret")]
    [InlineData("C:/Windows")]
    [InlineData("C:\\Windows\\system32")]
    [InlineData("/absolute/path")]
    [InlineData("\\absolute")]
    public void SafeResolve_refuse_toutes_les_traversées(string relatif)
    {
        Assert.Throws<InvalidOperationException>(() => FilesService.SafeResolve(_ws, relatif));
    }

    [Fact]
    public void SafeResolve_accepte_les_chemins_internes_et_résout_au_complet()
    {
        var résolu = FilesService.SafeResolve(_ws, "src/main.ts");
        Assert.Equal(Path.Combine(_ws, "src", "main.ts"), résolu);
        Assert.Equal(Path.GetFullPath(_ws), FilesService.SafeResolve(_ws, "."));
    }

    [Fact]
    public void Le_listing_cache_les_racines_et_trie_dossiers_puis_noms()
    {
        var entrées = FilesService.List(_ws, "");
        Assert.DoesNotContain(entrées, e => e.Name is ".git" or "node_modules");
        Assert.Equal("dir", Assert.Single(entrées.Where(e => e.Name == "src")).Kind);
        // Dossiers d'abord, puis fichiers par nom.
        var kinds = entrées.Select(e => e.Kind).ToArray();
        Assert.Equal(kinds.OrderBy(k => k == "dir" ? 0 : 1), kinds);
        // Collation fr (sensitivity base) : casse ignorée → b < g < R.
        Assert.Equal(["binaire.bin", "gros.txt", "README.md"], entrées.Where(e => e.Kind == "file").Select(e => e.Name));
    }

    [Fact]
    public void Le_listing_des_sous_dossiers_préfixe_les_chemins_relatifs()
    {
        var entrées = FilesService.List(_ws, "src");
        var seule = Assert.Single(entrées);
        Assert.Equal("src/main.ts", seule.Path);
        Assert.True(seule.Size > 0);
        Assert.True(seule.Modified > 0);
    }

    [Fact]
    public void La_lecture_est_bornée_et_refuse_le_binaire_et_les_dossiers()
    {
        var fichier = FilesService.Read(_ws, "src/main.ts");
        Assert.Equal("src/main.ts", fichier.Path);
        Assert.Equal("const a = 1;\nconst b = 2;\n", fichier.Content);
        Assert.False(fichier.Truncated);

        Assert.Throws<InvalidOperationException>(() => FilesService.Read(_ws, "binaire.bin"));
        Assert.Throws<InvalidOperationException>(() => FilesService.Read(_ws, "src"));

        var gros = FilesService.Read(_ws, "gros.txt");
        Assert.True(gros.Truncated);
        Assert.Equal(FilesService.MaxTextBytes, gros.Content.Length);
    }

    [Fact]
    public void Le_fil_d_ariane_commence_par_l_espace_et_accumule_les_chemins()
    {
        var crumbs = FilesService.Breadcrumb("src/lib/deep");
        Assert.Equal([("Espace", ""), ("src", "src"), ("lib", "src/lib"), ("deep", "src/lib/deep")],
            crumbs.Select(c => (c.Label, c.Path)));
    }
}
