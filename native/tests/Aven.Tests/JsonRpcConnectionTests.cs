using System.Text;
using Aven.Bridge;
using Xunit;

namespace Aven.Tests;

/// <summary>
/// Socle du pont JSON-RPC (phase 0) : requêtes valides, routage par id, notifications,
/// erreurs moteur, tolérance aux lignes corrompues. Le host Node arrivera en phase 1 —
/// ces tests encodent le contrat que l'Electron actuel observe déjà.
/// </summary>
public class JsonRpcConnectionTests
{
    private static readonly TimeSpan Délai = TimeSpan.FromSeconds(10);

    private static JsonRpcConnection Create(string fluxEntrant, out StringWriter envoyé)
    {
        envoyé = new StringWriter(new StringBuilder());
        return new JsonRpcConnection(new StringReader(fluxEntrant), envoyé);
    }

    [Fact]
    public async Task CallAsync_écrit_une_requête_valide_et_route_la_réponse()
    {
        var pont = Create(
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"ok\":true}}\n", out var envoyé);
        using var annulé = new CancellationTokenSource(Délai);

        var résultat = await pont.CallAsync(
            "chats.list", new { workspace = "aven" }, annulé.Token);

        Assert.NotNull(résultat);
        Assert.True(résultat!["ok"]!.GetValue<bool>());
        var ligne = envoyé.ToString().TrimEnd();
        Assert.Contains("\"jsonrpc\":\"2.0\"", ligne);
        Assert.Contains("\"id\":1", ligne);
        Assert.Contains("\"method\":\"chats.list\"", ligne);
        Assert.Contains("\"params\":{\"workspace\":\"aven\"}", ligne);
    }

    [Fact]
    public async Task Les_notifications_du_moteur_arrivent_sur_l_event()
    {
        var pont = Create(
            "{\"jsonrpc\":\"2.0\",\"method\":\"opencode:event\",\"params\":{\"type\":\"message.part.updated\"}}\n" +
            "{\"jsonrpc\":\"2.0\",\"method\":\"opencode:event\",\"params\":{\"type\":\"session.idle\"}}\n",
            out _);
        var événements = new List<string?>();
        pont.NotificationReceived += p => événements.Add(p?["type"]?.GetValue<string>());
        pont.Start();
        using var annulé = new CancellationTokenSource(Délai);

        while (événements.Count < 2 && !annulé.IsCancellationRequested)
            await Task.Delay(20, annulé.Token);

        Assert.Equal(new[] { "message.part.updated", "session.idle" }, événements);
    }

    [Fact]
    public async Task Deux_appels_concurrents_reçoivent_chacun_sa_réponse()
    {
        // Réponses volontairement dans le désordre : le routage doit passer par l'id.
        var pont = Create(
            "{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":\"b\"}\n" +
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":\"a\"}\n", out _);
        using var annulé = new CancellationTokenSource(Délai);

        var appelA = pont.CallAsync("chats.list", null, annulé.Token);
        var appelB = pont.CallAsync("getStats", null, annulé.Token);

        Assert.Equal("a", (await appelA)!.GetValue<string>());
        Assert.Equal("b", (await appelB)!.GetValue<string>());
    }

    [Fact]
    public async Task Une_réponse_d_erreur_leve_JsonRpcException()
    {
        var pont = Create(
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32601,\"message\":\"méthode inconnue\"}}\n",
            out _);
        using var annulé = new CancellationTokenSource(Délai);

        var erreur = await Assert.ThrowsAsync<JsonRpcException>(
            () => pont.CallAsync("inconnu", null, annulé.Token));

        Assert.Equal(-32601, erreur.Code);
        Assert.Equal("méthode inconnue", erreur.Message);
    }

    [Fact]
    public async Task Une_ligne_corrompue_est_ignorée_sans_casser_le_flux()
    {
        var pont = Create(
            "{{ pas du json }\n" +
            "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":42}\n", out _);
        using var annulé = new CancellationTokenSource(Délai);

        var résultat = await pont.CallAsync("getStats", null, annulé.Token);

        Assert.Equal(42, résultat!.GetValue<int>());
    }

    [Fact]
    public async Task NotifyAsync_écrit_une_notification_sans_id()
    {
        var pont = Create("", out var envoyé);
        using var annulé = new CancellationTokenSource(Délai);

        await pont.NotifyAsync("chat.send", new { text = "salut" }, annulé.Token);

        var ligne = envoyé.ToString().TrimEnd();
        Assert.Contains("\"method\":\"chat.send\"", ligne);
        Assert.Contains("\"params\":{\"text\":\"salut\"}", ligne);
        Assert.DoesNotContain("\"id\"", ligne);
    }
}
