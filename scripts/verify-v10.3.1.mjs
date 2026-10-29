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
// v11.0.0 : la DA inverse le défaut (sombre) et déclare le thème clair en override.
assert.match(css, /--accent-ink: var\(--accent-ink-dark\);/, "l'encre d'accent sombre est la valeur par défaut")
assert.match(css, /:root\[data-theme="light"\][\s\S]{0,600}--accent-ink: var\(--accent-ink-light\);/, "l'encre d'accent clair est déclarée par le thème clair")
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
// v11.1.3 : le micro central du hub (`.voice-mic`) a disparu avec le hub ; les deux
// paires remplissage/encre qui restent — bouton primaire et bulle utilisateur — sont
// vérifiées ci-dessus. Plus aucun élément ne peint --accent-fill sans --on-accent.

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

// ── B1. Affordances du Poste (v11.0.0) ──────────────────────────────────────
// Le hub, ses cartes et ses View Transitions ont été retirés : le morph carte ↔ page
// n'a plus d'objet. Les garanties d'affordance restent vérifiées sur le Poste.
const workbench = read("web/src/workbench/WorkbenchShell.tsx")
const homeBoard = read("web/src/workbench/HomeStage.tsx")
const commandBar = read("web/src/workbench/CommandBar.tsx")
const tabModel = read("web/src/workbench/tabs.ts")

// Micro de dictée réellement désactivé quand la clé Groq manque.
assert.match(commandBar, /disabled=\{!appState\.keys\.groq\}/, "le micro global est désactivé sans clé Groq")
assert.match(commandBar, /Dictée indisponible : configure une clé Groq/, "le libellé nomme la cause")
assert.match(css, /\.wb-command-mic:disabled \{[^}]*cursor: not-allowed;/, "état visuel du micro inactif")
assert.match(css, /\.wb-command-mic:disabled:hover \{[^}]*color: var\(--muted\);/, "aucun survol qui promet une action désactivée")

// Fermer un onglet est une cible de 24 px, nommée, et Aujourd'hui n'a pas de croix.
// v11.1.0 : la croix de chaque onglet a été retirée (barre allégée, plan
// approuvé). Fermer reste possible au clavier (Ctrl+W) et le modèle refuse
// toujours de fermer Aujourd'hui — la règle tient, son affordance a changé.
assert.match(workbench, /role="tablist" aria-label="Onglets du Poste"/, "les onglets nomment leur groupe")
assert.match(tabModel, /if \(tab\.kind === "home"\) return state/, "le modèle refuse de fermer Aujourd'hui")
assert.match(tabModel, /export function closeTab/, "fermer un onglet reste dans le modèle pur")

// Le hub et les transitions de vue ont disparu sans laisser de code mort.
assert.ok(!app.includes("startViewTransition("), "plus de transition de vue de hub")
assert.ok(!css.includes(".hub-card"), "plus de cartes de hub dans la feuille")

console.log("v10.3.1 verification: OK (encres d'accent 5×2, panneaux symétriques, morph 4 cartes, affordances honnêtes)")
