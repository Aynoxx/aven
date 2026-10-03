using System.Net.Http.Headers;
using System.Text;
using System.Text.Json.Nodes;

namespace Aven.Bridge;

/// <summary>
/// Transport HTTP réel du pipeline voix (phase 6) : HttpClient vers Groq — JSON pour
/// les passes texte (reformage, classification), multipart pour la transcription
/// Whisper. Les erreurs sont traduites en messages lisibles (parité groqError de
/// voice.ts) ; le pont est mince : toute la logique est testée en xUnit via IVoiceHttp.
/// </summary>
public sealed class GroqHttp : IVoiceHttp
{
    private readonly HttpClient _http;

    public GroqHttp()
        : this(CreateClient())
    {
    }

    public GroqHttp(HttpClient http)
    {
        _http = http;
        _http.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/json"));
    }

    private static HttpClient CreateClient()
    {
        // HttpClient survivant pour éviter les conflits de port/connection et garder
        // une seule connexion persistée vers Groq par appareil (parité du client Web).
        return new HttpClient
        {
            Timeout = TimeSpan.FromSeconds(90),
        };
    }

    public async Task<JsonNode?> PostAsync(string url, IReadOnlyDictionary<string, string>? headers,
        JsonNode body, int timeoutMs, CancellationToken cancellation)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        cts.CancelAfter(timeoutMs);

        using var requête = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(body?.ToString() ?? "{}", Encoding.UTF8, "application/json"),
        };

        AjouterEnTêtes(requête, headers);
        using var réponse = await _http.SendAsync(requête, cts.Token).ConfigureAwait(false);
        return await LireAsync(réponse, cts.Token).ConfigureAwait(false);
    }

    public async Task<JsonNode?> PostMultipartAsync(string url, IReadOnlyDictionary<string, string>? headers,
        byte[] fichier, string nomFichier, string mimeType, IReadOnlyDictionary<string, string> champs,
        int timeoutMs, CancellationToken cancellation)
    {
        using var cts = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        cts.CancelAfter(timeoutMs);

        using var contenu = new MultipartFormDataContent();
        var octets = new ByteArrayContent(fichier);
        octets.Headers.TryAddWithoutValidation("Content-Type", mimeType);
        contenu.Add(octets, "file", nomFichier);
        foreach (var (clé, valeur) in champs)
            contenu.Add(new StringContent(valeur), clé);

        using var requête = new HttpRequestMessage(HttpMethod.Post, url) { Content = contenu };
        AjouterEnTêtes(requête, headers);
        using var réponse = await _http.SendAsync(requête, cts.Token).ConfigureAwait(false);
        return await LireAsync(réponse, cts.Token).ConfigureAwait(false);
    }

    private static void AjouterEnTêtes(HttpRequestMessage requête, IReadOnlyDictionary<string, string>? headers)
    {
        if (headers is null) return;
        foreach (var (clé, valeur) in headers)
            requête.Headers.TryAddWithoutValidation(clé, valeur);
    }

    private static async Task<JsonNode?> LireAsync(HttpResponseMessage réponse, CancellationToken cancellation)
    {
        var texte = await réponse.Content.ReadAsStringAsync(cancellation).ConfigureAwait(false);

        if (réponse.IsSuccessStatusCode)
            return JsonNode.Parse(texte);

        // Parité groqError : le message du corps si lisible, sinon HTTP + code.
        string détail;
        try
        {
            var corps = JsonNode.Parse(texte);
            var erreur = corps?["error"];
            détail = erreur is JsonObject
                ? JsonAide.Texte(erreur, "message") ?? $"HTTP {(int)réponse.StatusCode}"
                : JsonAide.Texte(erreur, "") ?? JsonAide.Texte(corps, "message") ?? $"HTTP {(int)réponse.StatusCode}";
        }
        catch
        {
            détail = $"HTTP {(int)réponse.StatusCode}";
        }

        throw new InvalidOperationException(détail);
    }
}
