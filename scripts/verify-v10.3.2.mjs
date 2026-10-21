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
assert.ok(ambient.length <= 6, `boucles ambiantes inattendues (${ambient.length}) — justifie ou tokenise`)
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
for (const selector of ["\\.segmented button", "\\.accent-choice", "\\.settings-tabs button", "\\.section-hint"]) {
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

// ── E. Le hub garde sa composition sans les décors redondants ──────────────────
for (const dead of [".hub-grid-glow", ".hub-crosshair"]) {
  assert.ok(!cssCode.includes(dead), `${dead} est retiré de la feuille (revue §4 P3)`)
  assert.ok(!app.includes(dead), `${dead} est retiré du rendu du hub`)
}
for (const kept of [".hub-orbit-outer", ".hub-orbit-inner", ".hub-orbit-core", ".hub-aura-1", ".hub-aura-2", ".home-hub::after"]) {
  assert.ok(cssCode.includes(kept), `${kept} reste : la constellation n'est pas appauvrie`)
}

// ── F. La cascade du hub ne détruit pas le placement des cartes ──────────────
// Constaté dans l'app réelle (WebView2, animations système ACTIVES) : `card-in`
// animait `transform` alors que `.hub-card` y range son orbite — avec `fill: both`,
// les quatre cartes restaient empilées au centre, sous le micro. Le correctif anime
// les propriétés individuelles, qui se composent.
// Le groupe d'un shared element (déplacement/redimensionnement) suit le même token
// de durée/courbe que ses deux copies : sinon le morph a deux trajectoires.
const vtGroup = cssCode.match(/::view-transition-group\(hub-target\),\s*\n::view-transition-group\(dialog\) \{[^}]*\}/)?.[0] ?? ""
assert.match(vtGroup, /animation-duration: var\(--dur-med\);/, "le groupe du morph suit --dur-med")
assert.match(vtGroup, /animation-timing-function: var\(--ease-out\);/, "le groupe du morph suit --ease-out")
const cardIn = cssCode.match(/@keyframes card-in \{[^}]*\}/)?.[0] ?? ""
assert.ok(cardIn.length > 0, "les keyframes card-in existent")
assert.ok(!/transform\s*:/.test(cardIn), "card-in n'anime pas `transform` : les cartes du hub perdraient leur orbite")
assert.match(cardIn, /translate\s*:/, "l'entrée des cartes garde sa translation (propriété individuelle)")
assert.match(cssCode, /\.hub-card \{[^}]*transform:translate\(-50%,-50%\) rotate\(var\(--hub-angle\)\) translateY/, 
  "les cartes du hub portent toujours leur placement d'orbite dans `transform`")

// ── G. La transition de vue n'attend AUCUNE frame dans son callback ──────────
// Constaté dans l'app réelle : un callback qui attend requestAnimationFrame ne se
// résout jamais (le rendu est suspendu pendant la mise à jour) — plus aucune
// transition n'animait, seul le filet de 1 s appliquait l'état. Le callback doit
// être synchrone, et App committe React avec flushSync avant la capture.
const vtSource = read("web/src/view-transitions.ts")
assert.ok(!/requestAnimationFrame\(/.test(vtSource),
  "le callback de transition de vue n'attend pas de frame (impasse mesurée : ready/finished pendantes)")
assert.match(vtSource, /startViewTransition\(\(\) => \{ apply\(\) \}\)/, "le callback reste synchrone")
assert.match(app, /import \{ flushSync \} from "react-dom"/, "App committe React de façon synchrone (flushSync)")
assert.match(app, /runViewTransition\(\(\) => flushSync\(update\), source\)/, "le wrapper applique flushSync dans le callback")

// ── H. Le chemin reduce est antérieur à l'API, donc prouvable sans navigateur ──
// Rejoué dans l'app avec le mouvement système DÉSACTIVÉ (mesures :
// docs/audits/2026-10-20-live/mesures-reduce.json) : les 4 cartes ouvrent leur page
// finalisée au premier échantillon, data-vt-source reste nul, 0 animation
// ::view-transition-*, 0 exception ; Échap / « Fermer » / « Accueil » rendent le hub
// au premier échantillon. Ce que le code doit continuer de garantir :
assert.match(vtSource, /if \(!doc \|\| typeof doc\.startViewTransition !== "function" \|\| prefersReducedMotion\(\)\) \{\s*\n\s*update\(\)\s*\n\s*return\s*\n\s*\}/,
  "reduce : update() appliqué directement et retour, AVANT toute pose de source")
assert.ok(vtSource.indexOf("prefersReducedMotion()") < vtSource.indexOf("doc.startViewTransition("),
  "le garde reduce précède l'appel à l'API (sinon une transition fantôme part sans animation)")
assert.match(vtSource, /window\.matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches/,
  "le garde lit le réglage système réel, pas une constante")
// Personne ne contourne le module : sans cela, une page pourrait lancer une transition
// (et poser data-vt-source) même sous reduce, en échappant au garde et au flushSync.
const rendererFiles = readdirSync(path.join(root, "web/src"), { recursive: true })
  .filter((f) => /\.(?:ts|tsx)$/.test(String(f)))
  .map((f) => `web/src/${String(f).replaceAll(path.sep, "/")}`)
for (const file of rendererFiles) {
  if (file === "web/src/view-transitions.ts") continue
  const code = read(file)
  assert.ok(!code.includes("startViewTransition("), `${file} n'appelle pas l'API hors du module`)
  assert.ok(!/dataset\.vtSource\s*=/.test(code), `${file} ne pose pas data-vt-source (source unique : le module)`)
}
// v10.4.0 : le wrapper a quitté App.tsx pour app/with-view-transition.ts — la promesse
// est la même, le module agrégé le contient désormais.
assert.match(app, /export function withViewTransition\(update: \(\) => void, source\?: string\) \{\s*\n\s*runViewTransition\(\(\) => flushSync\(update\), source\)/,
  "les transitions passent TOUTES par le wrapper flushSync (reduce comme animé)")

// La règle d'AGENTS.md qui encadre les durées est amendée dans le même changement.
assert.match(rules, /boucles\s+ambiantes/i, "AGENTS.md §12.4 documente l'exception des boucles ambiantes")

console.log("v10.3.2 verification: OK (motion tokenisée, Réglages lisibles, reduce immédiat, actions découvrables, hub allégé)")
