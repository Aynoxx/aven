// v9.8.0 — HOST DU MOTEUR.
// Extrait de l'ancien main Electron : ce process autonome
// démarre le serveur OpenCode (via le SDK), tient le routeur de modèles,
// relaie les événements en push, et parle JSON-RPC 2.0 (une ligne = un message)
// sur stdio. Consommé par le host applicatif (engine-client.ts, depuis
// aven-app-host.ts) — un seul moteur pour toute l'app.
// Aucune dépendance Tauri/Electron : testable sous Node pur.
import { startOpenCode, relayEvents, EXPECTED_VERSION, type AppEvent, type Bridge } from "./opencode-bridge.js"
import { Router } from "./router.js"
import { addDiscoveredFreeModels, loadTable, type Task } from "./priorities.js"
// v10.0.0 : le seed d'espace et le pont d'agents vivent DANS le host moteur —
// appelés depuis le host applicatif (aven-app-host.ts) : une seule implémentation.
import { seedWorkspace } from "./workspace-seed.js"
import { buildAgentsDir, readTemplateAgents } from "./agents-bridge.js"
import { join } from "node:path"
import { createInterface } from "node:readline"

export const HOST_PROTOCOL = 1

// ── Options d'initialize (mêmes entrées que bootImpl de main.ts) ──────────────
export type HostInitializeParams = {
  workspace: string
  env?: Record<string, string> // clés API (variables d'environnement du serveur OpenCode)
  prioritiesPath?: string // model-priorities.json de l'espace (optionnel)
  templatePrioritiesPath?: string // copie de secours fournie par l'app (optionnel)
  excludeProvider?: string // fournisseur désactivé pour ce boot (ex. openrouter à clé invalide)
  // Binaire OpenCode résolu par le client (l'app) : en packagé, le host (Node pur)
  // ne peut pas le retrouver via require.resolve (resources/ hors node_modules).
  binPath?: string
  binShell?: boolean
}

// ── État global du host ───────────────────────────────────────────────────────
type HostState = {
  bridge: Bridge | null
  router: Router | null
  events: AbortController | null
}
const state: HostState = { bridge: null, router: null, events: null }

// ── Journalisation sur stderr uniquement (stdout = protocole) ─────────────────
function log(message: string) {
  process.stderr.write(`[engine-host] ${message}\n`)
}

// ── La logique boot de main.ts, déplacée telle quelle ─────────────────────────
export async function initialize(params: HostInitializeParams): Promise<Record<string, unknown>> {
  if (!params?.workspace) throw new Error("workspace requis")
  await shutdown()
  const bin = params.binPath
    ? { command: params.binPath, shell: params.binShell === true, source: "fourni par l'application" }
    : undefined
  const bridge = await startOpenCode({ workspace: params.workspace, env: params.env ?? {}, bin })
  state.bridge = bridge

  const { data } = await bridge.client.model.list({ location: { directory: params.workspace } })
  const activeProviders = new Set<string>()
  const available = new Set(
    data
      .filter((m) => {
        const model = m as typeof m & { enabled?: boolean; disabled?: boolean; status?: string }
        if (params.excludeProvider && model.providerID === params.excludeProvider) return false
        if (model.enabled !== false && model.disabled !== true && model.status !== "deprecated") activeProviders.add(model.providerID)
        return model.enabled !== false && model.disabled !== true && model.status !== "deprecated"
      })
      .map((m) => `${m.providerID}/${m.modelID}`),
  )
  const tablePath = params.prioritiesPath ?? join(params.workspace, "model-priorities.json")
  const loaded = loadTable(tablePath, params.templatePrioritiesPath ?? tablePath)
  const discovered = data
    .map((m) => {
      const model = m as typeof m & { name?: string }
      return { ref: `${model.providerID}/${model.modelID}`, label: model.name }
    })
    .filter((m) => available.has(m.ref))
  const catalog = addDiscoveredFreeModels(loaded.table, discovered)

  const notify = (sessionID: string, model: string, text: string) =>
    // Notification de routage = événement push, comme le faisait main.ts.
    push({ type: "router.notice", data: { sessionID, model, text } })
  const router = new Router({ client: bridge.client, table: catalog.table, notify }, available)
  state.router = router

  // Réparation des sessions héritées (ex-main.ts : repairLegacySessions) — best effort.
  void repairLegacySessions(router, bridge.client, params.workspace).catch((err) =>
    log(`réparation sessions : ${err instanceof Error ? err.message : String(err)}`),
  )

  // Boucle d'événements : le host est l'UNIQUE consommateur du moteur. Il nourrit
  // d'abord son routeur (failover, compteurs de requêtes), puis pousse à son client.
  state.events = new AbortController()
  void relayEvents(
    bridge.client,
    (ev: AppEvent) => {
      router.onEvent(ev)
      push(ev)
    },
    state.events.signal,
  )

  return {
    version: bridge.version,
    binSource: bridge.binSource,
    workspace: params.workspace,
    assignments: router.assignments(),
    warning: loaded.warning,
    activeProviders: [...activeProviders],
    noFreeModels: Object.values(router.chains).every((chain) => chain.length === 0),
    // Un écart de version est signalé au client (main.ts l'affichait déjà).
    versionWarning:
      bridge.version !== EXPECTED_VERSION
        ? `OpenCode ${bridge.version} ≠ version attendue ${EXPECTED_VERSION} : mets à jour les paquets @opencode/client ET @opencode/cli à la même version.`
        : undefined,
  }
}

async function repairLegacySessions(router: Router, client: Bridge["client"], workspaceDir: string) {
  try {
    const page = await client.session.list({ directory: workspaceDir, order: "desc", limit: 50 })
    for (const s of page.data) {
      const ref = s.model ? `${s.model.providerID}/${s.model.id}` : undefined
      // Déjà aligné sur un modèle de la chaîne de l'agent : rien à faire.
      if (!ref || router.assignments()[String(s.agent)]?.some((m) => m.ref === ref)) continue
      const want = router.pick(String(s.agent) as Parameters<Router["pick"]>[0])
      if (want && want !== ref) {
        await client.session
          .switchModel({ sessionID: s.id, model: { providerID: want.split("/")[0], id: want.slice(want.indexOf("/") + 1) } })
          .catch(() => undefined)
      }
    }
  } catch (err) {
    log(`réparation des sessions héritées impossible : ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function shutdown(): Promise<void> {
  state.events?.abort()
  state.events = null
  state.router = null
  const b = state.bridge
  state.bridge = null
  await b?.stop()
}

// ── Serveur JSON-RPC 2.0 (une ligne = un message) sur stdio ───────────────────
type JsonRpcMessage = { jsonrpc: "2.0"; id?: string | number; method?: string; params?: unknown }

const writer = process.stdout
function send(message: Record<string, unknown>) {
  writer.write(JSON.stringify(message) + "\n")
}
function push(ev: { type: string; data: Record<string, unknown> }) {
  send({ jsonrpc: "2.0", method: "engine.event", params: ev })
}

// Le host applicatif consomme le même catalogue que le renderer.
const routerMethods = {
  "router.assignments": () => state.router?.assignments() ?? {},
  "router.pick": (p: { agent: string }) => state.router?.pick(p.agent as Task),
  "router.chainFor": (p: { agent: string }) =>
    (state.router?.chains[p.agent as Task] ?? []).map((c) => ({ ref: c.ref, label: c.label })),
  "router.forget": (p: { sessionID: string }) => state.router?.forget(p.sessionID),
  "router.beforeSend": async (p: { sessionID: string; text: string }) => {
    await state.router?.beforeSend(p.sessionID, p.text)
    return { ok: true }
  },
}

const serverMethods: Record<string, (params: any) => Promise<unknown> | unknown> = {
  initialize,
  ping: () => ({ protocol: HOST_PROTOCOL, alive: !!state.bridge }),
  shutdown: async () => {
    await shutdown()
    return { stopped: true }
  },
  // v10.0.0 : préparation d'un espace de travail AVANT initialize —
  // seed via workspace-seed.ts (ex-settings.ts), sans moteur.
  "workspace.seed": (p: { workspace?: string; templateDir?: string }) => {
    if (!p?.workspace || !p?.templateDir) throw new Error("workspace et templateDir requis")
    return seedWorkspace(p.workspace, p.templateDir)
  },
  // v10.0.0 : pont catalogue d'agents (.agents/ + mcp.json des notes)
  // — best effort côté client, depuis l'origine.
  "agents.bridge": (p: { workspace?: string; templateDir?: string }) => {
    if (!p?.workspace || !p?.templateDir) throw new Error("workspace et templateDir requis")
    return {
      written: buildAgentsDir(
        p.workspace,
        readTemplateAgents(p.templateDir),
        join(p.templateDir, "aven-mcp-server.mjs"),
      ),
    }
  },
  ...routerMethods,
  // Proxy générique vers le SDK : "session.list" → client.session.list(params).
  // Mêmes formes JSON que l'app actuelle : la parité est structurelle.
}

export async function dispatch(method: string, params: unknown): Promise<unknown> {
  if (method in serverMethods) return serverMethods[method](params as any)
  // Proxy SDK : ns.method, avec les sous-namespaces du SDK (session.form.reply…).
  const bridge = state.bridge
  if (!bridge) throw new Error("OpenCode n'est pas prêt.")
  const parts = method.split(".")
  let target: unknown = bridge.client
  for (const part of parts) {
    target = (target as Record<string, unknown>)?.[part]
    if (typeof target !== "object" && typeof target !== "function") throw new Error(`Méthode inconnue : ${method}`)
  }
  if (typeof target !== "function") throw new Error(`Méthode inconnue : ${method}`)
  return await (target as (p: unknown) => Promise<unknown>).call(undefined, params ?? {})
}

export async function serve(readable: NodeJS.ReadableStream = process.stdin, writable: NodeJS.WritableStream = process.stdout): Promise<void> {
  const rl = createInterface({ input: readable, crlfDelay: Infinity })
  // stdin fermé : le client est mort — le moteur ne doit pas survivre en orphelin.
  rl.on("close", () => void shutdown())
  for await (const line of rl) {
    if (!line.trim()) continue
    let message: JsonRpcMessage
    try {
      message = JSON.parse(line)
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON invalide" } })
      continue
    }
    if (typeof message.method !== "string") continue // réponse d'un client ? le host n'en attend pas
    const id = message.id
    try {
      const result = await dispatch(message.method, message.params)
      if (id !== undefined) send({ jsonrpc: "2.0", id, result: result ?? null })
    } catch (err) {
      const message_ = err instanceof Error ? err.message : String(err)
      if (id !== undefined) send({ jsonrpc: "2.0", id, error: { code: -32000, message: message_ } })
      else log(`notification d'erreur : ${message_}`)
    }
  }
}

// Point d'entrée : `node aven-engine-host.mjs` (pas de mode module importé).
if (process.argv[1] && /aven-engine-host\.(mjs|js)$/.test(process.argv[1].replace(/\\/g, "/"))) {
  log(`host démarré (protocole ${HOST_PROTOCOL})`)
  serve().catch((err) => {
    log(`fatal : ${err instanceof Error ? err.message : String(err)}`)
    process.exit(1)
  })
}
