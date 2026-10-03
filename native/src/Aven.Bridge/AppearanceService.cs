using System.Text.Json.Nodes;

namespace Aven.Bridge;

/// <summary>
/// Préférences d'apparence — port de <c>web/src/appearance.ts</c> pour les champs
/// RÉELLEMENT applicables à la fenêtre WinUI. Le web les range dans localStorage ; le
/// natif n'a pas de localStorage : fichier <c>appearance.json</c> dans le dossier de
/// données, JSON compact atomique. Défauts STRICTS identiques au web pour chaque champ
/// porté, sauf <see cref="AppearanceConfig.ShowSidebar"/> : dès le Jalon 2 la sidebar
/// natif suit la conversation, elle démarre donc à <c>true</c> (documenté + testé).
/// Non portés (aucun équivalent dans la fenêtre native) : densité, position de la
/// barre latérale, largeur des messages non, showHeader/notices/toolActivity, ordre des
/// blocs (drag &amp; drop) et ordre des agents.
/// </summary>
public sealed record AppearanceConfig(
    string Theme,
    string Accent,
    string CustomAccent,
    int SidebarWidth,
    int MessageWidth,
    bool ShowSidebar,
    bool ShowModel,
    bool ShowComposer,
    bool VoiceAnnouncements,
    bool ChatsGroupedByAgent);

public static class AppearanceService
{
    public static string Fichier(string dataDir) => Path.Combine(dataDir, "appearance.json");

    /// <summary>Défauts parité <c>defaultAppearance</c> de appearance.ts (champs portés).</summary>
    public static AppearanceConfig Defaut => new(
        Theme: "light",
        Accent: "emerald",
        CustomAccent: "#8b5cf6",
        SidebarWidth: 286,
        MessageWidth: 860,
        ShowSidebar: true, // natif : la sidebar suit la conversation (Jalon 2)
        ShowModel: true,
        ShowComposer: true,
        VoiceAnnouncements: false,
        ChatsGroupedByAgent: true);

    public static readonly string[] Themes = ["light", "system", "dark"];

    /// <summary>Parité presetAccents : clé → hex, plus "custom".</summary>
    public static readonly IReadOnlyDictionary<string, string> PresetsAccents = new Dictionary<string, string>
    {
        ["violet"] = "#8b5cf6",
        ["blue"] = "#3b82f6",
        ["emerald"] = "#10b981",
        ["rose"] = "#f43f5e",
        ["amber"] = "#f59e0b",
    };

    public static readonly string[] Accents = ["violet", "blue", "emerald", "rose", "amber", "custom"];

    /// <summary>Couleur effective de l'accent (parité accentColor).</summary>
    public static string CouleurAccent(AppearanceConfig config) =>
        config.Accent == "custom" ? config.CustomAccent : PresetsAccents[config.Accent];

    public static AppearanceConfig Load(string dataDir)
    {
        try
        {
            var raw = JsonNode.Parse(File.ReadAllText(Fichier(dataDir))) as JsonObject;
            if (raw is null) return Defaut;
            return Sanitize(new AppearanceConfig(
                Theme: Texte(raw, "theme") ?? Defaut.Theme,
                Accent: Texte(raw, "accent") ?? Defaut.Accent,
                CustomAccent: Texte(raw, "customAccent") ?? Defaut.CustomAccent,
                SidebarWidth: Entier(raw, "sidebarWidth") ?? Defaut.SidebarWidth,
                MessageWidth: Entier(raw, "messageWidth") ?? Defaut.MessageWidth,
                ShowSidebar: Bool(raw, "showSidebar", Defaut.ShowSidebar),
                ShowModel: Bool(raw, "showModel", Defaut.ShowModel),
                ShowComposer: Bool(raw, "showComposer", Defaut.ShowComposer),
                VoiceAnnouncements: Bool(raw, "voiceAnnouncements", Defaut.VoiceAnnouncements),
                ChatsGroupedByAgent: Bool(raw, "chatsGroupedByAgent", Defaut.ChatsGroupedByAgent)));
        }
        catch
        {
            /* première utilisation ou fichier corrompu : défauts web */
            return Defaut;
        }
    }

    /// <summary>Écriture compacte atomique (parité writeJsonAtomic du web).</summary>
    public static AppearanceConfig Save(string dataDir, AppearanceConfig config)
    {
        var propre = Sanitize(config);
        var objet = new JsonObject
        {
            ["theme"] = propre.Theme,
            ["accent"] = propre.Accent,
            ["customAccent"] = propre.CustomAccent,
            ["sidebarWidth"] = propre.SidebarWidth,
            ["messageWidth"] = propre.MessageWidth,
            ["showSidebar"] = propre.ShowSidebar,
            ["showModel"] = propre.ShowModel,
            ["showComposer"] = propre.ShowComposer,
            ["voiceAnnouncements"] = propre.VoiceAnnouncements,
            ["chatsGroupedByAgent"] = propre.ChatsGroupedByAgent,
        };
        AtomicFile.WriteJsonCompact(Fichier(dataDir), objet);
        return propre;
    }

    /// <summary>Normalise une valeur partiellement invalide (parité sanitize) :
    /// liste fermée, hex #RRGGBB, plages bornées — <c>0</c> ou absent retombe sur le
    /// défaut strict avant le clamp (parité <c>Number(x) || default</c>).</summary>
    public static AppearanceConfig Sanitize(AppearanceConfig config) => config with
    {
        Theme = Themes.Contains(config.Theme) ? config.Theme : Defaut.Theme,
        Accent = Accents.Contains(config.Accent) ? config.Accent : Defaut.Accent,
        CustomAccent = HexValide(config.CustomAccent) ? config.CustomAccent : Defaut.CustomAccent,
        SidebarWidth = Plage(config.SidebarWidth, 240, 420, Defaut.SidebarWidth),
        MessageWidth = Plage(config.MessageWidth, 560, 1100, Defaut.MessageWidth),
    };

    private static int Plage(int valeur, int min, int max, int defaut) =>
        valeur == 0 ? defaut : Math.Clamp(valeur, min, max);

    private static bool HexValide(string? hex) =>
        hex is { Length: 7 } && hex[0] == '#' && hex.Skip(1).All(Uri.IsHexDigit);

    private static string? Texte(JsonObject raw, string cle) =>
        raw[cle] is JsonValue v && v.TryGetValue<string>(out var s) ? s : null;

    private static int? Entier(JsonObject raw, string cle) =>
        raw[cle] is JsonValue v && v.TryGetValue<double>(out var d) ? (int)Math.Round(d) : null;

    private static bool Bool(JsonObject raw, string cle, bool defaut) =>
        raw[cle] is JsonValue v && v.TryGetValue<bool>(out var b) ? b : defaut;
}
