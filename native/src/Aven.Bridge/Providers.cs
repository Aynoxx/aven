using System.Text.Json.Nodes;

namespace Aven.Bridge;

/// <summary>Fournisseur de clés API (parité ProviderInfo de electron/providers.ts).</summary>
public sealed record ProviderInfo(string Id, string Label, string Env, string Url, string Note);

/// <summary>
/// Fournisseurs utilisés par Aven en mode strictement gratuit — port de
/// electron/providers.ts (v10.0.0, jalon parité) : OpenRouter Free pour les
/// modèles des agents, Groq pour la dictée ET les modèles groq gratuits du chat
/// (openCodeEnv: true depuis v9.6.0 : la clé est injectée dans le serveur OpenCode).
/// </summary>
public static class Providers
{
    public static readonly ProviderInfo[] Liste =
    [
        new("openrouter", "OpenRouter Free", "OPENROUTER_API_KEY", "https://openrouter.ai/keys",
            "Accès au catalogue gratuit OpenRouter. Les variantes :free sont à 0 $ ; quotas du plan Free appliqués par OpenRouter."),
        new("groq", "Groq (chat + dictée)", "GROQ_API_KEY", "https://console.groq.com/keys",
            "Chat : modèles gratuits ultra-rapides (llama, gpt-oss, qwen) injectés dans les chaînes par tâche. Dictée : bouton micro ou Ctrl+Maj+V (transcription Whisper, texte modifiable). Free tier : quotas généreux."),
    ];

    public static ProviderInfo? De(string id) => Liste.FirstOrDefault(p => p.Id == id);

    /// <summary>Sonde de clé OpenRouter sans appel de génération — parité probeOpenRouterKey.</summary>
    public static async Task<(bool Usable, string? Warning)> SondeOpenRouterAsync(
        string cle, HttpClient? http = null, CancellationToken cancellation = default)
    {
        var propre = cle.Trim();
        if (propre.Length == 0) return (false, "Clé OpenRouter vide.");
        var client = http ?? new HttpClient { Timeout = TimeSpan.FromSeconds(5) };
        using var requete = new HttpRequestMessage(HttpMethod.Get, "https://openrouter.ai/api/v1/auth/key");
        requete.Headers.Authorization = new System.Net.Http.Headers.AuthenticationHeaderValue("Bearer", propre);
        requete.Headers.TryAddWithoutValidation("Accept", "application/json");
        try
        {
            using var reponse = await client.SendAsync(requete, cancellation).ConfigureAwait(false);
            if (reponse.IsSuccessStatusCode) return (true, null);
            var message = "";
            try
            {
                var body = JsonNode.Parse(await reponse.Content.ReadAsStringAsync(cancellation).ConfigureAwait(false));
                message = (JsonAide.Texte(body?["error"], "message") ?? JsonAide.Texte(body, "message") ?? "").Trim();
            }
            catch { /* réponse non JSON */ }
            return (false, message.Length > 0 ? message : $"OpenRouter a refusé la clé (HTTP {(int)reponse.StatusCode}).");
        }
        catch (Exception erreur)
        {
            // « unknown » : le test n'est pas concluant — la clé reste UTILISABLE
            // (excludeProvider n'est posé que sur « invalid », parité web).
            return (true, $"OpenRouter n'est pas joignable pour le test : {erreur.Message}");
        }
    }
}
