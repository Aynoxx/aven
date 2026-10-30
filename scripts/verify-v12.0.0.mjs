import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { readStyles } from "./lib/sources.mjs"

// v12.0.0 : le Poste devient « agent d'abord ». Ce que la sonde fige, dans l'ordre
// du risque de régression :
//   A. l'agent est UN canvas : même dessin à l'accueil et dans l'en-tête ;
//   B. la navigation est TEMPORAIRE : cinq nœuds indépendants, aucun rail, aucun
//      dock, aucun conteneur peint — rien ne survit à la fermeture ;
//   C. les cinq destinations viennent d'UNE table : icône, titre et surbrillance
//      ne peuvent pas diverger (jamais « Terminal » surligné sur « Notes ») ;
//   D. la constellation se rouvre depuis n'importe quel espace de travail ;
//   E. le champ forêt, la grille de points et l'orange braise sont des jetons ;
//   F. la géométrie (sphère, arc) reste pure et testée hors Tauri.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")
const exists = (p) => existsSync(path.join(root, p))

const pkg = JSON.parse(read("package.json"))
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"))
const lock = JSON.parse(read("package-lock.json"))
const cargo = read("src-tauri/Cargo.toml")
const cargoLock = read("src-tauri/Cargo.lock")
const readme = read("README.md")

const shell = read("web/src/workbench/WorkbenchShell.tsx")
const home = read("web/src/workbench/HomeStage.tsx")
const nav = read("web/src/workbench/NavigationConstellation.tsx")
const arc = read("web/src/workbench/constellation.ts")
const agent = read("web/src/agent/WireframeAgent.tsx")
const sphere = read("web/src/agent/sphere.ts")
const session = read("web/src/voice-agent/session.ts")
const frame = read("web/src/InstrumentFrame.tsx")
const da = read("web/src/styles/da.css")
const workbenchCss = read("web/src/styles/workbench.css")
const css = readStyles()

// ── Version cohérente dans tous les manifestes ───────────────────────────────
assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "package.json porte une version sémantique")
assert.equal(tauri.version, pkg.version, "tauri.conf.json suit package.json")
assert.equal(lock.version, pkg.version, "package-lock.json correspond à package.json")
assert.equal(lock.packages[""].version, pkg.version, "le paquet racine du lock est synchronisé")
assert.match(cargo, new RegExp(`^version = "${pkg.version.replaceAll(".", "\\.")}"$`, "m"), "Cargo.toml suit package.json")
assert.match(cargoLock, new RegExp(`\\[\\[package\\]\\]\\r?\\nname = "aven"\\r?\\nversion = "${pkg.version.replaceAll(".", "\\.")}"`), "Cargo.lock suit package.json")
assert.match(readme, new RegExp(`^# Aven v${pkg.version.replaceAll(".", "\\.")}$`, "m"), "README annonce la version courante")
assert.ok(pkg.scripts.verify.includes("scripts/verify-v12.0.0.mjs"), "npm run verify inclut la sonde courante")
assert.equal(pkg.scripts["verify:v12.0.0"], "node scripts/verify-v12.0.0.mjs", "la sonde a son entrée npm")

// ── A. UN canvas pour deux états, mesuré et non deviné ──────────────────────
// Deux composants séparés (un gros, un petit) divergeraient au premier
// ajustement : le repli doit être une TRANSFORMATION du même dessin.
const agentUses = shell.match(/<WireframeAgent/g) ?? []
assert.equal(agentUses.length, 1, "un seul canvas d'agent dans le Poste : le repli est une transformation, pas un second rendu")
assert.ok(!home.includes("WireframeAgent"), "l'accueil ne rend pas sa propre sphère : il réserve seulement l'ancre")
assert.match(home, /id="agent-home-anchor"/, "l'accueil porte une ancre réelle pour la sphère")
assert.match(shell, /id="agent-toolbar-anchor"/, "l'en-tête porte l'ancre compacte de la même sphère")
assert.match(shell, /const AGENT_CANVAS = 340/, "le diamètre du canvas est une constante partagée")
assert.match(shell, /getBoundingClientRect\(\)/, "le repli MESURE l'ancre courante (aucun rectangle deviné)")
assert.match(shell, /requestAnimationFrame\(measure\)/, "la mesure attend le rendu, sinon l'ancre n'existe pas encore")

const layerRule = workbenchCss.match(/\.aven-agent-layer \{[\s\S]*?\n\}/)?.[0] ?? ""
assert.ok(layerRule, "le calque de l'agent a sa règle dédiée")
assert.match(layerRule, /position: fixed/, "le calque traverse l'en-tête et la scène sans être rogné")
assert.match(layerRule, /pointer-events: none/, "le calque décoratif ne capte jamais le clic")
assert.match(layerRule, /transition: transform var\(--dur-slow\) var\(--ease-out\)/, "le repli passe par les tokens de temps (AGENTS.md §12.4)")
assert.match(layerRule, /transform-origin: top left/, "le scale part du coin que le JS positionne, sinon la sphère atterrit à côté")
assert.match(layerRule, /z-index: 6/, "l'agent passe AU-DESSUS de l'en-tête le temps du repli")
assert.match(workbenchCss, /\.wb-status \{[^}]*z-index: 5/, "l'en-tête reste sous l'agent, au-dessus de la scène")

// ── B. La navigation est temporaire : aucune structure permanente ───────────
assert.ok(!shell.includes("wb-rail"), "aucun rail permanent dans le Poste (brief §2 et §4)")
assert.ok(!css.includes(".wb-dock"), "aucun dock : les cercles flottent indépendamment")
assert.ok(!css.includes(".wb-rail"), "aucune règle de rail ne survit dans les styles (jeton mort compris)")
// La poignée est rendue par le composant, HORS de la scène : elle survit aux
// changements d'instrument et n'est jamais rognée par un défilement.
const navAt = shell.indexOf("<NavigationConstellation")
const mainCloseAt = shell.indexOf("</main>")
assert.ok(navAt > 0 && mainCloseAt > 0 && navAt > mainCloseAt, "la constellation vit hors de la scène")
assert.ok(!/navOpen &&\s*<NavigationConstellation/.test(shell), "la constellation n'est pas conditionnée par son ouverture : la poignée reste")
// La poignée précède l'arc dans le DOM : Tab part de la poignée et entre dans les
// cercles au lieu de sauter par-dessus le panneau.
const triggerAt = nav.indexOf('className="wb-nav-trigger"')
const arcAt = nav.indexOf('id="wb-nav-arc"')
assert.ok(triggerAt > 0 && arcAt > 0 && triggerAt < arcAt, "la poignée passe avant l'arc dans l'ordre de tabulation")
assert.match(nav, /aria-expanded=\{open\}/, "la poignée annonce l'état du panneau")
assert.match(nav, /aria-controls=\{open \? "wb-nav-arc" : undefined\}/, "la poignée ne référence l'arc que lorsqu'il existe")

const navRule = workbenchCss.match(/\.wb-nav \{[\s\S]*?\n\}/)?.[0] ?? ""
assert.ok(navRule, "la constellation a sa règle dédiée")
assert.match(navRule, /position: absolute/, "la constellation est ancrée sur le corps, pas sur la fenêtre (un bandeau d'état décalait la poignée)")
assert.match(navRule, /bottom: calc\(var\(--wb-command-h\) \+ 2px\)/, "la poignée reste juste au-dessus de la barre de commande, jamais dessus")
assert.ok(shell.indexOf("<NavigationConstellation") > shell.indexOf("<CommandBar"), "la constellation est rendue dans le corps, après la barre de commande")

const nodeRule = workbenchCss.match(/\.wb-nav-node \{[\s\S]*?\n\}/)?.[0] ?? ""
assert.match(nodeRule, /position: absolute/, "chaque cercle est positionné indépendamment (aucun conteneur commun)")
assert.match(nodeRule, /transform: translateX\(-50%\)/, "le cercle est centré sur son point d'arc, sans translation verticale parasite")
const arcRule = workbenchCss.match(/\.wb-nav-arc \{[\s\S]*?\n\}/)?.[0] ?? ""
assert.ok(arcRule, "l'arc a sa règle dédiée")
assert.ok(!/background/.test(arcRule), "l'arc ne peint RIEN : pas d'ovale, pas de dock derrière les cercles")
assert.match(arcRule, /pointer-events: none/, "l'arc ne capte que ses cercles, jamais le contenu dessous")
assert.match(workbenchCss, /@keyframes wb-nav-out \{[\s\S]*?var\(--exit-x\)/, "les cercles non choisis s'écartent vers les bords en sortant")
assert.match(nav, /node\.exitX/, "l'écart de sortie vient de la géométrie pure, pas d'une valeur recopiée")

// ── C. Une seule table de destinations ─────────────────────────────────────
const order = ["conversation", "notes", "files", "terminal", "orchestration"]
let cursor = 0
for (const kind of order) {
  const at = shell.indexOf(`kind: "${kind}"`, cursor)
  assert.ok(at > cursor, `destination « ${kind} » présente dans l'ordre stable (${order.join(" → ")})`)
  cursor = at
}
assert.match(shell, /const activeSection = DESTINATIONS\.find\(\(d\) => d\.kind === activeKind\)/,
  "l'icône et le titre de l'en-tête viennent de la MÊME table que les cercles")
assert.match(nav, /aria-current=\{current \? "page" : undefined\}/, "le cercle courant est annoncé (aria-current)")
assert.match(nav, /const current = destination\.kind === activeKind/, "la surbrillance suit la destination réelle, jamais un index")
assert.match(shell, /<h1 className="wb-section-title">\{activeSection\.label\}<\/h1>/, "le titre de section est la même vérité que le cercle")
// Les cinq libellés sont ceux de l'interface française, jamais des identifiants.
for (const label of ["Conversations", "Notes", "Fichiers", "Terminal", "Orchestration"]) {
  assert.ok(shell.includes(`label: "${label}"`), `libellé français « ${label} » dans la table`)
}

// ── D. Rouvrir la constellation depuis un espace de travail ────────────────
assert.match(shell, /event\.key !== "Escape"/, "Échap ferme la constellation")
assert.match(shell, /setNavOpen\(false\)/, "Échap rend bien la main (aucun panneau fantôme)")
assert.match(shell, /addEventListener\("keydown", onKey, true\)/, "Échap est capté avant le reste du Poste : un panneau ouvert ne reste pas derrière")
assert.match(nav, /onPointerEnter=\{\(\) => \{ focusOnOpen\.current = false; cancelClose\(\); onOpen\(\) \}\}/,
  "le survol ouvre, sans voler le focus clavier")
assert.match(nav, /onPointerLeave=\{scheduleClose\}/, "le pointeur qui quitte un cercle referme : pas de panneau orphelin")
assert.match(nav, /const CLOSE_GRACE_MS = 170/, "la grâce anti-scintillement entre poignée et cercles existe")
assert.match(nav, /event\.key === "ArrowRight"/, "les cercles se parcourent aux flèches")
assert.match(nav, /aria-label=\{destination\.label\}/, "chaque cercle icône porte son nom accessible")

// ── E. Le champ forêt et la grille de points sont des jetons ────────────────
assert.match(da, /--bg: #0b100e;/, "le fond forêt du brief est un jeton")
assert.match(da, /--border-strong: #46534b;/, "les filets prennent le gris-vert du brief")
assert.match(da, /--font-display: "Bahnschrift SemiCondensed"/, "la condensée du brief est une pile SYSTÈME (aucun téléchargement)")
// v12.0.0 : la valeur exacte du clamp est un réglage graphique, pas un contrat ;
// l'invariant est qu'il soit BORNÉ (plancher + plafond, borné par la largeur ET par
// la hauteur, pour ne jamais pousser la sphère hors scène). Figer le littéral cassait
// la sonde au premier ajustement de composition (leçon v10.2.1) — et c'est arrivé en
// v12.1.0, où le titre monumental devient un titre éditorial.
assert.match(da, /--font-size-display: clamp\(\d+px, min\([\d.]+vw, [\d.]+vh\), \d+px\)/, "le titre d'accueil a son token dédié, borné en largeur et en hauteur")
assert.match(workbenchCss, /\.wb-home-title \{[^}]*font-family: var\(--font-display\)[^}]*font-size: var\(--font-size-display\)[^}]*text-align: left/, "le grand titre utilise la voix condensée, aligné à gauche, nulle part ailleurs")
assert.match(workbenchCss, /\.wb-app::after \{[^}]*border: 1px solid var\(--border-strong\)[^}]*pointer-events: none/, "le cadre de fenêtre est un filet 1 px transparent au pointeur")
assert.match(workbenchCss, /\.wb-nav-word \{[^}]*max-width: 0/, "au repos le repère n'est qu'un symbole, pas un bouton libellé")
assert.match(workbenchCss, /\.wb-nav-arc\[data-leaving="true"\] \.wb-nav-node\[data-chosen="true"\] \.wb-nav-circle \{[^}]*transform: scale\(1\.1\)/, "le cercle choisi devient le point focal avant la dispersion")
assert.match(da, /--accent: #d77a43;/, "l'orange braise du brief est un jeton")
assert.match(da, /--grid-dot:/, "la grille de points a son jeton")
assert.match(workbenchCss, /radial-gradient\(circle, var\(--grid-dot\) 1px, transparent 1px\)/, "la grille est un motif CSS, pas une image")
assert.match(workbenchCss, /\.wb-main \{[^}]*grid-template-rows: minmax\(0, 1fr\);/, "la scène occupe la rangée unique quand aucun bandeau de sessions n'existe")
assert.match(workbenchCss, /\.wb-status \{[^}]*grid-template-columns: minmax\(0, 1fr\) auto minmax\(0, 1fr\)/, "l'agent compact est centré sur la FENÊTRE, pas sur l'espace restant")
assert.match(shell, /className="wb-agent-anchor"/, "l'ancre compacte a une taille réelle, mesurable")
assert.match(frame, /instrument-compact/, "le cadre d'instrument sait ne pas répéter le titre que l'en-tête porte déjà")
for (const view of ["NotesView.tsx", "FilesView.tsx", "FreebuffAgentPage.tsx", "pages/TasksPage.tsx", "SettingsDialog.tsx"]) {
  assert.match(read(`web/src/${view}`), /compact/, `${view} se déclare compact : le titre de section n'est pas affiché deux fois`)
}
assert.match(shell, /data-motion=\{reducedMotion \? "instant" : "smooth"\}/, "le repli est instantané en mouvement réduit")
assert.match(workbenchCss, /data-motion="instant"\] \{ transition-duration: \.01ms/, "le mouvement réduit neutralise la transition du calque")

// ── F. La géométrie reste pure et testée ──────────────────────────────────
assert.ok(exists("web/src/agent/sphere.ts") && exists("tests/wireframe-agent.test.mjs"), "la sphère a son module et ses tests")
assert.match(sphere, /Pur : testable avec Node seul, sans dépendance desktop/, "sphere.ts se déclare pur (AGENTS.md §8)")
assert.match(agent, /from "\.\/sphere"/, "le composant ne calcule aucune géométrie : il peint")
assert.ok(exists("web/src/workbench/constellation.ts") && exists("tests/constellation.test.mjs"), "l'arc a son module et ses tests")
assert.match(arc, /Pur : testable avec Node seul/, "constellation.ts reste pur")
assert.match(agent, /prefers-reduced-motion: reduce/, "le canvas s'arrête en mouvement réduit")
assert.match(agent, /document\.hidden/, "le canvas s'arrête quand la fenêtre est masquée : aucune animation payée pour rien")
assert.match(agent, /aria-hidden="true"/, "le canvas est décoratif : l'état est DIT par le texte du bandeau")
// Les phases affichées sont celles de la session réelle — aucune inventée.
for (const phase of ["muted", "listening", "capturing", "transcribing", "thinking", "speaking", "error"]) {
  assert.ok(sphere.includes(`"${phase}"`), `la phase « ${phase} » existe dans sphere.ts`)
  assert.ok(session.includes(`"${phase}"`), `la phase « ${phase} » est bien celle de la session vocale réelle`)
}

console.log("v12.0.0 (Poste agent d'abord, constellation temporaire) : OK")
