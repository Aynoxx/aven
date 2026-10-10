import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs"
import { join } from "node:path"

const NODE_VERSION = "22.14.0"
// v10.0.0 : empreinte officielle de win-x64/node.exe (SHASUMS256.txt publiée par
// nodejs.org pour v22.14.0). On ne fait pas confiance au réseau : tout binaire
// dont le SHA-256 diffère est supprimé et retéléchargé, puis recontrôlé.
const NODE_EXE_SHA256 = "33b1bc1a8aca11fd5a4f2699e51019c63c0af30cf437701d07af69be7706771b"
const targetDir = join("src-tauri", "resources", "nodejs")
const target = join(targetDir, "node.exe")

if (process.platform !== "win32") {
  console.log("Tauri runtime preparation: Windows Node binary skipped on non-Windows.")
  process.exit(0)
}

function sha256(file) {
  return createHash("sha256").update(readFileSync(file)).digest("hex")
}

function verified() {
  try {
    return sha256(target) === NODE_EXE_SHA256
  } catch {
    return false
  }
}

if (existsSync(target)) {
  if (verified()) {
    console.log("✓ Node runtime already prepared and checksum verified:", target)
    process.exit(0)
  }
  console.warn("⚠ Node runtime checksum mismatch, re-downloading:", target)
  rmSync(target, { force: true })
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

  // v10.0.0 : contrôle AVANT de promouvoir le fichier — un binaire corrompu ou
  // substitué ne devient jamais runtime/node.exe.
  const digest = sha256(temp)
  if (digest !== NODE_EXE_SHA256) {
    throw new Error("SHA-256 inattendu pour node.exe : " + digest)
  }

  renameSync(temp, target)
  console.log("✓ Node " + NODE_VERSION + " embedded and verified at " + target)
} catch (error) {
  try { rmSync(temp, { force: true }) } catch {}
  const detail = error instanceof Error ? error.message : String(error)
  throw new Error("Impossible de préparer Node " + NODE_VERSION + " pour Tauri : " + detail)
}
