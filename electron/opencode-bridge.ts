import { spawn, execFile, type ChildProcess } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import net from "node:net"
import path from "node:path"
import { OpenCode } from "@opencode/client"

// Ce module ne dépend PAS d'Electron : on peut donc le tester avec Node seul.

export const EXPECTED_VERSION = "2.0.10"
// v9.0.0 : « projet » est l'agent principal orchestrateur (appelé en premier),
// il délègue aux agents spécialisés via l'outil subagent.
export const TABS = ["projet", "code", "recherche", "analyse"] as const

export type OpenCodeClient = ReturnType<typeof OpenCode.make>
export type AppEvent = { type: string; data: Record<string, unknown> }

export type Bridge = {
  client: OpenCodeClient
  workspace: string
  version: string
  binSource: string
  stop: () => Promise<void>
}

const require = createRequire(import.meta.url)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Cherche le CLI OpenCode, dans cet ordre :
 *  1. variable OPENCODE_BIN (chemin explicite)
 *  2. app packagée : resources/opencode-bin/opencode.exe (copié par electron-builder, voir extraResources)
 *  3. développement : node_modules/@opencode/cli/bin/opencode.exe (préparé par le postinstall du paquet)
 *  4. `opencode` sur le PATH (sous Windows : shim .cmd → il faut un shell)
 * Le fichier s'appelle toujours « opencode.exe », même hors Windows (c'est le nom déclaré par le paquet).
 */
export function resolveOpenCodeBin(): { command: string; shell: boolean; source: string } {
  const env = process.env.OPENCODE_BIN
  if (env) return { command: env, shell: process.platform === "win32" && !/\.exe$/i.test(env), source: "OPENCODE_BIN" }

  const resources = (process as unknown as { resourcesPath?: string }).resourcesPath // défini par Electron seulement
  const candidates: string[] = []
  if (resources) candidates.push(path.join(resources, "opencode-bin", "opencode.exe"))
  try {
    candidates.push(path.join(path.dirname(require.resolve("@opencode/cli/package.json")), "bin", "opencode.exe"))
  } catch {
    /* paquet absent */
  }
  for (const bin of candidates) if (existsSync(bin)) return { command: bin, shell: false, source: "embarqué" }

  return { command: "opencode", shell: process.platform === "win32", source: "PATH" }
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.once("error", reject)
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address() as net.AddressInfo
      srv.close(() => resolve(port))
    })
  })
}

/** Tue le process ET ses enfants (sous Windows, avec shell:true, child.kill() laisserait le serveur tourner). */
function killTree(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (child.exitCode !== null || !child.pid) return resolve()
    child.once("exit", () => resolve())
    if (process.platform === "win32") {
      execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], () => resolve())
    } else {
      child.kill()
    }
    setTimeout(resolve, 3000)
  })
}

export async function startOpenCode(opts: {
  workspace: string
  env?: Record<string, string> // clés API (variables d'environnement lues par le serveur OpenCode)
  bin?: ReturnType<typeof resolveOpenCodeBin>
}): Promise<Bridge> {
  const { workspace } = opts
  const bin = opts.bin ?? resolveOpenCodeBin()
  const password = randomBytes(24).toString("hex") // généré à chaque démarrage, jamais stocké
  const host = "127.0.0.1"
  const port = await freePort() // port libre : pas de conflit avec un `opencode serve` lancé à la main

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    OPENCODE_SERVER_USERNAME: "opencode",
    OPENCODE_SERVER_PASSWORD: password,
  }
  Object.assign(env, opts.env ?? {})

  const child = spawn(bin.command, ["serve", "--hostname", host, "--port", String(port)], {
    cwd: workspace,
    env,
    shell: bin.shell,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  })

  const tail: string[] = []
  const keep = (d: Buffer) => {
    for (const line of String(d).split(/\r?\n/).filter(Boolean)) {
      tail.push(line)
      if (tail.length > 15) tail.shift()
    }
  }
  child.stdout?.on("data", keep)
  child.stderr?.on("data", keep)

  let failure: string | undefined
  child.on("error", (err) => {
    failure = `Impossible de lancer « ${bin.command} » (${bin.source}) : ${err.message}`
  })
  child.on("exit", (code) => {
    failure = failure ?? `OpenCode s'est arrêté (code ${code}). ${tail.join(" | ")}`
  })

  const client = OpenCode.make({
    baseUrl: `http://${host}:${port}`,
    headers: { authorization: "Basic " + Buffer.from(`opencode:${password}`).toString("base64") },
  })

  try {
    const version = await waitUntilReady(client, workspace, [...TABS], () => failure)
    return { client, workspace, version, binSource: bin.source, stop: () => killTree(child) }
  } catch (err) {
    await killTree(child)
    throw err
  }
}

/** Attend le serveur, PUIS les agents : ils sont chargés en tâche de fond et la liste est vide au début. */
async function waitUntilReady(
  client: OpenCodeClient,
  workspace: string,
  required: string[],
  failure: () => string | undefined,
  timeoutMs = 90_000,
): Promise<string> {
  const started = Date.now()
  let lastErr: unknown
  let seen: string[] = []
  while (Date.now() - started < timeoutMs) {
    const f = failure()
    if (f) throw new Error(f)
    try {
      const info = await client.server.info()
      const { data } = await client.agent.list({ location: { directory: workspace } })
      seen = data.map((a) => a.id)
      if (required.every((id) => seen.includes(id))) {
        if (info.version !== EXPECTED_VERSION) console.warn(`⚠ OpenCode ${info.version} ≠ ${EXPECTED_VERSION}`)
        return info.version
      }
    } catch (err) {
      lastErr = err
    }
    await sleep(500)
  }
  throw new Error(
    `Agents introuvables après ${timeoutMs / 1000}s (requis : ${required.join(", ")} ; vus : ${seen.join(", ") || "aucun"}). ` +
      `Dossier : ${workspace}. Dernière erreur : ${String(lastErr)}`,
  )
}

/** Relaie les événements OpenCode (tous chats confondus). Le renderer filtre par conversation. */
export async function relayEvents(client: OpenCodeClient, send: (ev: AppEvent) => void, signal: AbortSignal) {
  try {
    for await (const ev of client.event.subscribe({ signal })) {
      const data = "data" in ev ? (ev.data as { sessionID?: string; form?: { sessionID?: string } }) : undefined
      // form.created ne porte pas sessionID à la racine : il est dans data.form
      const sessionID = data?.sessionID ?? data?.form?.sessionID
      if (!data || !sessionID) continue
      send({ type: ev.type, data: { ...data, sessionID } as Record<string, unknown> })
    }
  } catch (err) {
    if (!signal.aborted) console.error("event.subscribe:", err)
  }
}
