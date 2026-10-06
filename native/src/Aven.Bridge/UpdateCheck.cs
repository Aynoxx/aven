using System.Text.Json.Nodes;

namespace Aven.Bridge;

/// <summary>
/// Canal de mise a jour natif (parite du publish electron-updater « github ->
/// Aynoxx/aven » + checkForUpdates de electron/main.ts) : l'endpoint est la
/// GitHub Releases du depot, la comparaison semver est pure et testee. La
/// semantique est celle du web : on SIGNALE seulement (« Version disponible :
/// X »), on n'installe jamais depuis l'app (parite autoDownload=false).
/// </summary>
public static class UpdateCheck
{
    public const string Proprietaire = "Aynoxx";
    public const string Depot = "aven";

    public static string UrlReleases =>
        $"https://api.github.com/repos/{Proprietaire}/{Depot}/releases/latest";

    /// <summary>Extrait un semver « X.Y.Z » d'un tag de release (v9.8.0 -> 9.8.0,
    /// "release-9.8.0" -> 9.8.0 ; sans 3 composants numeriques : null).</summary>
    public static string? SemverDeTag(string? tag)
    {
        if (string.IsNullOrWhiteSpace(tag)) return null;
        var m = System.Text.RegularExpressions.Regex.Match(tag, @"(\d+)\.(\d+)\.(\d+)");
        return m.Success ? $"{m.Groups[1].Value}.{m.Groups[2].Value}.{m.Groups[3].Value}" : null;
    }

    /// <summary>Comparaison semver 3 composants : -1 si a inferieur a b, 0 si egaux,
    /// +1 si a superieur a b. Les composants manquants valent 0.</summary>
    public static int Comparer(string? a, string? b)
    {
        var pa = (a ?? "").Split('.');
        var pb = (b ?? "").Split('.');
        for (var i = 0; i < 3; i++)
        {
            var va = i < pa.Length && int.TryParse(pa[i], out var x) ? x : 0;
            var vb = i < pb.Length && int.TryParse(pb[i], out var y) ? y : 0;
            if (va != vb) return va < vb ? -1 : 1;
        }
        return 0;
    }

    /// <summary>Resultat d'une verification — meme forme que l'IPC web
    /// ({ ok, message }), la couche UI le projette dans le texte des Reglages.</summary>
    public sealed record Resultat(bool Ok, string Message);

    /// <summary>Decision pure (testee) : tag distant superieur a la version locale =&gt;
    /// « Version disponible : X.Y.Z » ; sinon « Aucune mise a jour disponible. » —
    /// les DEUX messages du IPC web sont couverts.</summary>
    public static Resultat Analyser(string? tagDistant, string versionLocale)
    {
        var distante = SemverDeTag(tagDistant);
        if (distante is null)
            return new Resultat(false, "Reponse de mise a jour illisible (tag sans semver).");
        var locale = SemverDeTag(versionLocale) ?? "0.0.0";
        return Comparer(distante, locale) > 0
            ? new Resultat(true, "Version disponible : " + distante)
            : new Resultat(true, "Aucune mise a jour disponible.");
    }

    /// <summary>Interroge l'endpoint GitHub (tag_name de la release « latest »).
    /// Jamais d'exception hors annulation : le resultat porte l'erreur, comme cote web.</summary>
    public static async Task<Resultat> VerifierAsync(string versionLocale, CancellationToken cancellation = default)
    {
        try
        {
            using var http = new System.Net.Http.HttpClient();
            http.DefaultRequestHeaders.UserAgent.ParseAdd("Aven-Native-UpdateCheck");
            http.DefaultRequestHeaders.Accept.ParseAdd("application/vnd.github+json");
            using var reponse = await http.GetAsync(UrlReleases, cancellation).ConfigureAwait(false);
            if (!reponse.IsSuccessStatusCode)
                return new Resultat(false, $"Endpoint de mise a jour indisponible (HTTP {(int)reponse.StatusCode}).");
            var corps = JsonNode.Parse(await reponse.Content.ReadAsStringAsync(cancellation).ConfigureAwait(false));
            return Analyser(Jsonx.S(corps?["tag_name"]), versionLocale);
        }
        catch (OperationCanceledException) { throw; }
        catch (Exception erreur)
        {
            return new Resultat(false, erreur.Message);
        }
    }
}
