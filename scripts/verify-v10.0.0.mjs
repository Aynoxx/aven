import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// fileURLToPath (et non .pathname) : sous Windows, "/C:/…" n'est pas un chemin valide.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

// Sondes v10.0.0 : migration Electron → Tauri 2. ① barre Windows native (plus de
// contrôles custom hérités d'Electron frameless) ; ② la fabrique Tauri est un
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
const notifyPolicy = read("host/notify-policy.ts")
const providers = read("host/providers.ts")

// A. Barre Windows native : la barre de fermeture custom (héritée d'Electron
// frameless) a disparu du renderer comme du contrat d'API — Tauri garde ses
// décorations, c'est la barre système qui minimise/agrandit/ferme.
const types = read("web/src/types.ts")
assert.ok(!app.includes("window-controls"), "App.tsx ne dessine plus de contrôles custom")
assert.ok(
  !/minimizeWindow|toggleMaximize|closeWindow/.test(app),
  "aucune commande fenêtre dans le renderer (la barre native gère)"
)
assert.ok(
  !/minimizeWindow|toggleMaximize|closeWindow/.test(types),
  "types.ts ne déclare plus les contrôles de fenêtre"
)
assert.ok(
  conf.app.windows?.[0]?.decorations !== false,
  "décorations natives conservées : la barre Windows porte la fermeture"
)
assert.strictEqual(
  conf.app.windows?.[0]?.maximized,
  true,
  "la fenêtre démarre maximisée (convention figée v10.0.x)"
)
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

// H. Fumée Tauri : script branché, pilote la webview en CDP, exerce la reprise
// après crash sur un runtime Node réel.
const smoke = read("scripts/smoke-tauri.mjs")
assert.match(pkg.scripts["smoke:tauri"] ?? "", /smoke-tauri\.mjs/, "script npm smoke:tauri branché")
assert.match(
  smoke,
  /WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS/,
  "la fumée ouvre le débogueur CDP de WebView2"
)
assert.match(smoke, /reprise-crash/, "la fumée tue l'enfant Node et vérifie la reprise")
assert.match(smoke, /barre-native/, "la fumée vérifie l'absence de contrôles custom")

// I. CI Windows : workflow dédié qui enchaîne la boucle complète ET la fumée.
const ciWindows = read(".github/workflows/ci-windows.yml")
assert.match(ciWindows, /runs-on: windows-latest/, "la CI Windows tourne bien sur windows-latest")
assert.match(ciWindows, /npm run typecheck/, "la CI Windows typecheck")
assert.match(ciWindows, /npm test/, "la CI Windows exécute les tests unitaires")
assert.match(ciWindows, /npm run verify/, "la CI Windows exécute la chaîne verify")
assert.match(ciWindows, /cargo test/, "la CI Windows exécute les tests Rust")
assert.match(ciWindows, /npm run smoke:tauri/, "la CI Windows exécute la fumée Tauri")

// J. Persistance de la fenêtre : plugin officiel, flags restreints à la
// taille/position/maximisé (VISIBLE exclu — fermeture vers le tray), et
// restauration reprise à la main dans .setup() car le plugin ne fait que
// « maximize » : sans unmaximize, un état fenêtré sauvé serait écrasé par le
// maximisé de tauri.conf.json.
const cargo = read("src-tauri/Cargo.toml")
assert.match(cargo, /tauri-plugin-window-state/, "plugin tauri-plugin-window-state déclaré")
assert.match(lib, /tauri_plugin_window_state::Builder/, "plugin enregistré dans lib.rs")
assert.match(
  lib,
  /skip_initial_state\("main"\)/,
  "restauration explicite (skip_initial_state) : le plugin ne démaximise jamais"
)
assert.match(
  lib,
  /StateFlags::SIZE \| StateFlags::POSITION \| StateFlags::MAXIMIZED/,
  "flags restreints à taille/position/maximisé (VISIBLE exclu)"
)
assert.match(lib, /\.unmaximize\(\)/, "unmaximize conditionné à un état sauvé")
assert.match(lib, /DEFAULT_FILENAME/, "fichier d'état standard du plugin")
assert.match(
  pkg.scripts["test:window-state"] ?? "",
  /test-window-state\.mjs/,
  "script npm test:window-state branché (persistance de bout en bout)"
)
assert.match(
  pkg.scripts["test:features"] ?? "",
  /test-features-tauri\.mjs/,
  "script npm test:features branché (parcours fonctionnel complet)"
)
const features = read("scripts/test-features-tauri.mjs")
assert.ok(
  features.includes("127\\.0\\.0\\.1:5173"),
  "le parcours détecte un binaire laissé par tauri:dev"
)
assert.match(features, /CONTRASTE/, "le parcours mesure les contrastes des deux thèmes")

console.log("v10.0.0 verification: OK")
