using Aven.Bridge;
using Xunit;

namespace Aven.Tests;

/// <summary>
/// Port de electron/prefs.ts : défauts stricts (notifications actives SAUF false
/// explicite, reprise SAUF true explicite), JSON compact atomique (parité
/// writeJsonAtomic — pas d'indentation, contrairement au meta des notes).
/// </summary>
public class SettingsServiceTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "aven-prefs-" + Guid.NewGuid().ToString("N"));

    public void Dispose()
    {
        try { Directory.Delete(_dir, recursive: true); } catch { }
    }

    [Fact]
    public void Les_défauts_sont_identiques_à_lelectron()
    {
        var prefs = SettingsService.Load(_dir);
        Assert.True(prefs.Notifications);
        Assert.False(prefs.FreebuffResume);
    }

    [Theory]
    [InlineData("{}", true, false)]
    [InlineData("{\"notifications\":false}", false, false)]
    [InlineData("{\"freebuffResume\":true}", true, true)]
    [InlineData("{\"notifications\":0,\"freebuffResume\":1}", true, false)] // types inattendus → défauts
    [InlineData("{ corrompu", true, false)]
    public void La_lecture_est_tolérante_avec_les_mêmes_défauts(string json, bool notifications, bool resume)
    {
        Directory.CreateDirectory(_dir);
        File.WriteAllText(SettingsService.Fichier(_dir), json);
        var prefs = SettingsService.Load(_dir);
        Assert.Equal((notifications, resume), (prefs.Notifications, prefs.FreebuffResume));
    }

    [Fact]
    public void La_sauvegarde_est_compacte_atomique_et_relue_froide()
    {
        var sauvegardé = SettingsService.SaveFreebuffResume(_dir, true);
        Assert.True(sauvegardé.FreebuffResume);

        var json = File.ReadAllText(SettingsService.Fichier(_dir));
        Assert.Equal("{\"notifications\":true,\"freebuffResume\":true}", json.Trim()); // compact, parité writeJsonAtomic
        Assert.Equal("{\"notifications\":true,\"freebuffResume\":true}", json.Trim()); // une seule ligne

        var relu = SettingsService.Load(_dir);
        Assert.True(relu.FreebuffResume);
        Assert.True(relu.Notifications);

        // saveNotifications préserve la reprise (parité du spread { ...loadPrefs() }).
        SettingsService.SaveNotifications(_dir, false);
        var final = SettingsService.Load(_dir);
        Assert.False(final.Notifications);
        Assert.True(final.FreebuffResume);
    }
}
