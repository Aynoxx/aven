import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Sondes v10.2.1 : la version du retour au vert après la revue du 2026-10-17
// (docs/audits/2026-10-17-revue-complete-v10.2.0.md) — deux conventions figées :
//  ① les données IRREMPLAÇABLES (clés chiffrées, préférences, contenu des notes)
//     s'écrivent par writeTextAtomic (temp + rename), jamais en place ;
//  ② le premier clone n'a plus de piège : `npm run dev` prépare le runtime Node
//     embarqué et nomme l'outillage Rust manquant avant de compiler.
// verify-docs exige un scripts/verify-v<version>.mjs par version : c'est ce fichier.
// Il est écrit en invariants (pas de numéro figé) pour survivre aux bumps suivants.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

const pkg = JSON.parse(read("package.json"))
const [vMaj, vMin, vPatch] = pkg.version.split(".").map(Number)
assert.ok(vMaj * 10000 + vMin * 100 + vPatch >= 100201, `version trop ancienne : ${pkg.version}`)

const host = read("host/aven-app-host.ts")
const notes = read("host/notes.ts")
const bridge = read("host/agents-bridge.ts")
const runtime = read("scripts/prepare-tauri-runtime.mjs")
const readme = read("README.md")

// ── A. Chaîne de versions : Tauri suit package.json (les autres sondes couvrent Rust) ──
assert.equal(JSON.parse(read("src-tauri/tauri.conf.json")).version, pkg.version,
  "tauri.conf.json aligné sur package.json")
assert.equal(pkg.scripts["verify:v10.2.1"], "node scripts/verify-v10.2.1.mjs", "script dédié exposé")
assert.ok(pkg.scripts.verify.includes("verify-v10.2.1.mjs"),
  "la sonde entre dans la chaîne npm run verify (AGENTS.md §11)")
assert.match(readme, new RegExp(`^# Aven v${pkg.version.replace(/\./g, "\\.")}`, "m"),
  "README : titre de version")

// ── B. Écritures atomiques des données irremplaçables (constat C2 de l'audit) ──
// Un writeFileSync direct tronque en place : un crash laissait un JSON partiel que
// les lecteurs avalaient, et l'utilisateur devait ressaisir ses clés.
assert.ok(!/writeFileSync\s*\(\s*settingsPath\(\)/.test(host),
  "settings.json (clés chiffrées) : écriture directe interdite — writeTextAtomic (AGENTS.md §7)")
assert.ok(!/writeFileSync\s*\(\s*prefsPath\(\)/.test(host),
  "prefs.json : écriture directe interdite — writeTextAtomic (AGENTS.md §7)")
assert.ok(!/writeFileSync/.test(notes),
  "notes : contenu irremplaçable — aucune écriture directe, writeTextAtomic (AGENTS.md §7)")
assert.ok(!/writeFileSync/.test(bridge),
  "agents-bridge : writeFileSync inutilisé retiré (sinon il invite la prochaine écriture directe)")
assert.match(host, /function writeSettings\(value: unknown\)/,
  "un seul chemin d'écriture pour settings.json")
assert.match(host, /writeTextAtomic\(file, JSON\.stringify\(value, null, 2\)/,
  "settings.json écrit par writeTextAtomic (temp + rename)")
assert.match(host, /copyFileSync\(file, `\$\{file\}\.bak`\)/,
  "settings.json : copie .bak du dernier état lisible avant remplacement")
assert.match(notes, /writeTextAtomic\(abs, content/, "note sauvegardée via writeTextAtomic")
// v10.2.1 : DPAPI a besoin de System.Security.dll, que Windows PowerShell n'importe pas
// toujours seul — sans ce chargement, enregistrer une clé échouait (« Le chiffrement
// Windows de la clé a échoué. »). Constaté en pilotant le host, pas déduit du code.
assert.match(host, /Add-Type -AssemblyName System\.Security;/,
  "DPAPI : l'assembly System.Security est chargé explicitement avant Protect/Unprotect")
// Le repli silencieux masquait la perte : il doit laisser une trace sur stderr.
assert.match(host, /settings\.json illisible/, "settings.json illisible : erreur journalisée, pas avalée")
assert.match(host, /prefs\.json illisible/, "prefs.json illisible : erreur journalisée, pas avalée")

// ── C. Parité de développement : clone frais = un seul `npm run dev` ────────────
assert.match(pkg.scripts["tauri:dev"], /scripts\/prepare-tauri-runtime\.mjs/,
  "tauri:dev prépare le runtime Node embarqué (sinon : « resource path doesn't exist »)")
assert.match(pkg.scripts["tauri:build"], /scripts\/prepare-tauri-runtime\.mjs/,
  "tauri:build garde la même préparation")
assert.match(runtime, /execFileSync\("cargo", \["--version"\]/,
  "pré-contrôle de cargo avant toute compilation Tauri")
assert.match(runtime, /Visual Studio Build Tools 2022/,
  "le message nomme le second prérequis Windows (workload C++ / linker MSVC)")

// ── D. La documentation dit vrai sur ces deux promesses ────────────────────────
assert.match(readme, /v10\.2\.1 — /, "README : note de version v10.2.1")
assert.match(readme, /Visual Studio Build Tools 2022/, "README : prérequis réels, pas seulement « un outillage Rust »")
assert.match(readme, /cargo introuvable/, "README : dépannage du premier lancement")
assert.match(readme, /node\.exe/, "README : dépannage du runtime Node embarqué")
assert.match(readme, /verify-v10\.2\.1\.mjs/, "README : la sonde est citée")

console.log("v10.2.1 verification: OK")
