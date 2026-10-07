import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, renameSync, rmSync } from "node:fs"
import { join } from "node:path"

const NODE_VERSION = "22.14.0"
const targetDir = join("src-tauri", "resources", "nodejs")
const target = join(targetDir, "node.exe")

if (process.platform !== "win32") {
  console.log("Tauri runtime preparation: Windows Node binary skipped on non-Windows.")
  process.exit(0)
}

if (existsSync(target)) {
  console.log("✓ Node runtime already prepared:", target)
  process.exit(0)
}

mkdirSync(targetDir, { recursive: true })

const url = "https://nodejs.org/dist/v" + NODE_VERSION + "/win-x64/node.exe"
const temp = join(targetDir, "node-" + NODE_VERSION + ".tmp.exe")

try {
  const ps = [
    "$ErrorActionPreference = 'Stop'",
    "$ProgressPreference = 'SilentlyContinue'",
    "$u = '" + url + "'",
    "$o = '" + temp.replaceAll("'", "''") + "'",
    "Invoke-WebRequest -UseBasicParsing -Uri $u -OutFile $o",
  ].join("; ")

  execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], {
    stdio: "inherit",
  })

  renameSync(temp, target)
  console.log("✓ Node " + NODE_VERSION + " embedded at " + target)
} catch (error) {
  try { rmSync(temp, { force: true }) } catch {}
  const detail = error instanceof Error ? error.message : String(error)
  throw new Error("Impossible de préparer Node " + NODE_VERSION + " pour Tauri : " + detail)
}
