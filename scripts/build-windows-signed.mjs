// v11.0.0 : paquet Windows signé (Authenticode) — la seule réponse durable à
// Smart App Control. Constat mesuré le 2026-10-22 : la politique CodeIntegrity
// {0283ac0f-fff1-49ae-ada1-8a933130cad6} (SAC, appliquée) refuse un binaire non
// signé par une AC du Microsoft Trusted Root Program. Un certificat auto-signé ne
// change rien à ce contrôle : ce script REFUSE donc de produire un paquet
// prétendument signé plutôt que de faire semblant.
//
// Ce qui est signé compte autant que le certificat : SAC évalue le code au
// chargement. Signer le seul installeur laisse aven.exe refusable — d'où la
// vérification de TOUS les exécutables produits, pas seulement du setup.
//
// Usage :
//   AVEN_SIGN_THUMBPRINT=<empreinte SHA1> npm run build:windows:signed
//   AVEN_SIGN_THUMBPRINT=… AVEN_SIGN_TIMESTAMP_URL=… node scripts/build-windows-signed.mjs
//   node scripts/build-windows-signed.mjs --check   (diagnostic, aucun build)
//
// Le certificat doit être installé dans le magasin Windows (jeton/HSM ou PFX
// importé) : c'est ce que Tauri sait signer nativement. Un certificat détenu
// uniquement dans un service cloud (ex. Azure Artifact Signing) demande un
// `bundle.windows.signCommand` à la place — ce n'est pas couvert ici.
import { spawnSync } from "node:child_process"
import { existsSync, readdirSync, statSync } from "node:fs"
import { join, relative } from "node:path"

const THUMBPRINT = (process.env.AVEN_SIGN_THUMBPRINT ?? "").replace(/\s+/g, "").toUpperCase()
const TIMESTAMP_URL = process.env.AVEN_SIGN_TIMESTAMP_URL ?? "http://timestamp.digicert.com"
const CHECK_ONLY = process.argv.includes("--check")
const RELEASE = join("src-tauri", "target", "release")
const TAURI_BIN = join("node_modules", "@tauri-apps", "cli", "tauri.js")
const KITS = "C:\\Program Files (x86)\\Windows Kits\\10\\bin"

const say = (message) => console.log(message)
const die = (message) => {
  console.error("\n✗ " + message)
  process.exit(2)
}

// Un certificat de signature de code est identifié par le SHA-1 de son empreinte
// (format attendu par Tauri). Toute autre valeur vient d'une variable mal saisie :
// mieux vaut s'arrêter que signer avec le mauvais identifiant.
if (THUMBPRINT && !/^[0-9A-F]{40}$/.test(THUMBPRINT)) {
  die(`AVEN_SIGN_THUMBPRINT invalide (40 caractères hexadécimaux attendus, reçu « ${THUMBPRINT} »).`)
}

// signtool est livré par le Windows SDK, pas par le PATH par défaut : on cherche
// la version la plus récente installée avant de déclarer l'outillage absent.
function findSigntool() {
  const onPath = spawnSync("where.exe", ["signtool"], { encoding: "utf8", windowsHide: true })
  if (onPath.status === 0) {
    const first = (onPath.stdout ?? "").split(/\r?\n/).map((l) => l.trim()).find(Boolean)
    if (first) return first
  }
  if (!existsSync(KITS)) return null
  const versions = readdirSync(KITS)
    .filter((v) => /^10\./.test(v))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .reverse()
  for (const version of versions) {
    const candidate = join(KITS, version, "x64", "signtool.exe")
    if (existsSync(candidate)) return candidate
  }
  return null
}

// Vérifie que le certificat visé est réellement disponible AVANT de lancer un
// build de plusieurs minutes : une empreinte absente du magasin échouerait à la
// toute fin, sur un message de signtool que personne ne relie à sa cause.
function certificateInstalled(thumbprint) {
  const ps =
    `$c = Get-ChildItem Cert:\\CurrentUser\\My, Cert:\\LocalMachine\\My -ErrorAction SilentlyContinue | ` +
    `Where-Object { $_.Thumbprint -eq '${thumbprint}' }; if ($c) { 'oui' } else { 'non' }`
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", ps], {
    encoding: "utf8",
    windowsHide: true,
  })
  return /oui/.test(r.stdout ?? "")
}

const signtool = findSigntool()
const certPresent = THUMBPRINT ? certificateInstalled(THUMBPRINT) : false

if (CHECK_ONLY) {
  say("Diagnostic de signature Windows")
  say(`  signtool      : ${signtool ?? "introuvable (installer le Windows SDK)"}`)
  say(`  empreinte     : ${THUMBPRINT || "non fournie (AVEN_SIGN_THUMBPRINT)"}`)
  say(`  certificat    : ${THUMBPRINT ? (certPresent ? "présent dans le magasin" : "ABSENT du magasin") : "non vérifié"}`)
  if (certPresent) say("                  présent ≠ de confiance publique : un certificat auto-signé ne satisfait pas Smart App Control")
  say(`  horodatage    : ${TIMESTAMP_URL}`)
  say(`  binaires      : ${existsSync(RELEASE) ? RELEASE : "aucun build release"}`)
  process.exit(signtool && certPresent ? 0 : 1)
}

if (!signtool) {
  die(
    "signtool introuvable : installer le Windows SDK (ou l'ajouter au PATH).\n" +
      "  Sans outil de signature, aucun paquet Aven ne sera accepté par Smart App Control.",
  )
}
if (!THUMBPRINT) {
  die(
    "aucun certificat de signature configuré : le paquet produit serait NON SIGNÉ,\n" +
      "  donc refusé au lancement par Smart App Control (authenticode requis, AC du\n" +
      "  Microsoft Trusted Root Program).\n" +
      "  Certificat OV suffisant ; auto-signé insuffisant.\n" +
      "  Renseigner AVEN_SIGN_THUMBPRINT (empreinte SHA-1 du certificat installé),\n" +
      "  ou lancer --check pour diagnostiquer l'environnement.",
  )
}
if (!certPresent) {
  die(
    `le certificat ${THUMBPRINT} n'est pas dans le magasin Windows (CurrentUser\\My ou LocalMachine\\My).\n` +
      "  Importer le PFX ou brancher le jeton/HSM avant de construire.",
  )
}

if (!existsSync(TAURI_BIN)) die(`${TAURI_BIN} absent — lancer npm install.`)

function run(label, command, args, options = {}) {
  say(`\n── ${label}`)
  const r = spawnSync(command, args, { stdio: "inherit", windowsHide: true, ...options })
  if (r.status !== 0) die(`${label} : échec (code ${r.status ?? "inconnu"}).`)
}

// build:host (tsc + esbuild) puis tauri build, qui exécute lui-même
// beforeBuildCommand = build:web. shell:true est réservé au shim npm (règle §7).
run("bundle host", "npm", ["run", "build:host"], { stdio: "inherit", shell: true })
run("runtime Tauri", process.execPath, ["scripts/prepare-tauri-runtime.mjs"])

// La configuration de signature passe par --config pour que rien de secret ne
// soit versionné : le dépôt ne connaît aucune empreinte, seule la machine qui
// construit sait avec quel certificat elle signe.
const override = {
  bundle: {
    windows: {
      certificateThumbprint: THUMBPRINT,
      digestAlgorithm: "sha256",
      timestampUrl: TIMESTAMP_URL,
    },
  },
}
run("tauri build", process.execPath, [TAURI_BIN, "build", "--config", JSON.stringify(override)])

function collectBinaries() {
  const files = []
  const app = join(RELEASE, "aven.exe")
  if (existsSync(app)) files.push(app)
  for (const folder of [join(RELEASE, "bundle", "nsis"), join(RELEASE, "bundle", "msi")]) {
    if (!existsSync(folder)) continue
    for (const name of readdirSync(folder)) {
      if (!/\.(exe|msi)$/i.test(name)) continue
      const full = join(folder, name)
      if (statSync(full).isFile()) files.push(full)
    }
  }
  return files
}

const binaries = collectBinaries()
if (binaries.length === 0) die(`aucun binaire produit sous ${RELEASE} — le build a-t-il vraiment abouti ?`)

// Vérification indépendante du build : Tauri déclare avoir signé, signtool dit
// si la chaîne est valide. Sans /pa, une signature de test passerait pour bonne.
say("\n── vérification des signatures")
const unsigned = []
for (const file of binaries) {
  const r = spawnSync(signtool, ["verify", "/pa", "/all", file], { encoding: "utf8", windowsHide: true })
  const name = relative(".", file)
  if (r.status === 0) {
    say(`  ✓ ${name}`)
  } else {
    const detail = ((r.stdout ?? "") + (r.stderr ?? "")).trim().split(/\r?\n/).filter(Boolean).slice(-2).join(" ")
    say(`  ✗ ${name} — ${detail || "aucune signature valide"}`)
    unsigned.push(name)
  }
}

if (unsigned.length > 0) {
  die(
    `${unsigned.length} binaire(s) sans signature valide :\n  ${unsigned.join("\n  ")}\n` +
      "  Smart App Control évalue chaque exécutable au chargement : un installeur signé\n" +
      "  ne protège pas un aven.exe non signé.",
  )
}

say(`\n✓ ${binaries.length} binaire(s) signé(s) et vérifié(s) (horodatage ${TIMESTAMP_URL}).`)
