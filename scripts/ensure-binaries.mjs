// npm 11 bloque par défaut les scripts d'installation des dépendances : Electron ne télécharge alors pas son
// binaire et le CLI OpenCode ne choisit pas le sien. Ce script (lancé par le postinstall du projet, donc à chaque
// `npm install`) exécute ces étapes lui-même, puis VÉRIFIE le résultat. Il est idempotent.
//
// Si install.js d'Electron s'arrête sans rien installer (constaté avec Node 26 : l'extraction du zip ne se termine pas),
// on télécharge le zip avec la même bibliothèque, puis on l'extrait avec les outils du système (tar / unzip).
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { createRequire } from "node:module"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const electronDir = path.join(root, "node_modules", "electron")
const cliDir = path.join(root, "node_modules", "@opencode", "cli")
const dist = path.join(electronDir, "dist")

const platformPath =
  process.platform === "win32" ? "electron.exe" : process.platform === "darwin" ? "Electron.app/Contents/MacOS/Electron" : "electron"
const electronReady = () => existsSync(path.join(electronDir, "path.txt")) && existsSync(path.join(dist, platformPath))

// Ces variables font silencieusement « sauter » le téléchargement d'Electron : on les retire pour ce script.
function cleanEnv() {
  const env = { ...process.env }
  for (const k of Object.keys(env)) {
    const l = k.toLowerCase()
    if (l === "electron_skip_binary_download" || l === "npm_config_platform" || l === "npm_config_arch") delete env[k]
  }
  return env
}

function runNode(label, file, cwd) {
  if (!existsSync(file)) {
    console.error(`✗ ${label} : ${file} introuvable (npm install incomplet ?)`)
    process.exit(1)
  }
  console.log(`→ ${label}`)
  execFileSync(process.execPath, [file], { stdio: "inherit", cwd, env: cleanEnv() })
}

function extractZip(zip, dir) {
  if (process.platform === "win32") {
    try {
      execFileSync("tar", ["-xf", zip, "-C", dir], { stdio: "inherit" }) // bsdtar, présent dans Windows 10/11
    } catch {
      execFileSync(
        "powershell",
        ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${dir}' -Force`],
        { stdio: "inherit" },
      )
    }
  } else {
    execFileSync("unzip", ["-q", "-o", zip, "-d", dir], { stdio: "inherit" })
  }
}

// ── 1. Electron ─────────────────────────────────────────────────────
if (!electronReady() && !process.env.FORCE_FALLBACK) {
  console.log("→ Electron : téléchargement du binaire (~100 Mo, patiente)…")
  runNode("Electron (install.js)", path.join(electronDir, "install.js"), electronDir)
}

if (!electronReady()) {
  console.log("→ Electron : extraction de secours…")
  const req = createRequire(path.join(electronDir, "install.js"))
  const { version } = JSON.parse(readFileSync(path.join(electronDir, "package.json"), "utf8"))
  const { downloadArtifact } = req("@electron/get")
  const zip = await downloadArtifact({
    version,
    artifactName: "electron",
    platform: process.platform,
    arch: process.arch,
    checksums: req("./checksums.json"),
  })
  console.log("  zip :", zip)
  rmSync(dist, { recursive: true, force: true })
  mkdirSync(dist, { recursive: true })
  extractZip(zip, dist)
  writeFileSync(path.join(electronDir, "path.txt"), platformPath)
}

if (!electronReady()) {
  console.error("\n✗ Electron n'est toujours pas installé.")
  console.error("  Node", process.version, "|", process.platform, process.arch)
  console.error("  path.txt présent :", existsSync(path.join(electronDir, "path.txt")))
  console.error("  dist :", existsSync(dist) ? readdirSync(dist).slice(0, 12).join(", ") : "absent")
  console.error("  Envoie-moi ces lignes.")
  process.exit(1)
}

// ── 2. CLI OpenCode ─────────────────────────────────────────────────
runNode("CLI OpenCode (choisit le binaire de ton processeur)", path.join(cliDir, "postinstall.mjs"), cliDir)
console.log("✓ Electron et CLI OpenCode prêts.")
