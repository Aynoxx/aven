// Micro-host PTY (phase 5, pilier Terminal) : pont ConPTY pour le client WinUI natif.
// Utilise le MÊME @lydell/node-pty prébuildé que l'app Electron (zéro divergence TUI).
// Protocole stdio : lignes JSON -> {type:"data"|"exit"|"ready"|"error", ...}
// Entrées : {type:"start",cwd,cols,rows} | {type:"write",data} | {type:"resize",cols,rows} | {type:"kill"}
// Ce module ne dépend PAS d'Electron, comme freebuff-pty.ts.
import path from "node:path"
import { createInterface } from "node:readline"
import { fileURLToPath, pathToFileURL } from "node:url"

type PtyProcess = {
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  kill: () => void
  pid: number
  onData: (cb: (chunk: string) => void) => void
  onExit: (cb: (ev: { exitCode: number; signal?: number }) => void) => void
}
type PtyModule = { spawn: (file: string, args: string[], opts: { cwd: string; cols: number; rows: number; env: Record<string, string> }) => PtyProcess }

let pty: PtyProcess | null = null

const send = (msg: Record<string, unknown>) => process.stdout.write(JSON.stringify(msg) + "\n")

async function loadPty(): Promise<PtyModule> {
  // Même logique que ptyModulePath de freebuff-pty.ts : en dev, <projet>/node_modules
  // (le host vit dans dist-electron, le parent est la racine du dépôt).
  const base = process.env.AVEN_PACKAGED
    ? path.join(process.resourcesPath ?? "", "app.asar.unpacked")
    // fileURLToPath (PAS URL.pathname : le /C:/ initial produirait C:\C:\…).
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const ptyIndex = path.join(base, "node_modules", "@lydell", "node-pty", "index.js")
  // Import dynamique : sous Windows, un chemin absolu doit devenir une URL file://.
  const mod = (await import(pathToFileURL(ptyIndex).href)) as unknown as PtyModule
  if (typeof mod?.spawn !== "function") throw new Error("Le module PTY prébuildé n'expose pas spawn().")
  return mod
}

async function start(cwd: string, cols: number, rows: number, opts: { trustAgents?: boolean; resume?: boolean } = {}) {
  if (pty) throw new Error("Une session PTY existe déjà.")
  const mod = await loadPty()
  // Parité buildPtyCommand (cmd /c freebuff --cwd …). AVEN_PTY_COMMAND (tests/diag)
  // fournit une commande VERBATIM : cmd /c <commande>, sans --cwd ajouté.
  const custom = process.env.AVEN_PTY_COMMAND
  const cmd = custom
    ? { file: "cmd.exe", args: ["/c", custom] }
    : (() => {
        // (Lot 3 natif) Pont agents v9.5.0 : --trust-agents lit le .agents/ généré
        // par Aven (mêmes agents, sans confirmation) et --continue reprend la
        // dernière conversation (préférence « Reprendre la dernière conversation »).
        const args = ["/c", "freebuff", "--cwd", cwd]
        if (opts.trustAgents) args.push("--trust-agents")
        if (opts.resume) args.push("--continue")
        return { file: "cmd.exe", args }
      })()
  pty = mod.spawn(cmd.file, cmd.args, { cwd, cols, rows, env: process.env as Record<string, string> })
  send({ type: "ready", pid: pty.pid })
  pty.onData((chunk) => send({ type: "data", chunk }))
  pty.onExit(({ exitCode, signal }) => {
    pty = null
    send({ type: "exit", code: exitCode, signal: typeof signal === "number" ? signal : undefined })
  })
}

const rl = createInterface({ input: process.stdin })
rl.on("line", (line: string) => {
  if (!line.trim()) return
  let msg: any
  try { msg = JSON.parse(line) } catch { send({ type: "error", message: "Ligne JSON illisible." }); return }
  try {
    switch (msg.type) {
      case "start": start(String(msg.cwd ?? ""), Number(msg.cols ?? 120), Number(msg.rows ?? 30), { trustAgents: msg.trustAgents === true, resume: msg.resume === true }).catch((err: unknown) => send({ type: "error", message: err instanceof Error ? err.message : String(err) })); break
      case "write": { const d = String(msg.data ?? ""); if (d) pty?.write(d); break }
      case "resize": try { pty?.resize(Number(msg.cols), Number(msg.rows)) } catch { /* mort en cours */ } break
      case "kill": try { pty?.kill() } catch { /* déjà mort */ } break
      default: send({ type: "error", message: `Type inconnu : ${msg.type}` })
    }
  } catch (err) { send({ type: "error", message: err instanceof Error ? err.message : String(err) }) }
})

process.on("disconnect", () => process.exit(0))
// Garde anti-orphelin : si le parent meurt brutalement (SIGKILL, crash), stdin se
// ferme sans « disconnect » — le host et son ConPTY doivent s'arrêter avec lui.
rl.on("close", () => process.exit(0))
