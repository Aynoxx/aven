using Aven.Bridge;
using Xunit;

namespace Aven.Tests;

/// <summary>
/// Canal de mise a jour (parite checkForUpdates de electron/main.ts) : decision
/// PURE testee sans reseau — parsing de tag, comparaison semver, les deux
/// messages du IPC web. L'appel HTTP reel n'est pas teste (parite web : le
/// reseau est moque par electron-updater).
/// </summary>
public class UpdateCheckTests
{
    [Theory]
    [InlineData("v10.1.3", "10.1.3")]
    [InlineData("10.1.3", "10.1.3")]
    [InlineData("release-9.8.0", "9.8.0")]
    [InlineData("  v0.2.0  ", "0.2.0")]
    public void SemverDeTag_extrait_le_semver(string tag, string attendu)
    {
        Assert.Equal(attendu, UpdateCheck.SemverDeTag(tag));
    }

    [Theory]
    [InlineData("")]
    [InlineData(null)]
    [InlineData("snapshot")]
    [InlineData("v10.1")]
    public void SemverDeTag_rejette_les_tags_sans_semver_complet(string? tag)
    {
        Assert.Null(UpdateCheck.SemverDeTag(tag));
    }

    [Theory]
    [InlineData("10.1.0", "10.0.9", 1)]
    [InlineData("10.1.0", "10.1.0", 0)]
    [InlineData("9.9.9", "10.0.0", -1)]
    [InlineData("10.1", "10.1.0", 0)]   // composant manquant = 0
    [InlineData("10.2", "10.10.0", -1)] // comparaison NUMERIQUE, pas lexicale
    public void Comparer_trie_en_semver(string a, string b, int attendu)
    {
        Assert.Equal(attendu, UpdateCheck.Comparer(a, b));
    }

    [Fact]
    public void Analyser_signale_une_nouvelle_version_comme_le_web()
    {
        var r = UpdateCheck.Analyser("v10.1.0", "10.0.0");
        Assert.True(r.Ok);
        Assert.Equal("Version disponible : 10.1.0", r.Message);
    }

    [Fact]
    public void Analyser_est_a_jour_quand_le_tag_est_inferieur()
    {
        var r = UpdateCheck.Analyser("v9.7.2", "10.0.0");
        Assert.True(r.Ok);
        Assert.Equal("Aucune mise a jour disponible.", r.Message);
    }

    [Fact]
    public void Analyser_signale_une_reponse_illisible()
    {
        var r = UpdateCheck.Analyser(null, "10.0.0");
        Assert.False(r.Ok);
        Assert.Contains("illisible", r.Message);
    }
}
