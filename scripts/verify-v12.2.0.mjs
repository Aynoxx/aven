import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v12.2.0 : l'accueil reçoit une couche technique de fond et un bâti qui suit la VRAIE
// phase vocale. Ce que la sonde fige :
//   A. le fond est décoratif — aria-hidden, aucun pointeur, aucun texte, aucune
//      coordonnée : une carte n'invente pas de données ;
//   B. la lisibilité prime — les courbes s'effacent sous l'identité par masque ;
//   C. le bâti suit `voice.phase` et AUCUN minuteur ne simule un état ;
//   D. chaque phase a son effet, et le mouvement réduit arrête tout ;
//   E. les styles restent tokenisés (aucune couleur ni taille en dur).

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

const pkg = JSON.parse(read("package.json"))
const home = read("web/src/workbench/HomeStage.tsx")
const css = read("web/src/styles/workbench.css")
const da = read("web/src/styles/da.css")
const readme = read("README.md")
const agents = read("AGENTS.md")
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"))
const cargo = read("src-tauri/Cargo.toml")

// ── Version et enregistrement de la sonde ──────────────────────────────────
assert.equal(tauri.version, pkg.version, "tauri.conf.json suit package.json")
assert.match(cargo, new RegExp(`^version = "${pkg.version.replaceAll(".", "\\.")}"$`, "m"), "Cargo.toml suit package.json")
assert.equal(pkg.scripts["verify:v12.2.0"], "node scripts/verify-v12.2.0.mjs", "la sonde a son entrée npm")
assert.ok(pkg.scripts.verify.includes("scripts/verify-v12.2.0.mjs"), "npm run verify inclut la sonde v12.2.0")
assert.match(readme, new RegExp(`v${pkg.version.replaceAll(".", "\\.")} — `), "README porte la note de la version courante")

// ── A. Le fond est décoratif, jamais une donnée ────────────────────────────
assert.match(home, /className="wb-home-field" aria-hidden="true"/, "la couche de fond est annoncée décorative")
const fieldRule = css.match(/\.wb-home-field \{[^}]*\}/)?.[0] ?? ""
assert.ok(fieldRule, "la couche de fond a sa règle dédiée")
assert.match(fieldRule, /pointer-events: none/, "la couche de fond ne capte jamais le pointeur")
assert.match(fieldRule, /overflow: hidden/, "les tracés ne débordent pas de l'accueil")
assert.match(css, /\.wb-home-grid \{[^}]*z-index: 1/, "la composition passe AU-DESSUS du fond")
// Un tracé n'a pas de valeur : aucun texte, aucune coordonnée, aucune mesure.
assert.ok(!/\d{1,3}°|\d{2}:\d{2}\s?[NS]\b|\bkm\b|\bm\b\d/i.test(home + css), "aucune coordonnée ni métrique inventée dans le fond")
const fieldMarkup = home.slice(home.indexOf("wb-home-field"), home.indexOf("wb-home-grid"))
assert.ok(!/[àâäçéèêëîïôöùûüÿœ]/i.test(fieldMarkup), "la couche de fond ne porte aucun texte lisible")

// ── B. La lisibilité prime : les courbes s'effacent sous l'identité ────────
assert.match(css, /\.wb-home-field::after \{[^}]*repeating-radial-gradient/, "les courbes de niveau sont un motif CSS, pas une image")
assert.match(css, /\.wb-home-field::after \{[^}]*mask-image: radial-gradient/, "les courbes sont masquées au centre : le texte reste net")
assert.match(css, /\.wb-home-ticks \{[^}]*repeating-linear-gradient/, "la ligne graduée est un motif, pas un caractère Unicode")

// ── C. Le bâti suit la phase réelle, sans minuteur ─────────────────────────
assert.match(home, /data-phase=\{voice\.phase\}/, "la scène reçoit la phase de la session vocale")
assert.ok(!/setTimeout|setInterval/.test(home), "aucun minuteur ne simule un état dans l'accueil")
assert.ok(!/data-phase="listening"/.test(home), "la phase n'est jamais écrite en dur dans le rendu")

// ── D. Une phase = son effet, sans boucle de plus ────────────────
for (const phase of ["thinking", "listening", "capturing", "speaking"]) {
  assert.match(css, new RegExp(`\\.wb-home-scene\\[data-phase="${phase}"\\]`), `la phase « ${phase} » a son effet`)
}
// Les règles de PHASE ne déclarent aucune animation : elles changent un état.
const phaseTail = css.slice(css.indexOf(".wb-home-scene[data-phase="), css.indexOf("/* Zone inférieure"))
assert.ok(!/\binfinite\b/.test(phaseTail), "une phase ne déclare aucune animation infinie")
assert.match(css, /\.wb-home-ring, \.wb-home-node \{\s*transition: [^}]*var\(--dur-med\) var\(--ease-out\)/, "les changements d'état passent par les tokens de temps")
assert.match(da, /@media \(prefers-reduced-motion: reduce\) \{\s*\.wb-app \*/, "le mouvement réduit arrête le bâti comme le reste du Poste")

// ── E. Styles tokenisés ────────────────────────────────────────────────────
const fieldStart = css.indexOf(".wb-home-field {")
const fieldEnd = css.indexOf(".wb-home-grid {")
const fieldCss = css.slice(fieldStart, fieldEnd) + css.slice(css.indexOf("/* v12.2.0 : le bâti"), css.indexOf("/* Zone inférieure"))
assert.ok(!/#[0-9a-f]{3,8}\b/i.test(fieldCss), "aucune couleur en dur dans le fond ni le bâti")
assert.ok(!/font-size:\s*\d+px/.test(fieldCss), "aucune taille de police en dur")
assert.match(agents, /lié à `voice\.phase`/, "AGENTS.md dit que le bâti suit la phase réelle")

console.log("v12.2.0 verification: OK (fond technique décoratif, bâti lié à la phase réelle, mouvement réduit couvert)")
