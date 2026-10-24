// v11.5.0 : récupère la voix locale Piper dans `src-tauri/resources/piper`,
// d'où l'installeur l'embarque (bundle.resources, clé `resources/piper/`).
//
// Pourquoi un script plutôt qu'une dépendance npm : Piper n'est pas un paquet
// Node, c'est un binaire et un modèle. Les poser ici garde `npm install` rapide
// et rend le téléchargement explicite (`npm run fetch:piper`).
//
// Idempotent : relancer ne retélécharge que ce qui manque. ~90 Mo au total.
import { execFileSync } from "node:child_process"
import { createWriteStream, existsSync, mkdirSync, rmSync } from "node:fs"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const target = path.join(root, "src-tauri", "resources", "piper")
const binary = path.join(target, "piper", "piper.exe")
const voice = path.join(target, "voices", "fr_FR-siwis-medium.onnx")

// Version épinglée : la dernière qui expose le binaire Windows officiel. Le
// modèle et le binaire doivent rester cohérents, donc on fige les deux.
const PIPER_ZIP = "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip"
const VOICE_BASE = "https://huggingface.co/rhasspy/piper-voices/resolve/main/fr/fr_FR/siwis/medium/fr_FR-siwis-medium"

async function download(url, destination) {
  const response = await fetch(url)
  if (!response.ok || !response.body) throw new Error(`Téléchargement impossible (HTTP ${response.status}) : ${url}`)
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destination))
}

if (process.platform !== "win32") {
  console.log("Piper : binaire Windows uniquement, étape ignorée sur cette plateforme.")
  process.exit(0)
}

if (existsSync(binary) && existsSync(voice)) {
  console.log("✓ Piper déjà présent (binaire + voix fr_FR-siwis-medium).")
  process.exit(0)
}

mkdirSync(target, { recursive: true })

if (!existsSync(binary)) {
  const zip = path.join(target, "piper.zip")
  console.log("→ Piper (binaire Windows, ~25 Mo)")
  await download(PIPER_ZIP, zip)
  // Pourquoi PowerShell et pas `tar` : sous Git Bash, le `tar` du PATH est le GNU,
  // qui lit « C:\… » comme un hôte distant (« Cannot connect to C: »).
  // Expand-Archive est fourni par Windows, sans dépendance à installer.
  execFileSync(
    "powershell",
    ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${target}' -Force`],
    { stdio: "inherit" },
  )
  rmSync(zip, { force: true })
}

if (!existsSync(voice)) {
  mkdirSync(path.dirname(voice), { recursive: true })
  console.log("→ Voix fr_FR-siwis-medium (~63 Mo)")
  await download(`${VOICE_BASE}.onnx`, voice)
  await download(`${VOICE_BASE}.onnx.json`, `${voice}.json`)
}

if (!existsSync(binary) || !existsSync(voice)) {
  console.error("✗ Piper incomplet : binaire ou modèle manquant.")
  process.exit(1)
}
console.log("✓ Piper prêt dans src-tauri/resources/piper.")
