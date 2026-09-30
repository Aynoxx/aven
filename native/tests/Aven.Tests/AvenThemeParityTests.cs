using System.Globalization;
using System.Text.RegularExpressions;
using Aven.Bridge;
using Xunit;

namespace Aven.Tests;

/// <summary>
/// PARITÉ DU THÈME (acceptation phase 2 du protocole MIGRATION-WINUI.md) : les
/// tokens C# (AvenTheme) sont comparés au CSS réel de l'app (« web/src/App.css »).
/// Le CSS est relu à chaque exécution des tests : si le web change, le test échoue
/// jusqu'à alignement — la dérive est impossible en silence.
/// </summary>
public class AvenThemeParityTests
{
    private static string CheminAppCss()
    {
        for (var dir = new DirectoryInfo(AppContext.BaseDirectory); dir is not null; dir = dir.Parent)
        {
            var candidat = Path.Combine(dir.FullName, "web", "src", "App.css");
            if (File.Exists(candidat)) return candidat;
        }
        return "";
    }

    private static string Css()
    {
        var p = CheminAppCss();
        Assert.True(p.Length > 0, "web/src/App.css introuvable depuis le dossier de test");
        return File.ReadAllText(p);
    }

    /// <summary>Extrait la valeur d'un token du bloc :root ou :root[data-theme="dark"].</summary>
    private static string Token(string css, string nom, bool dark)
    {
        var bloc = dark
            ? Regex.Match(css, @"\[data-theme=\""dark\""\]\s*\{(?<b>[^}]*)\}").Groups["b"].Value
            : Regex.Match(css, @"^:root\s*\{(?<b>[^}]*)\}", RegexOptions.Multiline).Groups["b"].Value;
        var m = Regex.Match(bloc, $@"--{nom}:\s*([^;]+);");
        Assert.True(m.Success, $"token --{nom} introuvable dans {(dark ? "dark" : "light")}");
        return m.Groups[1].Value.Trim();
    }

    private static AvenColor HexDuBloc(string css, string token, bool dark, string hexAttendu)
    {
        var brut = Token(css, token, dark);
        // #hex direct ou color-mix(in srgb, X p%, Y) — on retrouve la couleur de base Y.
        var hex = Regex.Match(brut, @"#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$").Value;
        if (hex.Length == 0)
        {
            var baseHex = Regex.Match(brut, @"#(?:[0-9a-fA-F]{6}|[0-9a-fA-F]{8})").Value;
            Assert.True(baseHex.Length > 0, $"--{token} ({(dark ? "dark" : "light")}) : aucune couleur hex lisible dans « {brut} »");
            return AvenColor.FromHex(baseHex);
        }
        return AvenColor.FromHex(hex);
    }

    [Fact]
    public void Accent_identique_web_et_natif()
    {
        var css = Css();
        Assert.Equal("--accent: " + AvenTheme.Accent, $"--accent: {Token(css, "accent", dark: false)}");
    }

    [Fact]
    public void Tokens_solides_light_et_dark_identiques_au_css()
    {
        var css = Css();
        // Light
        Assert.Equal(AvenColor.FromHex("#ffffff"), HexDuBloc(css, "panel-solid", false, "#ffffff"));
        Assert.Equal(AvenColor.FromHex("#eef0f6"), HexDuBloc(css, "panel-soft", false, "#eef0f6"));
        Assert.Equal(AvenColor.FromHex("#171923"), HexDuBloc(css, "text", false, "#171923"));
        Assert.Equal(AvenColor.FromHex("#707689"), HexDuBloc(css, "muted", false, "#707689"));
        Assert.Equal(AvenColor.FromHex("#ef4444"), HexDuBloc(css, "danger", false, "#ef4444"));
        Assert.Equal(AvenColor.FromHex("#10b981"), HexDuBloc(css, "success", false, "#10b981"));
        Assert.Equal(AvenColor.FromHex("#f59e0b"), HexDuBloc(css, "warning", false, "#f59e0b"));
        // Dark
        Assert.Equal(AvenColor.FromHex("#12151d"), HexDuBloc(css, "panel-solid", true, "#12151d"));
        Assert.Equal(AvenColor.FromHex("#171b24"), HexDuBloc(css, "panel-soft", true, "#171b24"));
        Assert.Equal(AvenColor.FromHex("#f4f5f8"), HexDuBloc(css, "text", true, "#f4f5f8"));
        Assert.Equal(AvenColor.FromHex("#9299aa"), HexDuBloc(css, "muted", true, "#9299aa"));
    }

    [Fact]
    public void Backgrounds_color_mix_recalculés_à_l_identique()
    {
        var css = Css();
        var accent = AvenColor.FromHex(AvenTheme.Accent);
        Assert.Equal(
            AvenTheme.Mix(accent, 0.06, AvenColor.FromHex("#fbfbfd")).ToString(),
            AvenTheme.Light.Bg.ToString());
        Assert.Equal(
            AvenTheme.Mix(accent, 0.14, AvenColor.FromHex("#05060a")).ToString(),
            AvenTheme.Dark.Bg.ToString());
        // Et les bases lues du CSS sont bien celles attendues :
        Assert.Contains("#fbfbfd", Token(css, "bg", dark: false));
        Assert.Contains("#05060a", Token(css, "bg", dark: true));
    }

    [Fact]
    public void Tokens_de_motion_identiques_au_css()
    {
        var css = Css();
        Assert.Equal(AvenTheme.DurFastMs, int.Parse(Regex.Match(Token(css, "dur-fast", false), @"\d+").Value));
        Assert.Equal(AvenTheme.DurMedMs, int.Parse(Regex.Match(Token(css, "dur-med", false), @"\d+").Value));
        Assert.Equal(AvenTheme.DurSlowMs, int.Parse(Regex.Match(Token(css, "dur-slow", false), @"\d+").Value));
        // InvariantCulture + normalisation : le CSS écrit « .22 » sans zéro leading.
        static string Bezier((float X1, float Y1, float X2, float Y2) c)
        {
            var s = string.Create(CultureInfo.InvariantCulture, $"{c.X1}, {c.Y1}, {c.X2}, {c.Y2}");
            return s.Replace("0.", "."); // 0.22 → .22 (le CSS écrit les fractions sans zéro leading)
        }
        Assert.Contains(Bezier(AvenTheme.EaseOut), Token(css, "ease-out", false));
        Assert.Contains(Bezier(AvenTheme.EaseSpring), Token(css, "ease-spring", false));
    }

    [Fact]
    public void Parseur_couleurs_gère_hex_court_et_alpha()
    {
        Assert.Equal(new AvenColor(255, 0x8b, 0x5c, 0xf6), AvenColor.FromHex("#8b5cf6"));
        Assert.Equal(new AvenColor(0x17, 0x14, 0x18, 0x26), AvenColor.FromHex("#14182617"));
        Assert.Equal("#FF8B5CF6", AvenColor.FromHex("#8b5cf6").ToString().ToUpperInvariant());
    }
}
