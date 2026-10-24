import assert from "node:assert/strict"
import { readFileSync, readdirSync, statSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { readStyles } from "./lib/sources.mjs"

// v11.0.1 : correctifs d'après l'audit docs/audits/2026-10-22-coherence-graphique.md.
// Chaque assertion décrit une régression observée à l'écran, pas une préférence :
// colonne fantôme, feuille de style orpheline, version du moteur présentée comme
// celle de l'app, boutons sans type, icônes hors grille.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")
const pkg = JSON.parse(read("package.json"))
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"))
const cargo = read("src-tauri/Cargo.toml")
const css = readStyles()
const conversation = read("web/src/pages/ConversationPage.tsx")
const shell = read("web/src/workbench/WorkbenchShell.tsx")
const home = read("web/src/workbench/HomeBoard.tsx")
const notes = read("web/src/NotesView.tsx")
const settings = read("web/src/SettingsDialog.tsx")

// ── A. Version cohérente dans les trois manifestes ───────────────────────────
// v11.0.2 : la sonde ne fige plus SON numéro (même règle que v10.5.0 après v11.0.0) :
// une version gelée ici ferait échouer chaque bump. Elle vérifie l'alignement des
// manifestes et le contenu de la version ; l'identité de la version courante est
// portée par README + la sonde de la version courante.
assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "package.json porte une version sémantique")
assert.equal(tauri.version, pkg.version, "tauri.conf.json suit package.json")
assert.match(cargo, new RegExp(`^version = "${pkg.version.replaceAll(".", "\\.")}"$`, "m"), "Cargo.toml suit package.json")

// ── B. La conversation ne réserve plus la colonne d'une barre absente ────────
// v11.1.4 : la position de la barre latérale n'était posée par AUCUN composant — le
// réglage « Position de la barre latérale » ne faisait rien. La sonde vérifie les deux
// moitiés de la chaîne : la classe appliquée, et la règle CSS qui la consomme.
assert.match(
  conversation,
  /` sidebar-\$\{appearance\.sidebarPosition\}`/,
  "la position choisie dans les Réglages est posée sur la grille",
)
assert.match(
  conversation,
  /: " sidebar-hidden"\}/,
  "la grille se replie quand la barre latérale n'est pas rendue",
)
assert.match(css, /\.workspace-layout\.sidebar-hidden/, "la règle de repli vise l'élément lui-même")
assert.match(
  css,
  /\.workspace-layout\.sidebar-right \{[^}]*grid-template-columns: minmax\(0, 1fr\) var\(--sidebar-width\)/,
  "le côté droit permute réellement les deux colonnes",
)
assert.match(
  css,
  /\.workspace-layout\.sidebar-right \.sidebar \{[^}]*order: 2/,
  "la barre latérale passe après le fil quand elle est à droite",
)

// ── C. Aucune classe stylée n'est orpheline (régression v11.0.0) ─────────────
for (const rule of [".stats-grid {", ".stat-tile {", ".scroll-bottom {"]) {
  assert.ok(css.includes(rule), `la classe ${rule.slice(0, -2)} a une règle CSS`)
}
assert.ok(read("web/src/styles/freebuff.css").includes(".stat-tile.stat-wide"), "le modèle le plus utilisé occupe la ligne entière")

// ── D. On n'affiche pas la version du moteur comme celle de l'app ────────────
// v11.1.0 : la barre d'état a été allégée à la demande de l'utilisateur ; le
// libellé « MOTEUR » y a disparu. La règle d'origine tient toujours — la version
// du moteur reste NOMMÉE, désormais dans l'inspecteur du Poste.
assert.match(shell, /<span>Moteur<\/span><span>\{appState\.version \|\| "—"\}<\/span>/, "l'inspecteur nomme la version du moteur")
assert.doesNotMatch(shell, /v\{appState\.version/, "plus de « v2.0.10 » présenté comme la version d'Aven")

// ── E. Aucun état interne anglais ni chemin étendu à l'écran ─────────────────
assert.match(shell, /engineStatusLabel\(appState\.status\)/, "l'inspecteur traduit l'état du moteur")
assert.doesNotMatch(shell, /\{appState\.status\}<\/span>/, "l'état brut n'est plus rendu tel quel")
assert.ok(read("web/src/display-path.ts").includes("export function displayPath"), "un formateur de chemin existe")
for (const [file, source] of [["shell", shell], ["notes", notes], ["settings", settings]]) {
  assert.match(source, /displayPath\(/, `le chemin affiché par ${file} est nettoyé`)
}
assert.ok(read("tests/display-path.test.mjs").includes("displayPath"), "le formateur est testé")

// ── F. Boutons : type explicite, une seule action primaire sur Aujourd'hui ───
function walk(dir, out = []) {
  for (const entry of readdirSync(path.join(root, dir))) {
    const relative = path.join(dir, entry)
    if (statSync(path.join(root, relative)).isDirectory()) walk(relative, out)
    else if (relative.endsWith(".tsx")) out.push(relative)
  }
  return out
}

// Balayage des balises <button> : un `>` peut vivre dans `onClick={() => …}`,
// donc on suit la profondeur des accolades et les chaînes avant de fermer la balise.
function buttonTags(source) {
  const tags = []
  let index = 0
  for (;;) {
    const start = source.indexOf("<button", index)
    if (start === -1) return tags
    let cursor = start + 7
    let depth = 0
    let quote = null
    for (; cursor < source.length; cursor++) {
      const char = source[cursor]
      if (quote) { if (char === quote && source[cursor - 1] !== "\\") quote = null; continue }
      if (char === '"' || char === "'" || char === "`") { quote = char; continue }
      if (char === "{") depth++
      else if (char === "}") depth--
      else if (char === ">" && depth === 0) break
    }
    tags.push(source.slice(start, cursor + 1))
    index = cursor + 1
  }
}

const files = walk("web/src")
const withoutType = files.flatMap((file) => buttonTags(read(file)).filter((tag) => !/\btype="button"/.test(tag)).map((tag) => `${file}: ${tag.slice(0, 60)}`))
assert.deepEqual(withoutType, [], "tout bouton hors formulaire déclare type=\"button\"")

const primaryInHome = (home.match(/className="button primary/g) ?? []).length
assert.equal(primaryInHome, 1, "Aujourd'hui garde une seule action primaire")

// ── G. Icônes sur la grille documentée (12 / 14–16 / 17 / 24 / 30) ───────────
const allowed = new Set([12, 14, 15, 16, 17, 24, 30])
const offGrid = files.flatMap((file) => [...read(file).matchAll(/<Icon\b[^>]*size=\{(\d+)\}/g)].map((m) => ({ file, size: Number(m[1]) })))
  .filter((icon) => !allowed.has(icon.size))
assert.deepEqual(offGrid, [], "aucune icône hors grille (13 px retiré)")

// ── H. Les deux familles de bouton icône suivent la règle §4 ─────────────────
assert.match(css, /\.button\.button-icon \{ width: 36px; padding: 0; \}/, ".button-icon mesure 36 px de large")
assert.match(css, /\.button\.small \{ width: 32px; height: 32px; padding: 0; \}/, ".button.small est carré")
// v11.0.1 : une marge latérale sur l'icône décentrait toute icône seule dans un
// bouton qui n'était ni .button-icon ni .small (Notes, bascule de l'inspecteur).
// L'espace icône/texte vient du `gap` de .button, jamais d'une marge asymétrique.
assert.doesNotMatch(css, /\.button[^{}]*\.app-icon[^{}]*\{[^}]*margin/, "aucune marge asymétrique sur l'icône d'un bouton")

console.log("v11.0.1 verification: OK")
