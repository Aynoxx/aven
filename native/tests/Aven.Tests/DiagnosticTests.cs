using System.Text.Json.Nodes;
using Aven.Bridge;
using Xunit;

namespace Aven.Tests;

/// <summary>Jalon Paramètres (v10.0.0) : diagnostic copiable — port de
/// electron/diagnostic.ts. MÊME cas que tests/diagnostic.test.mjs, dont le test
/// anti-fuite qui plante une fausse clé et vérifie qu'elle n'apparaît nulle part
/// (la rédaction passe sur le document entier).</summary>
public class DiagnosticTests
{
    private const string FausseClé = "sk-or-v1-fake-key-for-anti-leak-test-0123456789";

    private static DiagnosticInput Entrée() => new(
        Versions: new Dictionary<string, string?> { ["app"] = "10.0.0", ["node"] = "22.0.0" },
        Platform: "win32-x64",
        Status: "ready",
        OpencodeVersion: "0.1.0",
        Cli: "embarqué",
        KeyIds: ["openrouter", "groq"],
        Assignments: new JsonObject
        {
            ["code"] = new JsonArray(new JsonObject { ["ref"] = "deepseek/deepseek-chat-v4:free", ["label"] = "DeepSeek" }),
        },
        Warning: null,
        KeyWarnings: new Dictionary<string, string> { ["openrouter"] = "Clé refusée." },
        Workspace: "C:/ws",
        Workspaces: ["Aven"],
        Log: ["boot ok"]);

    [Fact]
    public void Build_contenu_complet()
    {
        var texte = Diagnostic.Build(Entrée());
        Assert.Contains("\"app\": \"Aven\"", texte);
        Assert.Contains("\"present\"", texte);
        Assert.Contains("openrouter", texte);
        Assert.Contains("deepseek/deepseek-chat-v4:free", texte);
        Assert.Contains("Clé refusée.", texte);
        Assert.Contains("boot ok", texte);
        Assert.Contains("Aven", texte);
    }

    [Fact]
    public void Build_aucune_valeur_de_cle_en_dehors_des_ids()
    {
        // Les ids de providers sont autorisés, PAS les valeurs (parité anti-fuite).
        var texte = Diagnostic.Build(Entrée() with
        {
            Log = ["clé chargée " + FausseClé],
        });
        Assert.DoesNotContain(FausseClé, texte);
    }

    [Fact]
    public void RedactSecrets_formats_usuels()
    {
        // Parité tests/diagnostic.test.mjs : tout après « sk- » est mangé par le regex.
        Assert.Equal("sk-***", Diagnostic.RedactSecrets(FausseClé));
        Assert.Contains("Bearer ***", Diagnostic.RedactSecrets("Authorization: Bearer abcdef123456"));
        Assert.Contains("api_key=***", Diagnostic.RedactSecrets("api_key=abcdefgh12345678"));
        Assert.Contains("token=***", Diagnostic.RedactSecrets("token: abcdefgh12345678"));
        Assert.Contains("gsk_***", Diagnostic.RedactSecrets("gsk_abcdefgh12345678"));
    }

    [Fact]
    public void RedactSecrets_passe_sur_le_document_entier()
    {
        // Même si un secret arrive dans un CHAMP autorisé (warning), il est masqué.
        var texte = Diagnostic.Build(Entrée() with
        {
            Warning = "erreur avec " + FausseClé + " dedans",
        });
        Assert.DoesNotContain(FausseClé, texte);
        Assert.Contains("sk-***", texte);
    }

    [Fact]
    public void Build_warnings_sans_null_ni_vide()
    {
        var texte = Diagnostic.Build(Entrée() with { Warning = null, KeyWarnings = new Dictionary<string, string>() });
        // warning null + aucun keyWarning : tableau vide (parité filter(Boolean)).
        Assert.Contains("\"warnings\": []", texte);
        Assert.Contains("boot ok", texte);
    }
}
