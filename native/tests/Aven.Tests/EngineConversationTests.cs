using System.Text.Json.Nodes;
using Aven.Bridge;
using Xunit;

namespace Aven.Tests;

/// <summary>
/// Acceptation phase 1 du protocole MIGRATION-WINUI.md : une CONVERSATION COMPLÈTE
/// (chat.create → chat.send → events en push → chat.messages) depuis un client C#.
/// Le moteur est simulé par un host factice (process Node ou stdin/stdout fournis)
/// qui rejoue fidèlement le protocole JSON-RPC du vrai aven-engine-host.mjs — les
/// tests du bundle réel (ping, proxy, arrêt) sont dans EngineHostProcessTests.
/// </summary>
public class EngineConversationTests
{
    private static readonly TimeSpan Délai = TimeSpan.FromSeconds(10);

    // Scénario du host factice : la conversation "s1" répond en 3 parts, avec un
    // router.notice en push, exactement comme le vrai host le fait aujourd'hui.
    private const string Scénario =
        "{\"jsonrpc\":\"2.0\",\"id\":1,\"result\":{\"id\":\"s1\",\"title\":\"Nouvelle conversation\",\"agent\":\"projet\",\"model\":\"opencode/big-pickle\"}}\n" +
        "{\"jsonrpc\":\"2.0\",\"method\":\"engine.event\",\"params\":{\"type\":\"router.notice\",\"data\":{\"sessionID\":\"s1\",\"model\":\"opencode/big-pickle\",\"text\":\"Modèle : A (priorité projet)\"}}}\n" +
        "{\"jsonrpc\":\"2.0\",\"method\":\"engine.event\",\"params\":{\"type\":\"message.part.updated\",\"data\":{\"sessionID\":\"s1\",\"part\":\"Bonjour\"}}}\n" +
        "{\"jsonrpc\":\"2.0\",\"method\":\"engine.event\",\"params\":{\"type\":\"message.part.updated\",\"data\":{\"sessionID\":\"s1\",\"part\":\" le monde\"}}}\n" +
        "{\"jsonrpc\":\"2.0\",\"method\":\"engine.event\",\"params\":{\"type\":\"session.execution.succeeded\",\"data\":{\"sessionID\":\"s1\"}}}\n" +
        "{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"backend\":\"opencode\"}}\n" +
        "{\"jsonrpc\":\"2.0\",\"id\":3,\"result\":[{\"id\":\"m1\",\"role\":\"user\",\"text\":\"dis bonjour\"},{\"id\":\"m2\",\"role\":\"assistant\",\"text\":\"Bonjour le monde\"}]}\n";

    private static (EngineClient client, List<EngineEvent> événements) ClientSurFlux(out StringWriter envoyé)
    {
        // EngineClient avec node=null exige un vrai process : pour ce test de
        // protocole on pilote JsonRpcConnection directement (même contrat, même
        // routage par id), EngineClient ajoutant la possession du process.
        envoyé = new StringWriter();
        var connexion = new JsonRpcConnection(new StringReader(Scénario), envoyé);
        var événements = new List<EngineEvent>();
        connexion.NotificationReceived += (p) =>
        {
            var type = p?["type"]?.GetValue<string>();
            if (type is not null) événements.Add(new EngineEvent(type, p?["data"]));
        };
        connexion.Start();
        return (null!, événements);
    }

    [Fact]
    public async Task Conversation_complète_create_send_events_messages()
    {
        var envoyé = new StringWriter();
        var connexion = new JsonRpcConnection(new StringReader(Scénario), envoyé);
        var événements = new List<EngineEvent>();
        connexion.NotificationReceived += (p) =>
        {
            var type = p?["type"]?.GetValue<string>();
            if (type is not null) événements.Add(new EngineEvent(type, p?["data"]));
        };
        using var annulé = new CancellationTokenSource(Délai);

        // 1. chat.create (session.create via proxy SDK)
        var créé = await connexion.CallAsync("session.create", new { agent = "projet" }, annulé.Token);
        Assert.Equal("s1", créé!["id"]!.GetValue<string>());

        // 2. chat.send — le host répond, les events de streaming sont poussés ENTRE les deux réponses.
        var envoyéRésultat = await connexion.CallAsync("session.prompt", new { sessionID = "s1", text = "dis bonjour" }, annulé.Token);
        Assert.Equal("opencode", envoyéRésultat!["backend"]!.GetValue<string>());

        // 3. Les trois événements du tour sont arrivés, dans l'ordre.
        Assert.Equal(
            new[] { "router.notice", "message.part.updated", "message.part.updated", "session.execution.succeeded" },
            événements.Select(e => e.Type).ToArray());
        Assert.Equal("Bonjour", événements[1].Data!["part"]!.GetValue<string>());

        // 4. chat.messages : le transcript reconstitué.
        var messages = await connexion.CallAsync("message.list", new { sessionID = "s1" }, annulé.Token);
        Assert.Equal(2, messages!.AsArray().Count);
        Assert.Equal("Bonjour le monde", messages[1]!["text"]!.GetValue<string>());

        // 5. Les requêtes parties sur le fil portent les bonnes méthodes
        // (séparation par lignes quel que soit le saut de ligne du writer).
        var lignes = envoyé.ToString().Split(new[] { '\r', '\n' }, StringSplitOptions.RemoveEmptyEntries);
        Assert.Contains(lignes, (l) => l.Contains("\"session.create\""));
        Assert.Contains(lignes, (l) => l.Contains("\"session.prompt\""));
        Assert.Contains(lignes, (l) => l.Contains("\"message.list\""));
    }

    [Fact]
    public async Task Reconnexion_après_mort_du_host_les_appels_reçoivent_une_erreur_claire()
    {
        var connexion = new JsonRpcConnection(new StringReader(""), new StringWriter());
        // Flux vide fermé : la boucle de lecture voit EOF → les appels échouent proprement.
        connexion.Start();
        using var annulé = new CancellationTokenSource(Délai);

        var erreur = await Assert.ThrowsAsync<IOException>(
            () => connexion.CallAsync("ping", null, annulé.Token));

        Assert.Contains("flux d'entrée fermé", erreur.Message);
    }
}
