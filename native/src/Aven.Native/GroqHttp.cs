using System.Net;
using System.Text;
using System.Text.Json.Nodes;

namespace Aven.Native;

/// <summary>
/// Transport HTTP réel du pipeline voix (phase 6) : HttpClient vers Groq — JSON pour
/// les passes texte (reformage, classification), multipart pour la transcription
/// Whisper. Les erreurs sont traduites en messages lisibles (parité groqError de
/// voice.ts) ; le pont est mince : toute la logique est testée en xUnit via IVoiceHttp.
/// </summary>
public sealed class GroqHttp : Aven.Bridge.IVoiceHttp
{
    private static readonly HttpClient Client = new();

    public async Task<JsonNode?> PostAsync(string url, IReadOnlyDictionary<string, string>? enTêtes,
        JsonNode corps, int timeoutMs, CancellationToken cancellation)
    {
        using var requête = new HttpRequestMessage(HttpMethod.Post, url)
        {
            Content = new StringContent(corps.ToJsonString(), Encoding.UTF8, "application/json"),
        };
        AjouterEnTêtes(requête, enTêtes);
        using var délai = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        délai.CancelAfter(timeoutMs);
        using var réponse = await Client.SendAsync(requête, délai.Token).ConfigureAwait(false);
        return await LireAsync(réponse, délai.Token).ConfigureAwait(false);
    }

    public async Task<JsonNode?> PostMultipartAsync(string url, IReadOnlyDictionary<string, string>? enTêtes,
        byte[] fichier, string nomFichier, string mimeType, IReadOnlyDictionary<string, string> champs,
        int timeoutMs, CancellationToken cancellation)
    {
        using var contenu = new MultipartFormDataContent();
        var octets = new ByteArrayContent(fichier);
        octets.Headers.TryAddWithoutValidation("Content-Type", mimeType);
        contenu.Add(octets, "file", nomFichier);
        foreach (var (clé, valeur) in champs) contenu.Add(new StringContent(valeur), clé);
        using var requête = new HttpRequestMessage(HttpMethod.Post, url) { Content = contenu };
        AjouterEnTêtes(requête, enTêtes);
        using var délai = CancellationTokenSource.CreateLinkedTokenSource(cancellation);
        délai.CancelAfter(timeoutMs);
        using var réponse = await Client.SendAsync(requête, délai.Token).ConfigureAwait(false);
        return await LireAsync(réponse, délai.Token).ConfigureAwait(false);
    }

    private static void AjouterEnTêtes(HttpRequestMessage requête, IReadOnlyDictionary<string, string>? enTêtes)
    {
        if (enTêtes is null) return;
        foreach (var (clé, valeur) in enTêtes) requête.Headers.TryAddWithoutValidation(clé, valeur);
    }

    private static async Task<JsonNode?> LireAsync(HttpResponseMessage réponse, CancellationToken cancellation)
    {
        var texte = await réponse.Content.ReadAsStringAsync(cancellation).ConfigureAwait(false);
        if (réponse.IsSuccessStatusCode) return JsonNode.Parse(texte);
        // Parité groqError : le message du corps si lisible, sinon HTTP + code.
        string détail;
        try
        {
            var corps = JsonNode.Parse(texte);
            var erreur = corps?["error"];
            détail = erreur is JsonObject
                ? Aven.Bridge.JsonAide.Texte(erreur, "message") ?? $"HTTP {(int)réponse.StatusCode}"
                : Aven.Bridge.JsonAide.Texte(erreur, "") ?? Aven.Bridge.JsonAide.Texte(corps, "message") ?? $"HTTP {(int)réponse.StatusCode}";
        }
        catch { détail = $"HTTP {(int)réponse.StatusCode}"; }
        throw new InvalidOperationException(détail);
    }
}
