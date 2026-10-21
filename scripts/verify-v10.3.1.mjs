import { readApp, readStyles } from "./lib/sources.mjs"
import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"

// Sonde v10.3.1 — corrections de la revue apple-design du 2026-10-20
// (docs/audits/2026-10-20-revue-apple-design.md), lots A et B :
//   A. L'accent n'est plus une encre à l'aveugle : `--accent-ink`, `--on-accent` et
//      `--accent-fill` sont calculés par preset (module pur accent-contrast.ts) et le
//      seuil 4,5:1 est vérifié ICI, sur les 5 presets × 2 thèmes, avec une seconde
//      implémentation WCAG indépendante de celle du module.
//   B. Chorégraphie et affordances : sortie de panneau symétrique (même géométrie,
//      courbe miroir), ressort réservé au geste, morph carte ↔ page sur les QUATRE
//      destinations, micro de dictée réellement `disabled`, « Fermer » des pages à
//      hauteur de cible.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

const pkg = JSON.parse(read("package.json"))
const [vMaj, vMin, vPatch] = pkg.version.split(".").map(Number)
assert.ok(vMaj * 10000 + vMin * 100 + vPatch >= 100301, `version trop ancienne : ${pkg.version}`)

const css = readStyles()
const app = readApp()
const appearance = read("web/src/appearance.ts")
const module = read("web/src/accent-contrast.ts")
const rules = read("AGENTS.md")

// ── A1. Le module pur est branché, et rien ne décide de l'encre ailleurs ───────
assert.match(module, /^\/\/ Pur : testable avec Node seul/im, "accent-contrast.ts reste un module pur (AGENTS.md §8)")
assert.match(module, /export function accentInks\(/, "la décision des encres est une fonction pure exportée")
assert.match(appearance, /import \{ accentInks \} from "\.\/accent-contrast"/, "appearance.ts branche le module")
for (const variable of ["--accent-fill", "--accent-fill-hover", "--on-accent", "--accent-ink-light", "--accent-ink-dark"]) {
  assert.ok(appearance.includes(`root.style.setProperty("${variable}", inks.`),
    `appearance.ts pose ${variable} à partir des encres calculées`)
}

// Les tokens existent dans la feuille, avec l'aiguillage clair/sombre.
assert.match(css, /--accent-ink: var\(--accent-ink-light\);/, "l'encre d'accent suit le thème clair")
assert.match(css, /:root\[data-theme="dark"\][\s\S]{0,400}--accent-ink: var\(--accent-ink-dark\);/, "l'encre d'accent suit le thème sombre")
assert.match(css, /--on-accent: #0b0d12;/, "encre de secours posée avant la première peinture")
// AGENTS.md §3 énumère les tokens autorisés : les trois nouveaux y figurent, avec
// leur rôle (règle amendée et sonde dans le même changement).
for (const token of ["--accent-fill", "--on-accent", "--accent-ink"]) {
  assert.ok(rules.includes(`\`${token}\``), `AGENTS.md §3 cite ${token} (règle amendée v10.3.1)`)
}
assert.match(rules, /Trois rôles pour l'accent \(v10\.3\.1\)/, "AGENTS.md §3 énonce les trois rôles de l'accent")

// Plus AUCUNE encre textuelle sur l'accent brut : border-color et accent-color restent
// légitimes (traits, curseurs), `color:` ne l'est plus.
const rawAccentInk = [...css.matchAll(/(?<![-a-z])color:\s*var\(--accent\)/g)]
assert.equal(rawAccentInk.length, 0,
  "plus de `color: var(--accent)` : le texte et les icônes portent var(--accent-ink) (2,32:1 sinon)")
assert.match(css, /\.button\.primary \{[^}]*background: var\(--accent-fill\); color: var\(--on-accent\);/, "le bouton primaire peint --accent-fill et écrit avec --on-accent")
assert.match(css, /\.button\.primary:hover:not\(:disabled\) \{[^}]*background: var\(--accent-fill-hover\);/, "le survol du bouton primaire suit la variante calculée (jamais vers le blanc)")
assert.match(css, /\.msg\.user \{[^}]*background: var\(--accent-fill\);[^}]*color: var\(--on-accent\);/,
  "la bulle utilisateur suit la même paire")
assert.match(css, /\.voice-mic \{[^}]*color:var\(--on-accent\);/,
  "le micro du hub suit le remplissage accent")

// ── A2. Le seuil est VÉRIFIÉ sur les vraies valeurs produites par le module ────
// Seconde implémentation WCAG (indépendante de celle du module et des tests) : une
// erreur de formule d'un côté ne peut pas valider l'autre.
const relLum = (hex) => {
  const v = hex.replace("#", "")
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a, b) => {
  const [hi, lo] = [relLum(a), relLum(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
const blendRgb = (from, to, share) => {
  const parse = (hex) => [0, 2, 4].map((i) => parseInt(hex.replace("#", "").slice(i, i + 2), 16))
  const a = parse(from)
  const b = parse(to)
  return `#${[0, 1, 2].map((i) => Math.round(a[i] * share + b[i] * (1 - share)).toString(16).padStart(2, "0")).join("")}`
}

const PRESETS = { violet: "#8b5cf6", blue: "#3b82f6", emerald: "#10b981", rose: "#f43f5e", amber: "#f59e0b" }
const moduleUrl = pathToFileURL(path.join(root, "web/src/accent-contrast.ts")).href

/** Interroge le VRAI module (Node strip-types) — la sonde ne réinvente pas ses sorties. */
const inksOf = (accent) => {
  const code = `const m = await import(${JSON.stringify(moduleUrl)}); console.log(JSON.stringify(m.accentInks(${JSON.stringify(accent)})))`
  const out = execFileSync(process.execPath, ["--experimental-strip-types", "--no-warnings", "--input-type=module", "-e", code], {
    encoding: "utf8",
  })
  return JSON.parse(out)
}

const SOFT_LIGHT = 0.12
const SOFT_DARK = 0.16
for (const [name, accent] of Object.entries(PRESETS)) {
  const inks = inksOf(accent)
  const fillRatio = contrast(inks.onFill, inks.fill)
  assert.ok(fillRatio >= 4.5, `${name} : encre sur remplissage = ${fillRatio.toFixed(2)}:1 (≥ 4,5 exigé)`)
  const hoverRatio = contrast(inks.onFill, inks.fillHover)
  assert.ok(hoverRatio >= 4.5, `${name} : encre sur remplissage survolé = ${hoverRatio.toFixed(2)}:1 (≥ 4,5 exigé)`)
  assert.ok(hoverRatio >= fillRatio - 0.01, `${name} : le survol ne coûte pas de contraste`)

  // Surfaces réelles du thème clair : panneau plein, --bg (accent 6 % + #fbfbfd) et
  // --accent-soft (accent 12 % sur --panel-soft).
  const lightSurfaces = [
    ["panneau", "#ffffff"],
    ["--bg", blendRgb(accent, "#fbfbfd", 0.06)],
    ["--accent-soft", blendRgb(accent, "#eef0f6", SOFT_LIGHT)],
  ]
  for (const [label, surface] of lightSurfaces) {
    const ratio = contrast(inks.inkLight, surface)
    assert.ok(ratio >= 4.5, `${name} : encre claire sur ${label} = ${ratio.toFixed(2)}:1 (≥ 4,5 exigé)`)
  }

  const darkSurfaces = [
    ["panneau", "#12151d"],
    ["--bg", blendRgb(accent, "#05060a", 0.14)],
    ["--accent-soft", blendRgb(accent, "#171b24", SOFT_DARK)],
  ]
  for (const [label, surface] of darkSurfaces) {
    const ratio = contrast(inks.inkDark, surface)
    assert.ok(ratio >= 4.5, `${name} : encre sombre sur ${label} = ${ratio.toFixed(2)}:1 (≥ 4,5 exigé)`)
  }
}

// ── B1. Sortie de panneau SYMÉTRIQUE, courbe miroir, ressort réservé au geste ──
const keyframeGeometry = (name) => {
  // Les deux étapes sont sur la même ligne : on va jusqu'à la fin de la règle.
  const block = css.match(new RegExp(`@keyframes ${name} \\{([\\s\\S]*?)\\}\\r?\\n`))?.[1] ?? ""
  // L'étape qui PORTE la géométrie (l'autre vaut `transform: none`).
  const moving = [...block.matchAll(/transform:\s*([^;]+);/g)].map((m) => m[1].trim()).filter((t) => t !== "none")[0] ?? ""
  const translate = moving.match(/translateY\((-?[\d.]+)px\)/)
  const scale = moving.match(/scale\(([\d.]+)\)/)
  return { translate: Number(translate?.[1] ?? 0), scale: Number(scale?.[1] ?? 1), block, moving }
}
const enter = keyframeGeometry("dialog-in")
const exit = keyframeGeometry("dialog-out")
assert.equal(enter.translate, exit.translate,
  `entrée et sortie parcourent la même translation (${enter.translate}px vs ${exit.translate}px) — skill §7`)
assert.equal(enter.scale, exit.scale,
  `entrée et sortie parcourent la même échelle (${enter.scale} vs ${exit.scale}) — skill §7`)
assert.match(css, /--ease-out-mirror: cubic-bezier\(\.64, 0, \.78, 1\);/, "la courbe miroir est un token")
assert.match(css, /::view-transition-old\(dialog\) \{ animation-timing-function: var\(--ease-out-mirror\); \}/,
  "la sortie de panneau utilise la courbe miroir")
assert.ok(!/animation: dialog-in[^;]*--ease-spring/.test(css),
  "l'entrée d'un panneau ne rebondit plus (ressort réservé aux gestes, skill §4)")
const selbar = css.match(/\.selbar \{[^}]*\}/)?.[0] ?? ""
assert.match(selbar, /popover-in var\(--dur-fast\) var\(--ease-spring\)/,
  "la barre de sélection garde le ressort : elle naît d'un vrai geste (surlignage)")
const menu = css.match(/\.model-select-menu \{[^}]*\}/)?.[0] ?? ""
assert.ok(menu && !/--ease-spring/.test(menu), "le menu de modèle, ouvert au clic, ne rebondit pas")

// ── B2. Morph carte ↔ page sur les QUATRE cartes du hub, aller ET retour ───────
for (const [source, card, target] of [
  ["project", ".hub-card-project", ".freebuff-agent-page"],
  ["tasks", ".hub-card-agents", ".agents-page"],
  ["notes", ".hub-card-notes", ".notes-dialog"],
  ["files", ".hub-card-files", ".files-dialog"],
]) {
  assert.ok(css.includes(`[data-vt-source="${source}"] ${card.toLowerCase()}`) ||
    new RegExp(`\\[data-vt-source="${source}"\\]\\s*${card.replace(".", "\\.")}`).test(css),
    `la carte ${card} participe au morph (source « ${source} »)`)
  assert.ok(new RegExp(`\\[data-vt-source="${source}"\\][^{]*${target.replace(".", "\\.")}[^{]*\\{[^}]*view-transition-name: hub-target`).test(css),
    `la page ${target} partage le nom de transition de sa carte (source « ${source} »)`)
}
assert.match(app, /const pageSource = useRef</, "l'App retient la carte d'origine de la page")
const closeBody = app.match(/const closePage = useCallback\(\(\) => \{[\s\S]*?\n  \}, \[\]\)/)?.[0] ?? ""
assert.ok(closeBody.length > 0, "closePage est centralisée")
assert.match(closeBody, /pageSource\.current \?\? undefined/, "la fermeture rejoue le morph de la carte d'origine")
assert.match(closeBody, /withViewTransition\(\(\) => \{[\s\S]*\}, source\)/, "la source est posée avant la capture")
assert.match(app, /const openNotesView = \(initialId\?: string, source\?: "notes"\)/, "Notes accepte sa carte d'origine")
assert.match(app, /const openFilesView = \(source\?: "files"\)/, "Fichiers accepte sa carte d'origine")
assert.match(app, /openNotesView\(undefined, "notes"\)/, "la carte Notes transmet sa source")
assert.match(app, /openFilesView\("files"\)/, "la carte Fichiers transmet sa source")
assert.match(app, /openAgentsPage\("tasks"\)/, "la carte Tâches transmet sa source")
assert.match(app, /openFreebuffAgent\("project"\)/, "la carte Projet transmet sa source")
assert.match(app, /else if \(showFreebuffAgent \|\| showFiles \|\| showAgentsPage \|\| showNotes \|\| showSettings\) closePage\(\)/,
  "Échap ferme toutes les pages par le même chemin (donc avec le même morph)")
assert.match(app, /if \(showNotes \|\| showFiles \|\| showSettings \|\| showAgentsPage \|\| showFreebuffAgent\) \{\s*\n\s*pageReturnHome\.current = true\s*\n\s*closePage\(\)/,
  "« Accueil » depuis une page rejoue le retour de la page")

// ── B3. Les deux affordances ne mentent plus ───────────────────────────────────
assert.match(app, /disabled=\{!appState\.keys\.groq\}/, "le micro inactif est réellement désactivé")
assert.match(app, /"Clé Groq requise"/, "le libellé du micro nomme la cause de l'indisponibilité")
assert.match(css, /\.voice-core:disabled \{ cursor: not-allowed; \}/, "état visuel du micro inactif")
assert.match(css, /\.voice-core:disabled \.voice-mic \{ background: var\(--panel-soft\); color: var\(--muted\);/,
  "le micro éteint n'a plus le dégradé accent (le signal visuel suit l'attribut)")
assert.match(css, /\.voice-core:disabled:hover, \.voice-core:disabled:active \{ transform: translate\(-50%,-50%\);/,
  "aucun survol qui promet une action désactivée")

const pageClose = css.match(/\.page-actions \.dialog-close \{[^}]*\}/)?.[0] ?? ""
assert.ok(pageClose.length > 0, "le bouton Fermer des pages garde sa règle")
assert.ok(!/min-height:\s*0/.test(pageClose),
  "« Fermer » ne descend plus à 21 px : min-height:0 supprimait le plancher de cible (v10.3.0)")
assert.match(css, /\.dialog-close \{ width: 36px; height: 36px; min-height: 36px;/,
  "le plancher de 36 px de .dialog-close reste la référence")
assert.match(css, /\.page-action \{ min-height:34px; \}/, "les actions de page gardent 34 px de plancher")
// La cible ne doit pas seulement être haute : elle doit rester cliquable sur toute
// sa surface (width auto + padding du bouton), sans texte coupé.
assert.match(pageClose, /width:auto; height:auto;/, "le bouton garde sa largeur de contenu (libellé entier)")
assert.ok(!/height:\s*36px/.test(pageClose), "la hauteur fixe de l'icône ne revient pas sur le libellé")

console.log("v10.3.1 verification: OK (encres d'accent 5×2, panneaux symétriques, morph 4 cartes, affordances honnêtes)")
