import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { join } from "node:path"
import { createInterface } from "node:readline"

const root = process.cwd()
const host = join(root, "dist-electron", "aven-app-host.mjs")

if (!existsSync(host)) {
  throw new Error("Host applicatif introuvable. Lance d’abord npm run build:electron.")
}

const child = spawn(process.execPath, [host], {
  cwd: root,
  stdio: ["pipe", "pipe", "pipe"],
  windowsHide: true,
})

const rl = createInterface({ input: child.stdout })
const response = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    child.kill()
    reject(new Error("Timeout du smoke-test du host Aven."))
  }, 10_000)

  rl.on("line", (line) => {
    try {
      const message = JSON.parse(line)
      if (message.id !== 1) return
      clearTimeout(timeout)
      resolve(message)
    } catch {}
  })

  child.on("error", (error) => {
    clearTimeout(timeout)
    reject(error)
  })
})

child.stdin.write(JSON.stringify({
  jsonrpc: "2.0",
  id: 1,
  method: "ping",
  params: [],
}) + "\n")

if (response?.result?.alive !== true || response?.result?.initialized !== false) {
  child.kill()
  throw new Error("Réponse ping inattendue : " + JSON.stringify(response))
}

child.stdin.end()
console.log("✓ aven-app-host RPC ping")
