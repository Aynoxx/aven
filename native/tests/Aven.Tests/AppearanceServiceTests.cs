using Aven.Bridge;
using Xunit;

namespace Aven.Tests;

/// <summary>Jalon Paramètres (v10.0.0) : préférences d'apparence natives — port de
/// web/src/appearance.ts (MÊME défauts stricts par champ, lecture tolérante, écriture
/// compacte atomique, sanitize : listes fermées, hex, plages bornées).</summary>
public class AppearanceServiceTests : IDisposable
{
    private readonly string _dir = Path.Combine(Path.GetTempPath(), "aven-appearance-" + Guid.NewGuid().ToString("N"));

    public AppearanceServiceTests() => Directory.CreateDirectory(_dir);

    public void Dispose()
    {
        try { Directory.Delete(_dir, recursive: true); } catch { /* déjà parti */ }
    }

    [Fact]
    public void Fichier_absent_defauts_identiques_au_web()
    {
        var prefs = AppearanceService.Load(_dir);
        // Parité defaultAppearance (champs portés) : theme light, accent emerald,
        // #8b5cf6, 286/860, modèle + compositeur + groupement true, voix false.
        Assert.Equal("light", prefs.Theme);
        Assert.Equal("emerald", prefs.Accent);
        Assert.Equal("#8b5cf6", prefs.CustomAccent);
        Assert.Equal(286, prefs.SidebarWidth);
        Assert.Equal(860, prefs.MessageWidth);
        Assert.True(prefs.ShowModel);
        Assert.True(prefs.ShowComposer);
        Assert.False(prefs.VoiceAnnouncements);
        Assert.True(prefs.ChatsGroupedByAgent);
        // Seul écart documenté avec le web : la sidebar natif suit la conversation
        // depuis le Jalon 2, elle démarre visible.
        Assert.True(prefs.ShowSidebar);
    }

    [Fact]
    public void Fichier_corrompu_retombe_sur_les_defauts()
    {
        File.WriteAllText(AppearanceService.Fichier(_dir), "{ pas du json");
        Assert.Equal(AppearanceService.Defaut, AppearanceService.Load(_dir));
    }

    [Theory]
    [InlineData("light")]
    [InlineData("system")]
    [InlineData("dark")]
    public void Save_Load_roundtrip_theme_valide(string theme)
    {
        var sauvegardé = AppearanceService.Save(_dir,
            AppearanceService.Defaut with { Theme = theme, VoiceAnnouncements = true, ChatsGroupedByAgent = false });
        var relu = AppearanceService.Load(_dir);
        Assert.Equal(sauvegardé, relu);
        Assert.Equal(theme, relu.Theme);
        Assert.True(relu.VoiceAnnouncements);
        Assert.False(relu.ChatsGroupedByAgent);
    }

    [Fact]
    public void Save_sanitize_theme_hors_liste_retombe_sur_defaut()
    {
        var propre = AppearanceService.Save(_dir, AppearanceService.Defaut with { Theme = "solarized", Accent = "purple" });
        Assert.Equal("light", propre.Theme);
        Assert.Equal("emerald", propre.Accent);
        var relu = AppearanceService.Load(_dir);
        Assert.Equal("light", relu.Theme);
        Assert.Equal("emerald", relu.Accent);
    }

    [Fact]
    public void Save_plages_bornees_et_zero_retombe_sur_defaut()
    {
        // Parité Math.min/max après Number(x) || default : 999 → 420, 0 → défaut 286.
        var haut = AppearanceService.Save(_dir, AppearanceService.Defaut with { SidebarWidth = 999, MessageWidth = 42 });
        Assert.Equal(420, haut.SidebarWidth);
        Assert.Equal(560, haut.MessageWidth); // 42 sous le min → clamp au lieu du défaut
        var nul = AppearanceService.Save(_dir, AppearanceService.Defaut with { SidebarWidth = 0, MessageWidth = 0 });
        Assert.Equal(286, nul.SidebarWidth);
        Assert.Equal(860, nul.MessageWidth);
    }

    [Fact]
    public void Save_customAccent_hex_retombe_sur_defaut()
    {
        var valide = AppearanceService.Save(_dir, AppearanceService.Defaut with { Accent = "custom", CustomAccent = "#3b82f6" });
        Assert.Equal("#3b82f6", valide.CustomAccent);
        var invalide = AppearanceService.Save(_dir, AppearanceService.Defaut with { Accent = "custom", CustomAccent = "rouge" });
        Assert.Equal("#8b5cf6", invalide.CustomAccent);
        Assert.Equal("#8b5cf6", AppearanceService.Load(_dir).CustomAccent);
    }

    [Fact]
    public void CouleurAccent_preset_et_custom()
    {
        Assert.Equal("#10b981", AppearanceService.CouleurAccent(AppearanceService.Defaut)); // emerald
        Assert.Equal("#3b82f6", AppearanceService.CouleurAccent(
            AppearanceService.Defaut with { Accent = "blue" }));
        Assert.Equal("#ff0000", AppearanceService.CouleurAccent(
            AppearanceService.Defaut with { Accent = "custom", CustomAccent = "#ff0000" }));
    }

    [Fact]
    public void Ecriture_compacte_sans_BOM()
    {
        AppearanceService.Save(_dir, AppearanceService.Defaut with { Theme = "dark" });
        var octets = File.ReadAllBytes(AppearanceService.Fichier(_dir));
        // BOM UTF-8 = EF BB BF : interdit (parité writeJsonAtomic sans BOM).
        Assert.False(octets.Length >= 3 && octets[0] == 0xEF && octets[1] == 0xBB && octets[2] == 0xBF,
            "appearance.json ne doit pas porter de BOM");
        var texte = File.ReadAllText(AppearanceService.Fichier(_dir));
        Assert.DoesNotContain("\n", texte); // JSON compact (une seule ligne)
    }

    [Fact]
    public void Champs_partiels_tolerants()
    {
        // Seuls les champs présents comptent, le reste = défaut strict (parité sanitize).
        File.WriteAllText(AppearanceService.Fichier(_dir), "{\"theme\":\"dark\",\"sidebarWidth\":300}");
        var prefs = AppearanceService.Load(_dir);
        Assert.Equal("dark", prefs.Theme);
        Assert.Equal(300, prefs.SidebarWidth);
        Assert.Equal("emerald", prefs.Accent);
        Assert.False(prefs.VoiceAnnouncements);
        Assert.True(prefs.ChatsGroupedByAgent);
    }

    [Fact]
    public void Types_invalides_tolerants()
    {
        File.WriteAllText(AppearanceService.Fichier(_dir),
            "{\"theme\":42,\"accent\":true,\"sidebarWidth\":\"large\",\"showModel\":null,\"showComposer\":\"oui\"}");
        var prefs = AppearanceService.Load(_dir);
        Assert.Equal("light", prefs.Theme);
        Assert.Equal("emerald", prefs.Accent);
        Assert.Equal(286, prefs.SidebarWidth);
        Assert.True(prefs.ShowModel);   // défaut strict (null ≠ booléen)
        Assert.True(prefs.ShowComposer); // type invalide → défaut
    }
}
