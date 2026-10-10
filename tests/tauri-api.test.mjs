import assert from "node:assert/strict"
import { test } from "node:test"
import { createTauriApi, serialize } from "../web/src/api-tauri.ts"

// v10.0.0 : la fabrique Proxy de l'API Tauri est un module pur (dépendances injectées) :
// on vérifie ici le routage exact vers l'IPC Rust « aven_call », les flux dialog/export
// et le désabonnement des événements — sans webview ni paquet @tauri-apps.

function makeDeps(overrides = {}) {
  const calls = []
  const deps = {
    invoke: async (cmd, args) => {
      calls.push({ kind: "invoke", cmd, args })
      return overrides.invoke ? await overrides.invoke(cmd, args, calls) : null
    },
    listen: async (event, handler) => {
      calls.push({ kind: "listen", event, handler })
      if (overrides.listen) await overrides.listen(event, handler)
      return () => calls.push({ kind: "unlisten", event })
    },
    openDialog: async (options) => {
      calls.push({ kind: "openDialog", options })
      return overrides.openDialog ? await overrides.openDialog(options) : null
    },
    saveDialog: async (options) => {
      calls.push({ kind: "saveDialog", options })
      return overrides.saveDialog ? await overrides.saveDialog(options) : null
    },
  }
  return { deps, calls }
}

test("méthode inconnue : routage direct vers aven_call avec méthode et args sérialisés", async () => {
  const { deps, calls } = makeDeps({ invoke: async () => ({ ok: true }) })
  const api = createTauriApi(deps)

  const result = await api.someMethod("a", 1, { b: new Uint8Array([7, 8]) })

  assert.deepEqual(result, { ok: true })
  assert.equal(calls.length, 1)
  assert.equal(calls[0].cmd, "aven_call")
  assert.deepEqual(calls[0].args, {
    method: "someMethod",
    args: ["a", 1, { b: [7, 8] }],
  })
})

test("addExistingWorkspace : dialogue annulé → null, aucun appel RPC", async () => {
  const { deps, calls } = makeDeps()
  const api = createTauriApi(deps)

  assert.equal(await api.addExistingWorkspace(), null)
  assert.equal(calls.filter((c) => c.kind === "invoke").length, 0)
  assert.equal(calls[0].kind, "openDialog")
  assert.deepEqual(calls[0].options, { directory: true, multiple: false })
})

test("createWorkspace : dialogue choisi → workspace:add avec chemin et nom", async () => {
  const { deps, calls } = makeDeps({
    openDialog: async () => "C:/dev/projet-x",
    invoke: async () => ({ entry: {} }),
  })
  const api = createTauriApi(deps)

  await api.createWorkspace("Projet X")

  const rpc = calls.find((c) => c.kind === "invoke")
  assert.deepEqual(rpc.args, { method: "workspace:add", args: ["C:/dev/projet-x", "Projet X"] })
})

test("exportChat : export → dialogue d'enregistrement → écriture du markdown", async () => {
  const { deps, calls } = makeDeps({
    invoke: async (cmd, args) => {
      if (args?.method === "exportChat") return { title: "Ma conversation", markdown: "# Salut" }
      if (args?.method === "writeTextFile") return args.args[0]
      return null
    },
    saveDialog: async () => "C:/exports/ma-conversation.md",
  })
  const api = createTauriApi(deps)

  const written = await api.exportChat("abc")

  assert.equal(written, "C:/exports/ma-conversation.md")
  const order = calls.map((c) => (c.kind === "invoke" ? c.args.method : c.kind))
  assert.deepEqual(order, ["exportChat", "saveDialog", "writeTextFile"])
  const save = calls.find((c) => c.kind === "saveDialog")
  assert.equal(save.options.defaultPath, "Ma conversation.md")
  assert.deepEqual(save.options.filters, [{ name: "Markdown", extensions: ["md"] }])
  const write = calls.filter((c) => c.kind === "invoke")[1]
  assert.deepEqual(write.args.args, ["C:/exports/ma-conversation.md", "# Salut"])
})

test("exportChat : titre invalide pour un fichier → caractères interdits remplacés", async () => {
  const { deps, calls } = makeDeps({
    invoke: async (cmd, args) => (args?.method === "exportChat" ? { title: 'a/b:c*d?e"f<g>h|i', markdown: "x" } : null),
    saveDialog: async () => "C:/out.md",
  })
  const api = createTauriApi(deps)

  await api.exportChat("1")

  const save = calls.find((c) => c.kind === "saveDialog")
  assert.equal(save.options.defaultPath, "a_b_c_d_e_f_g_h_i.md")
})

test("exportChat : dialogue annulé → null, aucune écriture", async () => {
  const { deps, calls } = makeDeps({
    invoke: async (cmd, args) => (args?.method === "exportChat" ? { title: "t", markdown: "m" } : null),
    saveDialog: async () => null,
  })
  const api = createTauriApi(deps)

  assert.equal(await api.exportChat("1"), null)
  const methods = calls.filter((c) => c.kind === "invoke").map((c) => c.args.method)
  assert.ok(!methods.includes("writeTextFile"))
})

test("noteExport : noteGet → saveDialog → writeTextFile", async () => {
  const { deps, calls } = makeDeps({
    invoke: async (cmd, args) => {
      if (args?.method === "noteGet") return { title: "Ma note", markdown: "# Note" }
      if (args?.method === "writeTextFile") return "ok"
      return null
    },
    saveDialog: async () => "C:/notes/ma-note.md",
  })
  const api = createTauriApi(deps)

  assert.equal(await api.noteExport("n1"), "ok")
  const methods = calls.filter((c) => c.kind === "invoke").map((c) => c.args.method)
  assert.deepEqual(methods, ["noteGet", "writeTextFile"])
  const save = calls.find((c) => c.kind === "saveDialog")
  assert.equal(save.options.defaultPath, "Ma note.md")
})

test("filesOpen : résolution du chemin puis ouverture système", async () => {
  const { deps, calls } = makeDeps({
    invoke: async (cmd, args) => {
      if (args?.method === "filesOpen") return "C:/dev/projet/fichier.ts"
      if (args?.method === "openPath") return args.args[0]
      return null
    },
  })
  const api = createTauriApi(deps)

  assert.equal(await api.filesOpen("fichier.ts"), "C:/dev/projet/fichier.ts")
  const invocations = calls.filter((c) => c.kind === "invoke")
  assert.deepEqual(invocations[0].args, { method: "filesOpen", args: ["fichier.ts"] })
  assert.deepEqual(invocations[1].args, { method: "openPath", args: ["C:/dev/projet/fichier.ts"] })
})

test("noteOpenFolder : noteOpenFolder puis openPath", async () => {
  const { deps, calls } = makeDeps({
    invoke: async (cmd, args) => {
      if (args?.method === "noteOpenFolder") return "C:/notes"
      if (args?.method === "openPath") return args.args[0]
      return null
    },
  })
  const api = createTauriApi(deps)

  assert.equal(await api.noteOpenFolder(), "C:/notes")
  const methods = calls.filter((c) => c.kind === "invoke").map((c) => c.args.method)
  assert.deepEqual(methods, ["noteOpenFolder", "openPath"])
})

test("onEvent : abonnement à aven:event, désabonnement à l'arrêt", async () => {
  const { deps, calls } = makeDeps()
  const api = createTauriApi(deps)

  const received = []
  const stop = api.onEvent((event) => received.push(event))

  assert.equal(calls[0].kind, "listen")
  assert.equal(calls[0].event, "aven:event")

  calls[0].handler({ payload: { type: "chat", data: {} } })
  assert.deepEqual(received, [{ type: "chat", data: {} }])

  stop()
  calls[0].handler({ payload: { type: "after", data: {} } })
  assert.equal(received.length, 1, "plus aucun événement après désabonnement")
  // L'abonnement se résout en microtask : on laisse tourner la boucle avant de compter.
  await new Promise((r) => setTimeout(r, 0))
  assert.equal(calls.filter((c) => c.kind === "unlisten").length, 1)
})

test("onEvent : arrêt avant résolution de l'abonnement → unlisten quand il arrive", async () => {
  let resolveListen
  const { deps, calls } = makeDeps({
    listen: () => new Promise((resolve) => { resolveListen = resolve }),
  })
  const api = createTauriApi(deps)

  const received = []
  const stop = api.onEvent((event) => received.push(event))
  stop()

  // L'abonnement résolu après l'arrêt doit être refermé immédiatement (course historique).
  resolveListen()
  await new Promise((r) => setTimeout(r, 0))

  calls[0].handler({ payload: { type: "late", data: {} } })
  assert.equal(received.length, 0)
  assert.equal(calls.filter((c) => c.kind === "unlisten").length, 1)
})

test("serialize : Uint8Array récursif en tableaux de nombres", () => {
  assert.deepEqual(serialize(new Uint8Array([1, 2])), [1, 2])
  assert.deepEqual(serialize([new Uint8Array([3])]), [[3]])
  assert.deepEqual(serialize({ a: { b: new Uint8Array([4]) } }), { a: { b: [4] } })
  assert.equal(serialize("texte"), "texte")
  assert.equal(serialize(null), null)
  assert.deepEqual(serialize({ z: 1, a: 2 }), { z: 1, a: 2 })
})


test("workspaces : lit le registre Rust workspace:list", async () => {
  const entries = [{ path: "C:/dev/projet", name: "Projet" }]
  const { deps, calls } = makeDeps({ invoke: async () => entries })
  const api = createTauriApi(deps)

  assert.deepEqual(await api.workspaces(), entries)
  assert.deepEqual(calls[0].args, { method: "workspace:list", args: [] })
})

test("switchWorkspace : utilise le nom RPC workspace:switch", async () => {
  const { deps, calls } = makeDeps({ invoke: async () => ({ status: "ready" }) })
  const api = createTauriApi(deps)

  await api.switchWorkspace("C:/dev/projet")
  assert.deepEqual(calls[0].args, {
    method: "workspace:switch",
    args: ["C:/dev/projet"],
  })
})

test("removeWorkspace : utilise le nom RPC workspace:remove", async () => {
  const remaining = [{ path: "C:/dev/autre", name: "Autre" }]
  const { deps, calls } = makeDeps({ invoke: async () => remaining })
  const api = createTauriApi(deps)

  assert.deepEqual(await api.removeWorkspace("C:/dev/projet"), remaining)
  assert.deepEqual(calls[0].args, {
    method: "workspace:remove",
    args: ["C:/dev/projet"],
  })
})
