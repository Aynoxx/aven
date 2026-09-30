using Aven.Bridge;
using Xunit;

namespace Aven.Tests;

/// <summary>
/// Double honnête STATEFUL du host (partagé par les tests E2E et ceux de la vue
/// chat) : un vrai process Node séparé, sessions en mémoire, tours asynchrones
/// avec deltas, interruption en plein stream, autorisation et question bloquantes.
/// Aucun court-circuit : le client C# subit le vrai timing du protocole.
/// </summary>
public sealed class HostDouble : IDisposable
{
    public string Path { get; }

    public HostDouble()
    {
        Path = System.IO.Path.Combine(System.IO.Path.GetTempPath(), $"aven-host-conv-{Guid.NewGuid():N}.mjs");
        File.WriteAllText(Path, """
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
        try { File.Delete(Path); } catch { /* temp dir nettoyé par l'OS */ }
    }
}

/// <summary>Attente d'une condition sur le Live avec diagnostic d'état dans l'exception.</summary>
public static class StreamAttente
{
    public static async Task AttendreAsync(Func<ConversationLive> courant, Func<ConversationLive, bool> condition, TimeSpan? délai = null)
    {
        var limite = délai ?? TimeSpan.FromSeconds(30);
        var horloge = System.Diagnostics.Stopwatch.StartNew();
        while (true)
        {
            var dernier = courant();
            if (condition(dernier)) return;
            if (horloge.Elapsed > limite)
                throw new TimeoutException(
                    $"condition de stream non remplie dans le délai — busy={dernier.Busy} order={dernier.Order.Count} " +
                    $"asks={dernier.Asks.Count} forms={dernier.Forms.Count} error={dernier.Error}");
            await Task.Delay(40);
        }
    }
}
