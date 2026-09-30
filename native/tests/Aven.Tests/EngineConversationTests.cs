using Aven.Bridge;
using Xunit;

namespace Aven.Tests;

/// <summary>
/// Acceptation phase 1 du protocole MIGRATION-WINUI.md : une CONVERSATION COMPLÈTE
/// (session.create → session.prompt → events en push → message.list) depuis le
/// client C# <see cref="EngineClient"/> — contre un DOUBLE HONNÊTE du host : un
/// vrai process Node séparé qui lit les requêtes sur stdin et répond après coup
/// (timing réel, aucun court-circuit). Le VRAI bundle aven-engine-host.mjs est
/// exercé dans EngineHostProcessTests.
/// </summary>
public class EngineConversationTests : IDisposable
{
    private static readonly TimeSpan Délai = TimeSpan.FromSeconds(20);
    private readonly string _double;

    public EngineConversationTests()
    {
        _double = Path.Combine(Path.GetTempPath(), $"aven-host-double-{Guid.NewGuid():N}.mjs");
        File.WriteAllText(_double, """
            // Double honnête du host : JSON-RPC ligne sur stdio, réponses après les requêtes (ESM pur).
            import readline from "node:readline";
            const rl = readline.createInterface({ input: process.stdin });
            rl.on("line", (line) => {
              if (!line.trim()) return;
              const msg = JSON.parse(line);
              if (msg.id === undefined) return;
              const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
              const push = (type, data) => send({ jsonrpc: "2.0", method: "engine.event", params: { type, data } });
              const m = msg.method;
              setTimeout(() => {
                if (m === "session.create") {
                  send({ jsonrpc: "2.0", id: msg.id, result: { id: "s1", title: "Nouvelle conversation", agent: "projet", model: "opencode/big-pickle" } });
                } else if (m === "session.prompt") {
                  push("router.notice", { sessionID: "s1", model: "opencode/big-pickle", text: "Modèle : A (priorité projet)" });
                  push("message.part.updated", { sessionID: "s1", part: "Bonjour" });
                  push("message.part.updated", { sessionID: "s1", part: " le monde" });
                  push("session.execution.succeeded", { sessionID: "s1" });
                  send({ jsonrpc: "2.0", id: msg.id, result: { backend: "opencode" } });
                } else if (m === "message.list") {
                  send({ jsonrpc: "2.0", id: msg.id, result: [
                    { id: "m1", role: "user", text: "dis bonjour" },
                    { id: "m2", role: "assistant", text: "Bonjour le monde" },
                  ] });
                } else {
                  send({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "méthode inconnue : " + m } });
                }
              }, 10);
            });
            """);
    }

    public void Dispose()
    {
        try { File.Delete(_double); } catch { /* temp dir nettoyé par l'OS */ }
    }

    [Fact]
    public async Task Conversation_complète_create_send_events_messages()
    {
        await using var client = new EngineClient(_double, nodeExecPath: "node");
        var événements = new System.Collections.Concurrent.ConcurrentQueue<EngineEvent>();
        client.EventReceived += (ev) => événements.Enqueue(ev);
        using var annulé = new CancellationTokenSource(Délai);

        // 1. session.create (proxy SDK via le host)
        var créé = await client.CallAsync("session.create", new { agent = "projet" }, annulé.Token);
        Assert.Equal("s1", créé!["id"]!.GetValue<string>());

        // 2. session.prompt — le host répond APRÈS avoir poussé les événements du tour.
        var résultat = await client.CallAsync("session.prompt", new { sessionID = "s1", text = "dis bonjour" }, annulé.Token);
        Assert.Equal("opencode", résultat!["backend"]!.GetValue<string>());

        // 3. Les quatre événements du tour sont arrivés, dans l'ordre.
        Assert.Equal(
            new[] { "router.notice", "message.part.updated", "message.part.updated", "session.execution.succeeded" },
            événements.Select(e => e.Type).ToArray());
        Assert.Equal("Bonjour", événements.ElementAt(1).Data!["part"]!.GetValue<string>());

        // 4. message.list : le transcript reconstitué.
        var messages = await client.CallAsync("message.list", new { sessionID = "s1" }, annulé.Token);
        Assert.Equal(2, messages!.AsArray().Count);
        Assert.Equal("Bonjour le monde", messages[1]!["text"]!.GetValue<string>());
    }

    [Fact]
    public async Task Méthode_inconnue_renvoie_l_erreur_jsonrpc_du_host()
    {
        await using var client = new EngineClient(_double, nodeExecPath: "node");
        using var annulé = new CancellationTokenSource(Délai);

        var erreur = await Assert.ThrowsAsync<JsonRpcException>(
            () => client.CallAsync("inconnu.méthode", null, annulé.Token));

        Assert.Equal(-32601, erreur.Code);
    }

    [Fact]
    public async Task Après_EOF_les_nouveaux_appels_échouent_immédiatement()
    {
        // Pont direct sur un flux vide fermé : le lecteur voit l'EOF au premier appel.
        var connexion = new JsonRpcConnection(new StringReader(""), new StringWriter());
        connexion.Start();
        using var annulé = new CancellationTokenSource(Délai);
        await Assert.ThrowsAnyAsync<Exception>(() => connexion.CallAsync("ping", null, annulé.Token));

        // Le lecteur est mort : un NOUVEL appel doit échouer sans pendre (filet _terminal).
        var horloge = System.Diagnostics.Stopwatch.StartNew();
        await Assert.ThrowsAnyAsync<Exception>(() => connexion.CallAsync("ping", null, annulé.Token));
        Assert.True(horloge.Elapsed < Délai, "l'appel après EOF doit échouer immédiatement");
    }
}
