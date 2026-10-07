// Runtime applicatif Aven, indépendant d'Electron.
// Phase Tauri : le host concentre les opérations qui parlent à OpenCode.
// Les fonctions Windows (fenêtre, tray, dialogs, notifications) restent dans Tauri.
// Le protocole reste JSON-RPC 2.0 ligne par ligne, comme aven-engine-host.mjs.

import { EngineClient, sdkProxy, type EngineEvent } from "./engine-client.js"
import { makeOps, type BridgeHost } from "./operations.js"
import type { Bridge } from "./opencode-bridge.js"
import { loadNames } from "./agent-names.js"
import { listArchived } from "./archive.js"
import { resolveOpenCodeBin } from "./opencode-bridge.js"
import { PROVIDERS } from "./providers.js"
import { seedWorkspace } from "./workspace-seed.js"
import { buildAgentsDir, readTemplateAgents } from "./agents-bridge.js"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createInterface } from "node:readline"

type RpcMessage = { jsonrpc: "2.0"; id?: string | number; method?: string; params?: any }

type AppState = {
  status: "starting" | "ready" | "error"
  error?: string
  needsWorkspace?: boolean
  keys: Record<string, boolean>
  keyWarnings?: Record<string, string>
  providers: { id: string; label: string; url: string; note: string }[]
  version?: string
  cli?: string
  workspace?: string
  assignments?: Record<string, { ref: string; label: string }[]>
  warning?: string
  versionWarning?: string
  updatesConfigured: boolean
}

const providers = PROVIDERS.map(({ id, label, url, note }) => ({ id, label, url, note }))

let workspace = ""
let templateDir = ""
let engine: EngineClient | null = null
let engineState: Record<string, unknown> = {}
let engineChains: Record<string, { ref: string; label: string }[]> = {}
let ops: ReturnType<typeof makeOps> | null = null

let appState: AppState = {
  status: "starting",
  keys: Object.fromEntries(PROVIDERS.map((p) => [p.id, false])),
  providers,
  needsWorkspace: true,
  updatesConfigured: false,
}

const send = (message: Record<string, unknown>) => process.stdout.write(JSON.stringify(message) + "\n")
const push = (event: EngineEvent) => send({ jsonrpc: "2.0", method: "app.event", params: event })

function requireReady() {
  if (!ops) throw new Error("Le runtime Aven n'est pas prêt.")
  return ops
}

async function shutdown() {
  await engine?.stop()
  engine = null
  ops = null
  engineState = {}
  engineChains = {}
}

async function initialize(params: {
  workspace: string
  templateDir: string
  env?: Record<string, string>
  openRouterUsable?: boolean
  keyWarnings?: Record<string, string>
  binPath?: string
  binShell?: boolean
}) {
  const nextWorkspace = join(String(params?.workspace || ""))
  if (!nextWorkspace) throw new Error("workspace requis")
  workspace = nextWorkspace
  templateDir = join(String(params?.templateDir || process.cwd()))

  await shutdown()

  seedWorkspace(workspace, templateDir)
  try {
    buildAgentsDir(
      workspace,
      readTemplateAgents(templateDir),
      join(templateDir, "aven-mcp-server.mjs"),
    )
  } catch {
    // Le pont agents est best effort comme dans l'implémentation Electron.
  }

  const bin = params.binPath
    ? { command: String(params.binPath), shell: Boolean(params.binShell), source: "Tauri resource" }
    : resolveOpenCodeBin()
  const runtimeDir = dirname(fileURLToPath(import.meta.url))
  engine = new EngineClient({
    hostPath: join(runtimeDir, "aven-engine-host.mjs"),
    runAsNode: false,
    nodeExecPath: process.execPath,
    cwd: workspace,
    onEvent: push,
    onHostError: (err) => push({ type: "engine.host.error", data: { message: err.message } }),
    onHostExit: (code) => push({ type: "engine.host.exit", data: { code } }),
  })

  engineState = await engine.call("initialize", {
    workspace,
    env: params.env ?? {},
    prioritiesPath: join(workspace, "model-priorities.json"),
    templatePrioritiesPath: join(templateDir, "model-priorities.json"),
    excludeProvider: params.openRouterUsable === false ? "openrouter" : undefined,
    binPath: bin.command,
    binShell: bin.shell,
  })

  engineChains = (engineState.assignments ?? {}) as typeof engineChains

  const sdk = sdkProxy(() => engine!) as unknown as Bridge["client"]
  const engineBridge = {
    client: sdk,
    get workspace() {
      return workspace
    },
    loadNames: (ws: string) => loadNames(ws),
    archived: (ws: string) => listArchived(ws),
    get chains() {
      return engineChains
    },
    get router() {
      return {
        pick: (agent: string) => engineChains[agent]?.[0]?.ref,
        beforeSend: async (sessionID: string, text: string) => {
          await engine!.call("router.beforeSend", { sessionID, text })
        },
        forget: (sessionID: string) => {
          void engine!.call("router.forget", { sessionID }).catch(() => undefined)
        },
      }
    },
  } as unknown as BridgeHost

  ops = makeOps(() => engineBridge)
  appState = {
    status: "ready",
    keys: Object.fromEntries(
      PROVIDERS.map((p) => [p.id, !!params.env?.[p.env]]),
    ),
    providers,
    workspace,
    assignments: engineState.assignments as AppState["assignments"],
    version: String(engineState.version ?? ""),
    cli: String(engineState.binSource ?? ""),
    warning: engineState.warning as string | undefined,
    versionWarning: engineState.versionWarning as string | undefined,
    updatesConfigured: false,
    keyWarnings: params.keyWarnings,
  }

  return appState
}

async function dispatch(method: string, params: unknown): Promise<unknown> {
  switch (method) {
    case "ping":
      return { alive: true, initialized: !!ops }
    case "state":
      return appState
    case "initialize":
      return initialize(params as Parameters<typeof initialize>[0])
    case "shutdown":
      await shutdown()
      appState = {
        status: "starting",
        keys: Object.fromEntries(PROVIDERS.map((p) => [p.id, false])),
        providers,
        needsWorkspace: true,
        updatesConfigured: false,
      }
      return { stopped: true }
    case "workspace:seed": {
      const p = params as { workspace?: string; templateDir?: string }
      if (!p?.workspace || !p?.templateDir) throw new Error("workspace et templateDir requis")
      return seedWorkspace(join(p.workspace), join(p.templateDir))
    }
    case "agents:bridge": {
      const p = params as { workspace?: string; templateDir?: string }
      if (!p?.workspace || !p?.templateDir) throw new Error("workspace et templateDir requis")
      return {
        written: buildAgentsDir(
          join(p.workspace),
          readTemplateAgents(join(p.templateDir)),
          join(join(p.templateDir), "aven-mcp-server.mjs"),
        ),
      }
    }
  }

  const api = requireReady() as any
  switch (method) {
    case "agents":
      return api.agents()
    case "chats":
      return api.chats(params?.[0] as string | undefined, Boolean(params?.[1]))
    case "createChat":
      return api.createChat(String(params?.[0] ?? ""))
    case "renameChat":
      return api.renameChat(String(params?.[0] ?? ""), String(params?.[1] ?? ""))
    case "deleteChat":
      return api.deleteChat(String(params?.[0] ?? ""))
    case "archiveChat":
      return api.archiveChat(String(params?.[0] ?? ""), Boolean(params?.[1]))
    case "setChatModel":
      return api.setChatModel(String(params?.[0] ?? ""), params?.[1] === undefined ? undefined : String(params[1]))
    case "modelChain":
      return api.chainFor(String(params?.[0] ?? ""))
    case "messages":
      return api.messages(String(params?.[0] ?? ""))
    case "send":
      return api.send(String(params?.[0] ?? ""), String(params?.[1] ?? ""))
    case "interrupt":
      return api.interrupt(String(params?.[0] ?? ""))
    case "reply":
      return api.reply(String(params?.[0] ?? ""), String(params?.[1] ?? ""), params?.[2])
    case "replyForm":
      return api.formReply(String(params?.[0] ?? ""), String(params?.[1] ?? ""), params?.[2] ?? {})
    case "cancelForm":
      return api.formCancel(String(params?.[0] ?? ""), String(params?.[1] ?? ""))
    case "exportChat":
      return api.exportMarkdown(String(params?.[0] ?? ""))
    default:
      throw new Error(`Méthode runtime inconnue : ${method}`)
  }
}

export async function serve() {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
  rl.on("close", () => void shutdown())

  for await (const line of rl) {
    if (!line.trim()) continue

    let request: RpcMessage
    try {
      request = JSON.parse(line)
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON invalide" } })
      continue
    }

    if (typeof request.method !== "string") continue

    try {
      const result = await dispatch(request.method, request.params)
      if (request.id !== undefined) send({ jsonrpc: "2.0", id: request.id, result: result ?? null })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (request.id !== undefined) {
        send({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message } })
      }
    }
  }
}

if (process.argv[1] && /aven-app-host\.(mjs|js)$/.test(process.argv[1].replace(/\\/g, "/"))) {
  serve().catch((err) => {
    process.stderr.write(`[aven-app-host] fatal: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  })
}
