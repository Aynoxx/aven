import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// fileURLToPath (et non .pathname) : sous Windows, "/C:/…" n'est pas un chemin valide.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

// Sondes v10.0.0 : migration Electron → Tauri 2. ① les contrôles de fenêtre passent
// par le façade `api` (plus de window.opencode direct) ; ② la fabrique Tauri est un
// module pur testé ; ③ le repo ne versionne plus le Node embarqué mais verrouille
// Cargo.lock et sonde le checksum ; ④ CSP non nulle ; ⑤ lib.rs découpé en modules
// testés avec reprise après crash ; ⑥ parité des notifications avec notify-policy.ts ;
// ⑦ liste blanche d'URLs identique des deux côtés.

const pkg = JSON.parse(read("package.json"))
const [vMaj, vMin, vPatch] = pkg.version.split(".").map(Number)
assert.ok(vMaj * 10000 + vMin * 100 + vPatch >= 10000, `version trop ancienne : ${pkg.version}`)

const app = read("web/src/App.tsx")
const api = read("web/src/api.ts")
const apiTauri = read("web/src/api-tauri.ts")
const ignore = read(".gitignore")
const prepare = read("scripts/prepare-tauri-runtime.mjs")
const conf = JSON.parse(read("src-tauri/tauri.conf.json"))
const lib = read("src-tauri/src/lib.rs")
const runtime = read("src-tauri/src/runtime.rs")
const notify = read("src-tauri/src/notify.rs")
const notifyPolicy = read("electron/notify-policy.ts")
const providers = read("electron/providers.ts")

// A. Titlebar : plus aucun accès direct à window.opencode hors du façade.
assert.match(app, /api\.minimizeWindow\(\)/, "le bouton Réduire passe par api")
assert.match(app, /api\.toggleMaximize\(\)/, "le bouton Agrandir passe par api")
assert.match(app, /api\.closeWindow\(\)/, "le bouton Fermer passe par api")
assert.ok(
  !app.includes("window.opencode."),
  "App.tsx ne parle plus à window.opencode (inexistant sous Tauri)"
)

// B. Fabrique testable : api-tauri.ts sans dépendance @tauri-apps + son test.
assert.match(api, /createTauriApi\(/, "api.ts assemble la fabrique")
assert.ok(!apiTauri.includes('from "@tauri-apps'), "api-tauri.ts n'importe aucun paquet Tauri")
assert.match(apiTauri, /export function createTauriApi/, "fabrique exportée")
assert.match(apiTauri, /export function serialize/, "sérialisation exportée et testée")
assert.ok(
  existsSync(path.join(root, "tests/tauri-api.test.mjs")),
  "tests/tauri-api.test.mjs attendu (routage aven_call)"
)

// C. Repo : Node embarqué ignoré, Cargo.lock versionné, checksum exigé.
assert.match(ignore, /src-tauri\/resources\//, "src-tauri/resources/ ignoré (node.exe 83 Mo)")
assert.ok(existsSync(path.join(root, "src-tauri/Cargo.lock")), "Cargo.lock doit être versionné")
assert.match(prepare, /NODE_EXE_SHA256/, "checksum SHA-256 du Node embarqué")
assert.match(prepare, /sha256\(temp\)/, "le binaire téléchargé est contrôlé avant promotion")

// D. CSP : plus de csp nulle.
assert.ok(conf.app?.security?.csp, "security.csp doit être une chaîne non vide")
assert.notEqual(conf.app.security.csp, null, "csp: null désactive toute protection")

// E. lib.rs découpé, reprise après crash présente.
for (const mod of ["runtime", "workspaces", "notify", "shell", "commands"]) {
  assert.ok(
    existsSync(path.join(root, `src-tauri/src/${mod}.rs`)),
    `module ${mod}.rs attendu`
  )
}
assert.match(lib, /mod runtime;/, "lib.rs déclare ses modules")
assert.ok(!lib.includes("fn aven_call"), "aven_call a quitté lib.rs pour commands.rs")
assert.match(runtime, /restart_allowed/, "budget de reprise après crash")
assert.match(runtime, /is_dead/, "détection de l'enfant Node mort")
assert.match(runtime, /CARGO_MANIFEST_DIR/, "template_dir ancré sur le manifeste, pas le cwd")

// F. Parité notifications : même seuil que notify-policy.ts, titre « Aven ».
const threshold = notifyPolicy.match(/turnDurationMs \?\? 0\) > (\d+)/)
assert.ok(threshold, "seuil TS introuvable dans notify-policy.ts")
assert.ok(
  notify.includes(`> ${threshold[1]}`),
  `notify.rs doit partager le seuil ${threshold[1]} ms de notify-policy.ts`
)
assert.match(notify, /\("Aven", "Tour terminé/, "titre de notification aligné sur « Aven »")
assert.ok(
  !notify.includes('("Tour terminé",'),
  "l'ancien titre divergent « Tour terminé » a disparu"
)

// G. Liste blanche d'URLs : chaque URL providers.ts existe dans le shell Rust.
const shell = read("src-tauri/src/shell.rs")
const urls = [...providers.matchAll(/url:\s*"(https:\/\/[^"]+)"/g)].map((m) => m[1])
assert.ok(urls.length >= 2, "providers.ts doit exposer au moins les deux clés connues")
for (const url of urls) {
  assert.ok(shell.includes(url), `URL providers.ts absente de la liste blanche Rust : ${url}`)
}

console.log("v10.0.0 verification: OK")
