import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v12.7.3 : une action cliquable avant que le Poste soit prêt ouvrait une vue sur un
// moteur absent (« Le runtime Aven n'est pas démarré. ») ou ne faisait rien quand la
// conversation manquait. Les trois actions rapides sont désormais désactivées tant
// que `ready` est faux, et une ligne écrite dit pourquoi — un bouton inerte sans
// explication se lit comme un bug (AGENTS.md §4 et §12.4).
//
// La règle figée : désactivé ET expliqué. L'un sans l'autre est un retour arrière.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

const pkg = JSON.parse(read("package.json"))
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"))
const cargo = read("src-tauri/Cargo.toml")
const home = read("web/src/workbench/HomeStage.tsx")
const css = read("web/src/styles/workbench.css")
const readme = read("README.md")

// ── Version et enregistrement ──────────────────────────────────────────────
assert.equal(tauri.version, pkg.version, "Tauri suit package.json")
assert.equal(cargo.match(/^version = "([^"]+)"$/m)?.[1], pkg.version, "Cargo suit package.json")
assert.equal(pkg.scripts["verify:v12.7.3"], "node scripts/verify-v12.7.3.mjs", "la sonde a son entrée npm")
assert.ok(pkg.scripts.verify.includes("scripts/verify-v12.7.3.mjs"), "npm run verify inclut la sonde v12.7.3")
const version = pkg.version.replaceAll(".", "\\.")
assert.match(readme, new RegExp(`^# Aven v${version}\\r?$`, "m"), "README annonce la version courante")
assert.ok(readme.includes("v12.7.3 — les actions rapides attendent que le Poste soit prêt"),
  "README documente l'attente des actions")

// ── Les trois actions sont désactivées par l'état RÉEL ─────────────────────
const buttons = home.match(/className="button ghost wb-home-action"[^>]*disabled=\{!ready\}/g) ?? []
assert.equal(buttons.length, 3, "les trois actions rapides sont désactivées tant que `ready` est faux")
assert.equal(home.match(/className="button ghost wb-home-action"/g)?.length, 3,
  "trois actions rapides, et aucune ne manque la condition")
// Le groupe nomme la raison pour les technologies d'assistance.
assert.match(home, /aria-label="Actions rapides"\s+aria-describedby=\{ready \? undefined : "wb-home-actions-state"\}/,
  "le groupe d'actions pointe vers la raison écrite quand il est désactivé")

// ── La raison est écrite, visible, tokenisée ──────────────────────────────
assert.match(home, /\{!ready && \(/, "la ligne n'existe que hors de l'état prêt")
assert.match(home, /id="wb-home-actions-state" className="wb-home-actions-state"/,
  "la raison porte l'identifiant annoncé par aria-describedby")
assert.match(home, /Les actions seront disponibles lorsque l’espace de travail sera prêt\./,
  "la raison dit QUAND les actions s'ouvriront")
const stateRule = css.match(/\n\.wb-home-actions-state \{[^}]*\}/)?.[0] ?? ""
assert.ok(stateRule, "la raison a sa règle de style")
assert.match(stateRule, /font-size: var\(--font-size-xs\)/, "la taille passe par le token des micro-libellés")
assert.match(stateRule, /color: var\(--muted\)/, "la couleur passe par le token du texte secondaire")
assert.ok(!/font-size: \d/.test(stateRule), "aucune taille en dur")

console.log("v12.7.3 verification: OK (actions désactivées avant l'état prêt, raison écrite)")
