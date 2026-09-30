using System.Globalization;

namespace Aven.Bridge;

/// <summary>Une couleur ARGB immuable (parseur sans dépendance).</summary>
public readonly record struct AvenColor(byte A, byte R, byte G, byte B)
{
    /// <summary>#RRGGBB ou #RRGGBBAA.</summary>
    public static AvenColor FromHex(string hex)
    {
        var s = hex.TrimStart('#');
        if (s.Length is not (6 or 8)) throw new FormatException($"Hex couleur invalide : {hex}");
        byte A(byte i) => byte.Parse(s.Substring(i, 2), NumberStyles.HexNumber, CultureInfo.InvariantCulture);
        return s.Length == 6
            ? new AvenColor(255, A(0), A(2), A(4))
            : new AvenColor(A(6), A(0), A(2), A(4));
    }

    public override string ToString() => $"#{A:X2}{R:X2}{G:X2}{B:X2}";
}

/// <summary>
/// Les tokens du thème Aven — PARITÉ avec « web/src/App.css » (§ :root light/dark).
/// Les valeurs sont ici en un seul endroit pour les ThemeDictionaries XAML et les
/// tests comparent AUTOMATIQUEMENT ces constantes au CSS (AvenThemeParityTests) :
/// si le web change, le test échoue jusqu'à alignement — la parité ne peut pas dériver.
/// Les tokens color-mix() du CSS sont exprimés en pré-calculé (le mix est statique
/// puisque l'accent est fixe).
/// </summary>
public static class AvenTheme
{
    public const string Accent = "#8b5cf6";

    // ── Light (défaut, « :root ») ────────────────────────────────────────────────
    public static class Light
    {
        // color-mix(in srgb, #8b5cf6 6%, #fbfbfd) ≈ calcul exact :
        public static readonly AvenColor Bg = Mix(AvenColor.FromHex(Accent), 0.06, AvenColor.FromHex("#fbfbfd"));
        public static readonly AvenColor PanelSolid = AvenColor.FromHex("#ffffff");
        public static readonly AvenColor PanelSoft = AvenColor.FromHex("#eef0f6");
        public static readonly AvenColor Border = AvenColor.FromHex("#14182617"); // rgba(20,24,38,.09)
        public static readonly AvenColor BorderStrong = AvenColor.FromHex("#14182626"); // rgba(20,24,38,.15)
        public static readonly AvenColor Text = AvenColor.FromHex("#171923");
        public static readonly AvenColor Muted = AvenColor.FromHex("#707689");
        public static readonly AvenColor Danger = AvenColor.FromHex("#ef4444");
        public static readonly AvenColor Success = AvenColor.FromHex("#10b981");
        public static readonly AvenColor Warning = AvenColor.FromHex("#f59e0b");
    }

    // ── Dark (« :root[data-theme=dark] ») ───────────────────────────────────────
    public static class Dark
    {
        public static readonly AvenColor Bg = Mix(AvenColor.FromHex(Accent), 0.14, AvenColor.FromHex("#05060a"));
        public static readonly AvenColor PanelSolid = AvenColor.FromHex("#12151d");
        public static readonly AvenColor PanelSoft = AvenColor.FromHex("#171b24");
        public static readonly AvenColor Border = AvenColor.FromHex("#ffffff14"); // rgba(255,255,255,.08)
        public static readonly AvenColor BorderStrong = AvenColor.FromHex("#ffffff24"); // rgba(255,255,255,.14)
        public static readonly AvenColor Text = AvenColor.FromHex("#f4f5f8");
        public static readonly AvenColor Muted = AvenColor.FromHex("#9299aa");
    }

    // ── Motion (v9.7.0) : durées ms + points de contrôle des courbes ────────────
    public const int DurFastMs = 120;
    public const int DurMedMs = 240;
    public const int DurSlowMs = 380;
    // cubic-bezier(.22, 1, .36, 1) — « decelerate » Fluent
    public static readonly (float X1, float Y1, float X2, float Y2) EaseOut = (0.22f, 1f, 0.36f, 1f);
    // cubic-bezier(.34, 1.56, .64, 1) — léger dépassement
    public static readonly (float X1, float Y1, float X2, float Y2) EaseSpring = (0.34f, 1.56f, 0.64f, 1f);
    // Cascades : décalage par carte (--stagger-i × 45 ms).
    public const int StaggerStepMs = 45;

    /// <summary>Mix sRGB linéaire (équivalent color-mix(in srgb, a p%, b)) — alpha ignoré.</summary>
    public static AvenColor Mix(AvenColor a, double pourcent, AvenColor b)
    {
        byte C(byte xa, byte xb) => (byte)Math.Round(xa * pourcent + xb * (1 - pourcent));
        return new AvenColor(b.A, C(a.R, b.R), C(a.G, b.G), C(a.B, b.B));
    }
}
