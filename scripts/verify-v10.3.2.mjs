import { readApp, readStyles } from "./lib/sources.mjs"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Sonde v10.3.2 — lot P3 de la revue apple-design du 2026-10-20
// (docs/audits/2026-10-20-revue-apple-design.md §4) :
//   A. Les tokens de motion ne sont plus décoratifs : tout temps de RÉPONSE passe par
//      --dur-* / --ease-*. Seules les boucles ambiantes gardent une durée littérale,
//      et c'est dit.
//   B. Réglages : les libellés de contrôle quittent `xs` (micro-labels) pour `sm`,
//      avec une interligne fixée — la hiérarchie se lit au poids, pas à 1 px près.
//   C. prefers-reduced-motion remet AUSSI les délais à zéro (état final immédiat),
//      au lieu de dépendre d'une liste d'exceptions par animation.
//   D. Les actions de conversation sont découvrables au CLAVIER, pas seulement au
//      survol (mesuré avant la correction : opacité 0,15 avec et sans focus).
//   E. Le hub retire deux décors sur huit qui doublaient les orbites.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

const pkg = JSON.parse(read("package.json"))
const [vMaj, vMin, vPatch] = pkg.version.split(".").map(Number)
assert.ok(vMaj * 10000 + vMin * 100 + vPatch >= 100302, `version trop ancienne : ${pkg.version}`)

const css = readStyles()
const app = readApp()
const rules = read("AGENTS.md")
// Les commentaires expliquent (ils citent parfois une déclaration) : toute règle se
// vérifie sur la feuille SANS commentaires, sinon une phrase suffirait à faire passer.
const cssCode = css.replace(/\/\*[\s\S]*?\*\//g, "")

// ── A. Tokens de motion réellement utilisés ────────────────────────────────────
// Une déclaration = tout ce qui suit `transition:` jusqu'au `;`. Aucune ne doit
// porter de durée en clair : sinon régler --dur-fast ne change rien à l'écran.
const declarations = (property) => [...cssCode.matchAll(new RegExp(`${property}\\s*:\\s*([^;}]+[;])`, "g"))].map((m) => m[1].trim())
const transitions = declarations("transition")
assert.ok(transitions.length >= 15, `inventaire des transitions inattendu (${transitions.length})`)
for (const value of transitions) {
  assert.match(value, /var\(--dur-(?:fast|med|slow)\)/,
    `transition sans token de durée : « ${value} » — utilise var(--dur-fast|med|slow) (AGENTS.md §2/§11)`)
  assert.match(value, /var\(--ease-/, `transition sans token de courbe : « ${value} » — utilise var(--ease-out|spring|out-mirror)`)
  // Un token PRÉSENT ne suffit pas : quatre règles mélangeaient encore `var(--ease-out)`
  // et un `ease` nu dans la même déclaration — la moitié de la transition ignorait le
  // réglage. Chaque fonction de temporisation doit être un token.
  assert.ok(!/(?:^|[\s,])ease(?:[\s,;]|$)/.test(value),
    `courbe système à côté du token dans « ${value} » — toutes les propriétés suivent var(--ease-*)`)
}

// Les animations FINIES suivent la même règle ; les boucles ambiantes (infinite) sont
// l'exception documentée : une boucle n'est pas un temps de réponse.
const animations = declarations("animation").filter((value) => !/^\s*none\b/.test(value))
for (const value of animations) {
  if (/\binfinite\b/.test(value)) continue
  assert.match(value, /var\(--dur-(?:fast|med|slow)\)/,
    `animation finie sans token de durée : « ${value} »`)
  assert.match(value, /var\(--ease-/, `animation finie sans token de courbe : « ${value} »`)
}
const ambient = animations.filter((value) => /\binfinite\b/.test(value))
assert.ok(ambient.length >= 4, "les boucles ambiantes (pulse, présence, dictée, shimmer) restent déclarées")
// v12.3.0 : plafond porté de 6 à 7 pour UNE boucle demandée explicitement — la
// rotation lente des anneaux de l'accueil (48 s), qui dit « le système vit ».
// Ce n'est pas une permission générale : une huitième boucle doit être justifiée
// ici, dans le même changement, pas ajoutée en silence.
assert.ok(ambient.length <= 7, `boucles ambiantes inattendues (${ambient.length}) — justifie ou tokenise`)
assert.match(css, /boucles AMBIANTES/, "l'exception des boucles est expliquée dans la feuille (pas implicite)")
// Les durées gardent UNE définition chacune : pas de valeur en double dans le fichier.
for (const token of ["--dur-fast", "--dur-med", "--dur-slow"]) {
  const definitions = [...css.matchAll(new RegExp(`${token}:`, "g"))].length
  assert.equal(definitions, 1, `${token} ne doit être défini qu'une fois (${definitions})`)
}
assert.ok((css.match(/var\(--dur-fast\)/g) ?? []).length >= 20,
  "les micro-interactions consomment réellement --dur-fast (le token n'est plus décoratif)")

// ── B. Hiérarchie typographique des Réglages ───────────────────────────────────
assert.match(cssCode, /\.setting-row, \.toggle-row \{[^}]*font-size: var\(--font-size-sm\)[^}]*line-height: 1\.35;/,
  "les libellés de contrôle passent en sm avec une interligne fixée (AGENTS.md §2)")
assert.ok(!/\.setting-row, \.toggle-row \{[^}]*font-size: var\(--font-size-xs\)/.test(cssCode),
  "plus de libellé de contrôle en 11 px (micro-labels)")
// v11.1.3 : `.settings-tabs button` a disparu avec les onglets de la modale de réglages —
// les Réglages sont un instrument du Poste, la navigation vit dans l'inspecteur (sondée
// par v11.0.0). La règle « libellé de contrôle en sm » reste vérifiée sur les contrôles
// qui existent encore.
for (const selector of ["\\.segmented button", "\\.accent-choice", "\\.section-hint"]) {
  const rule = cssCode.match(new RegExp(`${selector} \\{[^}]*\\}`))?.[0] ?? ""
  assert.ok(rule.length > 0, `règle ${selector} présente`)
  assert.match(rule, /font-size: var\(--font-size-sm\)/, `${selector} : libellé de contrôle en sm`)
}
assert.match(cssCode, /\.section-title \{[^}]*font-size: var\(--font-size-md\)[^}]*font-weight: 800;/,
  "un titre de section se distingue des libellés par la TAILLE (md vs sm), pas seulement par le poids")
assert.match(cssCode, /\.settings-pane > h4 \{[^}]*font-weight: 800;/,
  "les h4 des onglets Configuration/Usage portent le même poids que .section-title (même rôle)")
assert.match(cssCode, /\.slider-row > span \{[^}]*justify-content: space-between;/,
  "la valeur d'un curseur se cale au bord droit, plus collée au libellé")
assert.match(cssCode, /\.setting-row b \{[^}]*font-variant-numeric: tabular-nums;/, "valeur en chiffres tabulaires")

// ── C. reduced-motion : état final immédiat, pas au cas par cas ────────────────
const reduce = css.match(/@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?\n\}/)?.[0] ?? ""
assert.ok(reduce.length > 0, "le bloc prefers-reduced-motion global reste en place (AGENTS.md §12.4)")
assert.match(reduce, /animation-delay:0s !important;/, "les délais d'animation sont remis à zéro sous reduce")
assert.match(reduce, /transition-delay:0s !important;/, "les délais de transition sont remis à zéro sous reduce")
assert.match(reduce, /animation-duration:\.01ms !important;/, "les durées d'animation restent neutralisées")
assert.match(reduce, /transition-duration:\.01ms !important;/, "les durées de transition restent neutralisées")

// ── D. Actions de conversation découvrables ────────────────────────────────────
const chatActions = cssCode.match(/\.chat-actions button \{[^}]*\}/)?.[0] ?? ""
assert.ok(chatActions.length > 0, "la règle des actions de conversation existe")
const restOpacity = Number(chatActions.match(/opacity:\s*(\.\d+)/)?.[1] ?? 0)
assert.ok(restOpacity >= 0.3, `opacité au repos ${restOpacity} — sous .3 les actions sont invisibles (mesuré : .15)`)
assert.match(cssCode, /\.chat:hover \.chat-actions button, \.chat\.active \.chat-actions button, \.chat:focus-within \.chat-actions button \{ opacity: 1; \}/,
  "le clavier révèle les actions comme le survol (:focus-within)")
assert.match(cssCode, /\.chat-actions button\.armed \{ opacity: 1;/, "l'état armé reste pleinement visible")

// ── E. Les décors et transitions du hub ont été RETIRÉS avec lui (v11.0.0) ─────
// La sonde historique ne peut plus vérifier une constellation qui n'existe plus ;
// elle vérifie que la suppression est complète, sans fantôme dans le rendu ni CSS.
for (const dead of [".hub-grid-glow", ".hub-crosshair", ".hub-orbit-outer", ".hub-card "]) {
  assert.ok(!cssCode.includes(dead), `${dead} est retiré de la feuille (hub supprimé en v11.0.0)`)
}
assert.ok(!app.includes("startViewTransition("), "plus aucune transition de vue de hub")
assert.ok(!readdirSync(path.join(root, "web/src")).includes("view-transitions.ts"),
  "le module de transition de vue a disparu avec le hub")

// ── F. La cascade restante n'anime jamais `transform` sur un élément positionné ─
// card-in anime translate/scale (propriétés individuelles), pas transform.
const cardIn = cssCode.match(/@keyframes card-in \{[^}]*\}/)?.[0] ?? ""
assert.ok(cardIn.length > 0, "les keyframes card-in existent (Orchestration)")
assert.ok(!/transform\s*:/.test(cardIn), "card-in n'anime pas `transform`")
assert.match(cardIn, /translate\s*:/, "l'entrée garde sa translation (propriété individuelle)")
assert.match(cssCode, /\.tasks-principal-card \{[^}]*animation: card-in/, "les modes utilisent la cascade tokenisée")

// La règle d'AGENTS.md qui encadre les durées est amendée dans le même changement.
assert.match(rules, /boucles\s+ambiantes/i, "AGENTS.md §12.4 documente l'exception des boucles ambiantes")

console.log("v10.3.2 verification: OK (motion tokenisée, Réglages lisibles, reduce immédiat, actions découvrables, hub retiré)")
