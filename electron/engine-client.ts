// v9.8.0 — CLIENT du host du moteur (aven-engine-host.mjs).
// Spawn du host (Electron en mode ELECTRON_RUN_AS_NODE, ou node pur dans les
// tests), framing JSON-RPC ligne-par-ligne, routage des réponses par id,
// notifications en push. main.ts n'importe plus jamais le SDK directement :
// un seul client du moteur, structurellement (preuve de non-régression de la
// phase 1 du protocole MIGRATION-WINUI.md).
import { spawn, type ChildProcess } from "node:child_process"
import { createInterface } from "node:readline"

export type EngineEvent = { type: string; data: Record<string, unknown> }

export type EngineClientOptions = {
  hostPath: string // dist-electron/aven-engine-host.mjs
  nodeExecPath?: string // process.execPath (binaire Electron) par défaut
  runAsNode?: boolean // ELECTRON_RUN_AS_NODE=1 : le binaire Electron exécute du Node pur
  onEvent?: (ev: EngineEvent) => void
  onHostExit?: (code: number | null) => void
  onHostError?: (err: Error) => void
  cwd?: string
}

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void }

/** Client JSON-RPC du host — appels concurrents autorisés (routage par id). */
export class EngineClient {
  private child: ChildProcess | null = null
  private pending = new Map<string, Pending>()
  private nextId = 0
  private opts: EngineClientOptions

  constructor(opts: EngineClientOptions) {
    this.opts = opts
  }

  /** Démarre le process du host. Idempotent. */
  start(): void {
    if (this.child) return
    const env: NodeJS.ProcessEnv = { ...process.env }
    if (this.opts.runAsNode) env.ELECTRON_RUN_AS_NODE = "1"
    this.child = spawn(this.opts.nodeExecPath ?? process.execPath, [this.opts.hostPath], {
      stdio: ["pipe", "pipe", "pipe"],
      env,
      cwd: this.opts.cwd,
      windowsHide: true,
    })
    const rl = createInterface({ input: this.child.stdout!, crlfDelay: Infinity })
    rl.on("line", (line) => this.handleLine(line))
    // Les journaux du host vont sur stderr (stdout = protocole).
    this.child.stderr?.on("data", (d: Buffer) => process.stderr.write(`[engine] ${d}`))
    this.child.on("error", (err) => this.opts.onHostError?.(err))
    this.child.on("exit", (code) => {
      const pending = [...this.pending.values()]
      this.pending.clear()
      this.child = null
      for (const p of pending) p.reject(new Error("Host du moteur arrêté."))
      this.opts.onHostExit?.(code)
    })
  }

  private handleLine(line: string) {
    if (!line.trim()) return
    let message: { id?: string | number; method?: string; params?: unknown; error?: { message?: string } }
    try {
      message = JSON.parse(line)
    } catch {
      return // ligne corrompue : ignorée, le flux continue
    }
    if (message.method === "engine.event") {
      const ev = message.params as EngineEvent | undefined
      if (ev && typeof ev.type === "string") this.opts.onEvent?.(ev)
      return
    }
    if (message.id === undefined) return
    const p = this.pending.get(String(message.id))
    if (!p) return
    this.pending.delete(String(message.id))
    if (message.error) p.reject(new Error(message.error.message || "Erreur du moteur."))
    else p.resolve((message as { result?: unknown }).result)
  }

  /** Appel avec réponse. Rejette si le host est arrêté ou renvoie une erreur. */
  call<T = unknown>(method: string, params?: unknown): Promise<T> {
    this.start()
    const child = this.child!
    const id = ++this.nextId
    let rejectCall!: (e: Error) => void
    const promise = new Promise<T>((resolve, rej) => {
      rejectCall = rej
      this.pending.set(String(id), { resolve: resolve as (v: unknown) => void, reject: rej })
    })
    // stdin peut avoir mouru entre-temps : l'erreur rejette l'appel au lieu de planter le process.
    child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params: params ?? null }) + "\n", (err) => {
      if (err) {
        this.pending.delete(String(id))
        rejectCall(new Error(`Host du moteur injoignable : ${err.message}`))
      }
    })
    return promise
  }

  /** Arrête le host (le moteur meurt avec lui — un process, un moteur). */
  async stop(): Promise<void> {
    const child = this.child
    if (!child) return
    this.child = null
    this.pending.clear()
    await new Promise<void>((resolve) => {
      child.once("exit", () => resolve())
      child.kill()
      setTimeout(resolve, 2000)
    })
  }
}

/**
 * Proxy du SDK via le host : `sdk.session.list(params)` → appel JSON-RPC
 * "session.list". Les sous-namespaces (session.form.reply) s'accumulent en
 * chemin. Permet à operations.ts de garder SES types et SA logique tels quels
 * — seul le transport change (HTTP local → stdio du host).
 */
export function sdkProxy(engine: () => EngineClient, path: string[] = []): unknown {
  return new Proxy(function () {}, {
    get(_target, prop) {
      if (typeof prop !== "string" || prop === "then") return undefined // pas un thenable
      return sdkProxy(engine, [...path, prop])
    },
    apply(_target, _this, args) {
      return engine().call(path.join("."), args[0])
    },
  })
}
