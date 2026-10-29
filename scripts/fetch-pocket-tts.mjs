// v11.10.0 : pose le moteur Pocket TTS dans `src-tauri/resources/pocket-tts`, d'où
// l'installeur l'embarque (clé `resources/pocket-tts/` → `runtime/pocket-tts/`).
//
// Pourquoi un script plutôt qu'une dépendance npm : Pocket TTS n'est pas un paquet
// Node, c'est un binaire — le poser ici garde `npm install` rapide et rend le
// téléchargement explicite, comme pour Piper (`npm run fetch:piper`).
//
// Le zip publié est VÉRIFIÉ par son empreinte SHA-256 (celle du fichier
// SHA256SUMS de la version v4.0.1, relevée le 2026-10-27) : un binaire dont
// l'empreinte diffère est supprimé sans être lancé. C'est la même règle que pour
// node.exe dans `prepare-tauri-runtime.mjs` : on ne fait pas confiance au réseau.
//
// Les poids français (209 Mo, modèle « estelle », CC-BY 4.0, dépôt ouvert sans
// jeton) sont mis en cache par le moteur lui-même dans `%APPDATA%/Aven/pocket-tts`
// — l'endroit que le host transmet en `HF_HOME`. Le script lance le moteur une
// fois pour les préparer ; sans cette étape, la première réponse attendrait le
// téléchargement complet (le host le dit, mais autant l'éviter).
//
// Idempotent : relancer ne retélécharge que ce qui manque.
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { cpSync, createWriteStream, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const target = path.join(root, "src-tauri", "resources", "pocket-tts")
const binary = path.join(target, "pocket-tts.exe")
const license = path.join(target, "LICENSE-pocket-tts.txt")

// Version épinglée : la dernière publication du moteur Rust, dont le zip Windows
// correspond exactement au SHA256SUMS publié.
const RELEASE = "v4.0.1"
const ZIP_NAME = "pocket-tts-3.3.0-x86_64-pc-windows-msvc.zip"
const ZIP_SHA256 = "98753041f2e65744b989776f87bccb93f1f574a08afe1890c5427ec94cd6309c"
const ZIP_URL = `https://github.com/kyutai-labs/pocket-tts/releases/download/${RELEASE}/${ZIP_NAME}`

/** Cache du modèle : le même dossier que celui reçu par le host (HF_HOME). */
const modelDir = path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Aven", "pocket-tts")

async function download(url, destination) {
  const response = await fetch(url)
  if (!response.ok || !response.body) {
    throw new Error(`Téléchargement impossible (HTTP ${response.status}) : ${url}`)
  }
  const hash = createHash("sha256")
  await pipeline(
    Readable.fromWeb(response.body),
    async function* (source) {
      for await (const chunk of source) {
        hash.update(chunk)
        yield chunk
      }
    },
    createWriteStream(destination),
  )
  return hash.digest("hex")
}

/** Le modèle français est-il déjà en cache (peu importe le commit) ? */
function modelCached() {
  const hub = path.join(modelDir, "hub")
  if (!existsSync(hub)) return false
  for (const entry of readdirSync(hub)) {
    if (!entry.startsWith("models--kyutai--pocket-tts")) continue
    const snapshots = path.join(hub, entry, "snapshots")
    if (!existsSync(snapshots)) continue
    for (const commit of readdirSync(snapshots)) {
      if (existsSync(path.join(snapshots, commit, "languages", "french", "model.safetensors"))) return true
    }
  }
  return false
}

if (process.platform !== "win32") {
  console.log("Pocket TTS : binaire Windows uniquement, étape ignorée sur cette plateforme.")
  process.exit(0)
}

mkdirSync(target, { recursive: true })

if (!existsSync(binary)) {
  const zip = path.join(target, ZIP_NAME)
  console.log(`→ Moteur Pocket TTS (binaire Windows ${RELEASE}, ~8 Mo)`)
  const digest = await download(ZIP_URL, zip)
  if (digest !== ZIP_SHA256) {
    rmSync(zip, { force: true })
    console.error(`✗ Empreinte inattendue pour ${ZIP_NAME} : ${digest} (attendu ${ZIP_SHA256}). Rien n'a été installé.`)
    process.exit(1)
  }
  console.log(`  empreinte vérifiée : ${digest.slice(0, 16)}…`)
  // Pourquoi PowerShell et pas `tar` : sous Git Bash, le `tar` du PATH est le GNU,
  // qui lit « C:\… » comme un hôte distant (« Cannot connect to C: »).
  const extract = path.join(target, "extract")
  rmSync(extract, { recursive: true, force: true })
  execFileSync(
    "powershell",
    ["-NoProfile", "-Command", `Expand-Archive -LiteralPath '${zip}' -DestinationPath '${extract}' -Force`],
    { stdio: "inherit" },
  )
  const nested = readdirSync(extract).map((name) => path.join(extract, name)).find((entry) => existsSync(path.join(entry, "pocket-tts.exe")))
  if (!nested) {
    rmSync(zip, { force: true })
    rmSync(extract, { recursive: true, force: true })
    console.error("✗ pocket-tts.exe absent de l'archive : rien n'a été installé.")
    process.exit(1)
  }
  // Le host attend le binaire à la racine du dossier reçu par AVEN_POCKET_DIR.
  cpSync(path.join(nested, "pocket-tts.exe"), binary)
  const nestedLicense = path.join(nested, "LICENSE")
  if (existsSync(nestedLicense)) cpSync(nestedLicense, license)
  rmSync(extract, { recursive: true, force: true })
  rmSync(zip, { force: true })
  console.log(`  binaire posé : ${path.relative(root, binary)}`)
}

if (!existsSync(license)) {
  console.error("✗ Licence du moteur absente de l'archive : Pocket TTS ne sera pas distribué sans elle.")
  process.exit(1)
}

if (modelCached()) {
  console.log("✓ Modèle français déjà en cache.")
} else {
  // Même invocation que le host (serve + --quantize), en mode « generate » pour
  // sortir aussitôt : c'est le moteur qui télécharge, au bon endroit.
  console.log(`→ Modèle français « estelle » (209 Mo) vers ${modelDir}`)
  const out = path.join(os.tmpdir(), `aven-pocket-warmup-${Date.now()}.wav`)
  try {
    execFileSync(binary, ["generate", "--text", "Bonjour, je suis la voix locale d'Aven.", "--language", "french", "--output-path", out], {
      stdio: "inherit",
      env: { ...process.env, HF_HOME: modelDir, HF_HUB_DISABLE_TELEMETRY: "1" },
      timeout: 900_000,
    })
  } finally {
    rmSync(out, { force: true })
  }
  if (!modelCached()) {
    console.error("✗ Le modèle français n'a pas été mis en cache : la voix locale ne pourra pas parler.")
    process.exit(1)
  }
}

console.log("✓ Pocket TTS prêt dans src-tauri/resources/pocket-tts (binaire vérifié + modèle en cache).")
