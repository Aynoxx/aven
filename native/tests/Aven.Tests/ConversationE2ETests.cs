using Aven.Bridge;
using System.Diagnostics;
using Xunit;

namespace Aven.Tests;

/// <summary>
/// Acceptation phase 3 du protocole MIGRATION-WINUI.md : conversation RÉELLE
/// bout-en-bout depuis le client C# <see cref="ConversationClient"/> — create → send
/// → streaming (deltas append incrémental) → autorisation (permission.asked) →
/// question de l'agent (form.created) → transcript avec sous-agents → Arrêt (Échap)
/// en plein tour. Contre un double honnête STATEFUL du host : un vrai process Node
/// séparé qui maintient des sessions, pousse les événements pendant les tours et
/// attend les réponses du client (timing réel, aucun court-circuit).
/// </summary>
public class ConversationE2ETests : IDisposable
{
    private static readonly TimeSpan Délai = TimeSpan.FromSeconds(30);
    private readonly string _double;

    public ConversationE2ETests()
    {
        _double = Path.Combine(Path.GetTempPath(), $"aven-host-conv-{Guid.NewGuid():N}.mjs");
        File.WriteAllText(_double, """
            // Double honnête du host : JSON-RPC ligne sur stdio, sessions EN MÉMOIRE, tours
            // asynchrones avec événements push (ESM pur, Node seul).
            import readline from "node:readline";
            const sessions = new Map();
            let nextId = 0;
            const rl = readline.createInterface({ input: process.stdin });
            const send = (m) => process.stdout.write(JSON.stringify(m) + "\n");
            const push = (type, data) => send({ jsonrpc: "2.0", method: "engine.event", params: { type, data } });
            const ok = (id, result) => send({ jsonrpc: "2.0", id, result });
            const fail = (id, message) => send({ jsonrpc: "2.0", id, error: { code: -32000, message } });
            const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

            function newSession(agent) {
              const id = "s" + (++nextId);
              const s = { id, agent, title: "Nouvelle conversation", messages: [], interrupted: false, permission: null, answers: null };
              sessions.set(id, s);
              return s;
            }

            async function runTour(s, text, opts) {
              const assistantId = "a" + (++nextId);
              s.messages.push({ type: "user", id: "u" + (++nextId), text });
              push("session.execution.started", { sessionID: s.id });
              let draft = "";
              for (const part of opts.parts) {
                if (s.interrupted) break;
                draft += part;
                push("session.text.delta", { sessionID: s.id, assistantMessageID: assistantId, delta: part });
                await sleep(opts.delay);
              }
              const content = [{ type: "text", text: draft }];
              if (opts.tool) content.push({ type: "tool", id: "t1", name: opts.tool.name, state: { status: "completed", output: opts.tool.output } });
              if (opts.extraText) content.push({ type: "text", text: opts.extraText });
              s.messages.push({ type: "assistant", id: assistantId, agent: s.agent, model: { providerID: "free", id: "big-pickle" }, content });
              push(s.interrupted ? "session.execution.interrupted" : "session.execution.succeeded", { sessionID: s.id });
            }

            rl.on("line", (line) => {
              if (!line.trim()) return;
              const msg = JSON.parse(line);
              if (msg.id === undefined) return;
              const id = msg.id;
              const m = msg.method;
              const p = msg.params ?? {};
              const route = async () => {
                if (m === "ping") return { protocol: 1, alive: true };
                if (m === "router.pick") return "free/big-pickle";
                if (m === "router.chainFor") return [{ ref: "free/big-pickle", label: "Big Pickle" }];
                if (m === "router.beforeSend") return { ok: true };
                if (m === "session.create") {
                  const s = newSession(p.agent);
                  return { id: s.id, title: s.title, agent: s.agent, model: { providerID: "free", id: "big-pickle" } };
                }
                if (m === "session.get") {
                  const s = sessions.get(p.sessionID);
                  if (!s) throw new Error("session inconnue");
                  return { id: s.id, title: s.title, agent: s.agent, model: { providerID: "free", id: "big-pickle" } };
                }
                if (m === "session.update") { const s = sessions.get(p.sessionID); if (s) s.title = p.title; return { ok: true }; }
                if (m === "session.list") {
                  if (!sessions.has("sous1")) {
                    sessions.set("sous1", { id: "sous1", agent: "code", parentID: "s1", title: "sous-agent", messages: [{ type: "assistant", id: "ac1", agent: "code", model: { providerID: "free", id: "big-pickle" }, content: [{ type: "text", text: "analyse du sous-agent" }] }], interrupted: false });
                  }
                  const all = [...sessions.values()].map((s) => ({ id: s.id, title: s.title, agent: s.agent, parentID: s.parentID, model: { providerID: "free", id: "big-pickle" }, time: { updated: 1 } }));
                  return { data: all };
                }
                if (m === "message.list") {
                  const s = sessions.get(p.sessionID);
                  return { data: s ? s.messages : [] };
                }
                if (m === "session.prompt") {
                  const s = sessions.get(p.sessionID);
                  if (!s) throw new Error("session inconnue");
                  const text = String(p.text ?? "");
                  if (text.includes("boucle-infinie")) {
                    void (async () => {
                      const assistantId = "a" + (++nextId);
                      s.messages.push({ type: "user", id: "u" + (++nextId), text });
                      push("session.execution.started", { sessionID: s.id });
                      let draft = "";
                      const max = Date.now() + 10000;
                      while (!s.interrupted && Date.now() < max) {
                        draft += "x";
                        push("session.text.delta", { sessionID: s.id, assistantMessageID: assistantId, delta: "x" });
                        await sleep(30);
                      }
                      s.messages.push({ type: "assistant", id: assistantId, agent: s.agent, model: { providerID: "free", id: "big-pickle" }, content: [{ type: "text", text: draft }] });
                      push(s.interrupted ? "session.execution.interrupted" : "session.execution.succeeded", { sessionID: s.id });
                    })();
                    return { backend: "opencode" };
                  }
                  if (text.includes("lire le fichier")) {
                    void (async () => {
                      push("permission.asked", { sessionID: s.id, id: "p1", action: "read", resources: ["src/main.ts"], message: "Autoriser la lecture ?" });
                      const debut = Date.now();
                      while (!s.permission && Date.now() - debut < 15000) await sleep(20);
                      push("permission.replied", { sessionID: s.id, requestID: "p1" });
                      await runTour(s, text, { parts: ["Lecture ", "ok"], delay: 5, tool: { name: "read", output: "contenu du fichier" } });
                    })();
                    return { backend: "opencode" };
                  }
                  if (text.includes("demande-moi")) {
                    void (async () => {
                      push("form.created", { sessionID: s.id, form: { id: "f1", title: "Ta couleur ?", fields: [] } });
                      const debut = Date.now();
                      while (!s.answers && Date.now() - debut < 15000) await sleep(20);
                      push("form.replied", { sessionID: s.id, id: "f1" });
                      await runTour(s, text, { parts: ["Merci !"], delay: 5, extraText: "reponse: " + JSON.stringify(s.answers) });
                    })();
                    return { backend: "opencode" };
                  }
                  void runTour(s, text, { parts: ["B", "o", "n", "j", "o", "u", "r"], delay: 5 });
                  return { backend: "opencode" };
                }
                if (m === "session.interrupt") { const s = sessions.get(p.sessionID); if (s) s.interrupted = true; return { ok: true }; }
                if (m === "permission.reply") { const s = sessions.get(p.sessionID); if (s) s.permission = p.decision; return { ok: true }; }
                if (m === "session.form.reply") { const s = sessions.get(p.sessionID); if (s) s.answers = p.answer; return { ok: true }; }
                if (m === "session.form.cancel") return { ok: true };
                throw new Error("méthode inconnue : " + m);
              };
              route().then((result) => ok(id, result)).catch((err) => fail(id, err instanceof Error ? err.message : String(err)));
            });
            """);
    }

    public void Dispose()
    {
        try { File.Delete(_double); } catch { /* temp dir nettoyé par l'OS */ }
    }

    private static async Task Attendre(ConversationClient client, Func<ConversationLive, bool> condition)
    {
        var horloge = Stopwatch.StartNew();
        while (!condition(client.Live))
        {
            if (horloge.Elapsed > Délai)
            {
                var l = client.Live;
                throw new TimeoutException(
                    $"condition de stream non remplie dans le délai — busy={l.Busy} order={l.Order.Count} " +
                    $"asks={l.Asks.Count} forms={l.Forms.Count} error={l.Error}");
            }
            await Task.Delay(40);
        }
    }

    [Fact]
    public async Task Conversation_complète_multi_tours_permission_question_et_transcripts()
    {
        await using var engine = new EngineClient(_double, nodeExecPath: "node");
        var client = new ConversationClient(engine);
        client.Subscribe("s1");
        using var annulé = new CancellationTokenSource(Délai);

        // Chaîne de modèles (sélecteur de l'interface).
        var chain = await client.ChainForAsync("projet", annulé.Token);
        Assert.Equal("free/big-pickle", chain!.AsArray()[0]!["ref"]!.GetValue<string>());

        // 1. Création : modèle épinglé par le routeur (parité createChat).
        var chat = await client.CreateChatAsync("projet", @"C:\ws\demo", annulé.Token);
        Assert.Equal("s1", chat.Id);
        Assert.Equal("Nouvelle conversation", chat.Title);
        Assert.Equal("projet", chat.Agent);
        Assert.Equal("free/big-pickle", chat.Model);

        // 2. Premier tour : streaming incrémental « Bonjour ».
        await client.SendAsync(chat.Id, "Bonjour agent", annulé.Token);
        await Attendre(client, live => !live.Busy && live.Order.Count == 1);
        var finale = client.Live;
        Assert.Equal("Bonjour", finale.Texts[finale.Order[0]].Text);
        Assert.False(finale.Texts[finale.Order[0]].Child);
        Assert.Null(finale.Error);

        // Titre automatique au premier message (parité operations.send).
        var info = await engine.CallAsync("session.get", new { sessionID = chat.Id }, annulé.Token);
        Assert.Equal("Bonjour agent", info!["title"]!.GetValue<string>());

        // Transcript principal + sous-agent rattaché (parité messages).
        var messages = await client.MessagesAsync(chat.Id, @"C:\ws\demo", annulé.Token);
        Assert.Contains(messages, m => m.Role == "user" && m.Text == "Bonjour agent");
        var assistant = Assert.Single(messages.Where(m => m.Role == "assistant" && !m.Child));
        Assert.Equal("Bonjour", assistant.Text);
        Assert.Equal("free/big-pickle", assistant.Model);
        Assert.Contains(messages, m => m.Child && m.Agent == "code" && m.Text == "analyse du sous-agent");

        // 3. L'agent demande une AUTORISATION : le client répond, le tour se termine.
        await client.SendAsync(chat.Id, "lire le fichier", annulé.Token);
        await Attendre(client, live => live.Asks.Count == 1);
        Assert.Equal("read", client.Live.Asks[0].Action);
        Assert.Equal(new[] { "src/main.ts" }, client.Live.Asks[0].Resources);
        await client.ReplyPermissionAsync(chat.Id, client.Live.Asks[0].Id, "once", annulé.Token);
        await Attendre(client, live => !live.Busy && live.Asks.Count == 0 && live.Order.Count == 2);

        // 4. L'agent pose une QUESTION (outil question) : form.reply, puis fin du tour.
        await client.SendAsync(chat.Id, "demande-moi", annulé.Token);
        await Attendre(client, live => live.Forms.Count == 1);
        await client.ReplyFormAsync(chat.Id, client.Live.Forms[0].Id, new { couleur = "bleu" }, annulé.Token);
        await Attendre(client, live => !live.Busy && live.Forms.Count == 0 && live.Order.Count == 3);

        // Transcript final : outil read complété + réponse à la question + 3 tours.
        var final = await client.MessagesAsync(chat.Id, @"C:\ws\demo", annulé.Token);
        var avecOutil = Assert.Single(final.Where(m => m.Tools is { Count: > 0 }));
        Assert.Equal("read", avecOutil.Tools![0].Name);
        Assert.Equal("completed", avecOutil.Tools[0].Status);
        Assert.Equal("contenu du fichier", avecOutil.Tools[0].Output);
        Assert.Contains(final, m => m.Text.Contains("couleur"));
        Assert.Equal(3, final.Count(m => m.Role == "assistant" && !m.Child));
        Assert.Equal(3, final.Count(m => m.Role == "user"));
    }

    [Fact]
    public async Task Arrêt_en_plein_tour_coupe_le_stream_et_libère_busy()
    {
        await using var engine = new EngineClient(_double, nodeExecPath: "node");
        var client = new ConversationClient(engine);
        client.Subscribe("s1");
        using var annulé = new CancellationTokenSource(Délai);

        var chat = await client.CreateChatAsync("projet", @"C:\ws\demo", annulé.Token);

        // Tour « boucle-infinie » : des deltas « x » toutes les 30 ms jusqu'à l'interruption.
        await client.SendAsync(chat.Id, "boucle-infinie", annulé.Token);
        await Attendre(client, live => live.Busy);

        // Échap (Arrêter) : le tour se coupe NET (pas d'erreur, plus de busy).
        await client.InterruptAsync(chat.Id, annulé.Token);
        await Attendre(client, live => !live.Busy);

        var texte = client.Live.Texts[client.Live.Order[0]].Text;
        Assert.True(texte.Length >= 1, "au moins un delta reçu avant l'arrêt");
        Assert.True(texte.All(c => c == 'x'), "le stream est coupé, pas de texte parasite");
        Assert.Null(client.Live.Error);

        // Le transcript persiste exactement le texte live (cohérence stream ↔ historique).
        var final = await client.MessagesAsync(chat.Id, @"C:\ws\demo", annulé.Token);
        Assert.Contains(final, m => m.Role == "assistant" && m.Text == texte);
    }
}
