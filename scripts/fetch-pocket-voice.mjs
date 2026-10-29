// v11.10.0 : pose (ou retire) le profil de voix clonée de Pocket TTS.
//
// Pourquoi un script, et pas un fichier livré : le profil n'est PAS un modèle
// qu'on redistribue — c'est un dérivé d'un enregistrement de référence. Il vit
// donc dans les données de l'app, à l'endroit exact où le host le cherche
// (`<données>/pocket-tts/voices/aven.safetensors`), et jamais dans le dépôt ni
// dans l'installeur. `verify-v11.10.0.mjs` refuse un `.safetensors` sous
// `src-tauri/resources/`.
//
// Deux entrées acceptées :
//   - un `.safetensors` déjà produit (le cas courant : `export-voice` a tourné
//     ailleurs) : recopié après vérification de son en-tête ;
//   - un enregistrement audio (WAV, MP3…), converti ici par `export-voice` du
//     binaire embarqué. Cette conversion est le SEUL chemin qui demande le modèle
//     avec clonage (`kyutai/pocket-tts`, accès soumis à conditions) : l'erreur le
//     dit, avec le remède, au lieu d'échouer en silence.
// Une fois le profil posé, la lecture est entièrement hors ligne avec le modèle
// ouvert : la voix clonée n'a besoin de rien d'autre (mesuré le 2026-10-27).
//
// Idempotent : relancer remplace le profil. `--remove` revient à la voix intégrée.
import { execFileSync } from "node:child_process"
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const binary = path.join(root, "src-tauri", "resources", "pocket-tts", "pocket-tts.exe")
const dataDir = process.env.AVEN_USER_DATA_DIR || path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "Aven")
const voicesDir = path.join(dataDir, "pocket-tts", "voices")
const target = path.join(voicesDir, "aven.safetensors")
/** Même dossier que le host : le moteur y met son modèle en cache. */
const modelDir = path.join(dataDir, "pocket-tts")

function usage() {
  console.log(
    [
      "Pose la voix clonée de Pocket TTS dans les données de l'app.",
      "",
      "  npm run voice:pocket -- <fichier.safetensors>   profil déjà produit",
      "  npm run voice:pocket -- <enregistrement.wav>    converti par le moteur",
      "  npm run voice:pocket -- --remove                revient à la voix intégrée",
      "  npm run voice:pocket                            état actuel",
      "",
      `Dossier : ${voicesDir}`,
    ].join("\n"),
  )
}

/**
 * Un `.safetensors` commence par la taille (entier 64 bits, petit-boutiste) de son
 * en-tête JSON, qui décrit les tenseurs. On refuse tout autre fichier : un profil
 * corrompu ne doit pas remplacer un profil qui marche.
 */
function readProfile(file) {
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
  const tensors = Object.values(header).filter((entry) => entry && typeof entry === "object" && "dtype" in entry && "shape" in entry)
  if (!tensors.length) throw new Error("aucun tenseur décrit dans l'en-tête")
  return { bytes: bytes.length, tensors: tensors.length }
}

function install(file, origin) {
  const profile = readProfile(file)
  mkdirSync(voicesDir, { recursive: true })
  // Écriture par renommage : jamais un profil à moitié écrit à la place du bon.
  const staging = `${target}.new`
  copyFileSync(file, staging)
  renameSync(staging, target)
  const megabytes = (profile.bytes / 1024 / 1024).toFixed(1)
  console.log(`✓ Voix clonée posée (${profile.tensors} tenseurs, ${megabytes} Mo${origin}) : ${target}`)
  if (profile.bytes < 1024 * 1024) {
    console.log("  attention : le profil est petit — un enregistrement de référence court donne une voix instable.")
  }
  console.log("  Réglages → Agent vocal proposera « Pocket TTS — locale, voix clonée ».")
}

const args = process.argv.slice(2)

if (args.includes("--remove")) {
  if (existsSync(target)) {
    rmSync(target, { force: true })
    console.log(`✓ Profil retiré : la voix intégrée du moteur reprend la main.\n  ${target}`)
  } else {
    console.log("Aucun profil installé : rien à retirer.")
  }
  process.exit(0)
}

if (!args.length || args[0] === "--help" || args[0] === "-h") {
  usage()
  if (existsSync(target)) {
    const size = (statSync(target).size / 1024 / 1024).toFixed(1)
    console.log(`\nÉtat : voix clonée installée (${size} Mo).`)
  } else {
    console.log("\nÉtat : voix intégrée du moteur (aucun profil installé).")
  }
  process.exit(0)
}

const source = path.resolve(args[0])
if (!existsSync(source)) {
  console.error(`✗ Fichier introuvable : ${source}`)
  process.exit(1)
}

if (source.toLowerCase().endsWith(".safetensors")) {
  try {
    install(source, "")
  } catch (error) {
    console.error(`✗ ${(error instanceof Error ? error.message : String(error))} — rien n'a été installé.`)
    process.exit(1)
  }
  process.exit(0)
}

// Enregistrement de référence : le binaire le convertit. Il a besoin du modèle
// avec clonage, seul point de la chaîne qui demande un accès (le lire, non).
if (!existsSync(binary)) {
  console.error("✗ Binaire absent : lance d'abord « npm run fetch:pocket-tts ».")
  process.exit(1)
}

const staged = `${target}.export`
console.log(`→ Conversion de ${path.basename(source)} par le moteur (modèle français)…`)
try {
  rmSync(staged, { force: true })
  execFileSync(binary, ["export-voice", "--language", "french", source, staged], {
    stdio: "inherit",
    env: { ...process.env, HF_HOME: modelDir, HF_HUB_DISABLE_TELEMETRY: "1" },
    timeout: 1_800_000,
  })
} catch {
  rmSync(staged, { force: true })
  console.error(
    [
      "✗ Le moteur n'a pas pu convertir cet enregistrement.",
      "  La conversion (et elle seule) utilise le modèle avec clonage « kyutai/pocket-tts »,",
      "  dont l'accès est soumis à conditions : accepte-les sur la page du dépôt, connecte-toi",
      "  avec « hf auth login », puis relance la commande.",
      "  Sinon, fournis directement un profil .safetensors déjà produit.",
    ].join("\n"),
  )
  process.exit(1)
}

try {
  install(staged, " (converti depuis l'enregistrement de référence)")
} finally {
  rmSync(staged, { force: true })
}
