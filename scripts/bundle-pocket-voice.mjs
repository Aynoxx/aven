// v12.9.0 : embarque un profil de voix clonée dans un installeur LOCAL.
//
// Pourquoi ce script existe : le profil reste hors du dépôt (c'est un dérivé
// d'un enregistrement de référence), mais un build local peut le livrer avec
// l'app. Il est copié dans `src-tauri/resources/pocket-tts/voices/`, dossier
// gitignoré, et le host le pose dans les données de l'app au premier lancement.
//
// `--attest` est OBLIGATOIRE : il écrit `voice-consent.json` (attestation,
// portée `local-installer`). Le host refuse de poser un profil sans cette
// attestation. Le script avertit : tout installeur construit depuis ce dossier
// contiendra le profil — ne l'utilise pas pour une distribution publique.
//
// Idempotent : relancer remplace le profil embarqué et réécrit l'attestation.
// `--remove` retire les deux fichiers.
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const args = process.argv.slice(2)
const attest = args.includes("--attest")
const remove = args.includes("--remove")
const statusOnly = args.includes("--status") || (!args.length && !attest && !remove)
const sourceArg = args.find((arg) => !arg.startsWith("--"))
const dataDir = process.env.AVEN_USER_DATA_DIR || path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Aven")
const source = path.resolve(sourceArg || path.join(dataDir, "pocket-tts", "voices", "aven.safetensors"))
const targetDir = path.join(root, "src-tauri", "resources", "pocket-tts", "voices")
const target = path.join(targetDir, "aven.safetensors")
const consent = path.join(targetDir, "voice-consent.json")

/** Même contrôle d'en-tête que le host : un profil tronqué n'est jamais embarqué. */
function summary(file) {
  const bytes = readFileSync(file)
  if (bytes.length < 9) throw new Error("fichier trop court pour un profil de voix")
  const headerLength = Number(bytes.readBigUInt64LE(0))
  if (!headerLength || headerLength > bytes.length - 8) throw new Error("en-tête de taille incohérente")
  let header
  try {
    header = JSON.parse(bytes.subarray(8, 8 + headerLength).toString("utf8"))
  } catch {
    throw new Error("en-tête illisible : ce n'est pas un fichier .safetensors")
  }
  const tensors = Object.values(header ?? {}).filter(
    (entry) => entry && typeof entry === "object" && "dtype" in entry && "shape" in entry,
  )
  if (!tensors.length) throw new Error("aucun tenseur décrit dans l'en-tête")
  return { bytes: bytes.length, tensors: tensors.length }
}

function show() {
  if (!existsSync(target)) {
    console.log("Aucun profil embarqué dans l'installeur local.")
    return
  }
  const size = (statSync(target).size / 1024 / 1024).toFixed(1)
  console.log(`Profil embarqué : ${target} (${size} Mo)`)
  console.log(existsSync(consent) ? `Attestation : ${consent}` : "Attestation absente : le host refusera de le poser.")
}

if (statusOnly) {
  show()
  process.exit(0)
}

if (remove) {
  for (const file of [target, consent]) rmSync(file, { force: true })
  console.log("Profil embarqué et attestation retirés : le prochain installeur n'embarquera plus de voix.")
  process.exit(0)
}

if (!attest) {
  console.error(
    "Refus : ajoute « --attest » pour attester que cette voix est la tienne et que ce profil peut être inclus dans un installeur construit depuis ce dossier.",
  )
  process.exit(1)
}

if (source === target) {
  console.error("Refus : la source est déjà le profil embarqué.")
  process.exit(1)
}

if (!existsSync(source)) {
  console.error(`✗ Profil introuvable : ${source}`)
  console.error("  Clône d'abord ta voix dans Réglages → Agent vocal, ou passe un chemin explicite.")
  process.exit(1)
}

let info
try {
  info = summary(source)
} catch (error) {
  console.error(`✗ ${(error instanceof Error ? error.message : String(error))} — rien n'a été embarqué.`)
  process.exit(1)
}

mkdirSync(targetDir, { recursive: true })
const staging = `${target}.new`
rmSync(staging, { force: true })
copyFileSync(source, staging)
renameSync(staging, target)
writeFileSync(
  consent,
  JSON.stringify(
    {
      attested: true,
      scope: "local-installer",
      at: new Date().toISOString(),
      app: "Aven",
      profile: "aven.safetensors",
    },
    null,
    2,
  ) + "\n",
  "utf8",
)

const megabytes = (info.bytes / 1024 / 1024).toFixed(1)
console.log(`✓ Profil embarqué (${info.tensors} tenseurs, ${megabytes} Mo) : ${target}`)
console.log(`✓ Attestation locale écrite : ${consent}`)
console.warn(
  "⚠ Ce profil sera inclus dans TOUT installeur construit depuis ce dossier. Ne l'utilise que pour un build local, jamais pour une distribution publique.",
)
