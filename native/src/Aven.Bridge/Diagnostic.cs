using System.Text.Encodings.Web;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;

namespace Aven.Bridge;

/// <summary>Entrée du diagnostic copiable (parité DiagnosticInput de electron/diagnostic.ts).</summary>
public sealed record DiagnosticInput(
    IReadOnlyDictionary<string, string?> Versions,
    string Platform,
    string Status,
    string? OpencodeVersion = null,
    string? Cli = null,
    /// <summary>Identifiants des clés PRÉSENTES (ex. « openrouter ») — jamais les valeurs.</summary>
    IReadOnlyList<string>? KeyIds = null,
    /// <summary>agent → modèles par ordre de priorité (refs + libellés, aucune clé).</summary>
    JsonNode? Assignments = null,
    string? Warning = null,
    IReadOnlyDictionary<string, string>? KeyWarnings = null,
    string? Workspace = null,
    IReadOnlyList<string>? Workspaces = null,
    IReadOnlyList<string>? Log = null);

/// <summary>
/// Diagnostic copiable (v9.1.0) — port de <c>electron/diagnostic.ts</c> : un JSON lisible
/// qui décrit l'installation sans JAMAIS contenir une clé API. La rédaction
/// <see cref="RedactSecrets"/> passe sur le document SÉRIALISÉ entier, en tout dernier
/// recours (dernière ligne de défense, même si un secret a fui via un message d'erreur).
/// Testé en xUnit avec la même fausse clé plantée que le test Node.
/// </summary>
public static class Diagnostic
{
    private static readonly Regex Ordonnanceurs =
        new(@"\b(sk|gsk|rk|dsk)-[A-Za-z0-9_-]{6,}", RegexOptions.Compiled);

    private static readonly Regex Prefixed =
        new(@"\b(gsk_|xoxb-|hf_)[A-Za-z0-9_-]{6,}", RegexOptions.Compiled);

    private static readonly Regex Bearer =
        new(@"\bBearer\s+[A-Za-z0-9._-]{8,}", RegexOptions.Compiled | RegexOptions.IgnoreCase);

    private static readonly Regex Affectations =
        new(@"\b(api[_-]?key|token|authorization|password)\s*[=:]\s*[^\s"",;]{8,}",
            RegexOptions.Compiled | RegexOptions.IgnoreCase);

    /// <summary>Masque tout ce qui ressemble à un secret — volontairement over-large :
    /// autant masquer un faux positif qu'exposer une vraie clé (parité redactSecrets).</summary>
    public static string RedactSecrets(string text)
    {
        var resultat = Ordonnanceurs.Replace(text, "$1-***");
        resultat = Prefixed.Replace(resultat, "$1***");
        resultat = Bearer.Replace(resultat, "Bearer ***");
        return Affectations.Replace(resultat, "$1=***");
    }

    public static string Build(DiagnosticInput input)
    {
        var doc = new Dictionary<string, object?>
        {
            ["app"] = "Aven",
            ["versions"] = input.Versions,
            ["platform"] = input.Platform,
            ["engine"] = new Dictionary<string, object?>
            {
                ["status"] = input.Status,
                ["opencodeVersion"] = input.OpencodeVersion,
                ["cli"] = input.Cli,
            },
            // Aucune valeur de clé ne doit JAMAIS arriver ici : seulement les ids de providers.
            ["keys"] = new Dictionary<string, object?> { ["present"] = input.KeyIds ?? [] },
            ["agents"] = input.Assignments,
            ["workspace"] = input.Workspace,
            ["workspaces"] = input.Workspaces ?? [],
            ["warnings"] = new[] { input.Warning }
                .Concat((input.KeyWarnings ?? new Dictionary<string, string>()).Values)
                .Where(w => !string.IsNullOrEmpty(w))
                .ToList(),
            ["log"] = input.Log ?? [],
        };
        // Parité JSON.stringify : pas d'échappement \u00E9 (encodeur par défaut de .NET).
        var json = JsonSerializer.Serialize(doc, new JsonSerializerOptions
        {
            WriteIndented = true,
            Encoder = JavaScriptEncoder.UnsafeRelaxedJsonEscaping,
        });
        // Rédaction en tout dernier recours, sur le JSON entier (parité buildDiagnostic).
        return RedactSecrets(json);
    }
}
