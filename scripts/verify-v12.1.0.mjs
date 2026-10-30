import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v12.1.0 : l'accueil devient un ESPACE DE TRAVAIL éditorial. Ce que la sonde fige,
// dans l'ordre du risque :
//   A. trois zones réelles (identité, scène de l'agent, ligne basse) et un titre de
//      deux lignes — le titre monumental de la v12.0.0 ne revient pas ;
//   B. « Reprendre » ne montre que des données réelles, décidées par un module pur
//      testé, et disparaît quand il n'y a rien ;
//   C. les actions rapides sont nommées pour ce qu'elles font et agissent vraiment ;
//   D. un seul statut vocal sur l'accueil ;
//   E. la scène est décorative, sans coordonnée inventée et sans capter le pointeur ;
//   F. les styles de l'accueil restent tokenisés.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")
const exists = (p) => existsSync(path.join(root, p))

const pkg = JSON.parse(read("package.json"))
const home = read("web/src/workbench/HomeStage.tsx")
const shell = read("web/src/workbench/WorkbenchShell.tsx")
const resume = read("web/src/workbench/resume.ts")
const css = read("web/src/styles/workbench.css")
const da = read("web/src/styles/da.css")
const readme = read("README.md")
const agents = read("AGENTS.md")

// ── Version et enregistrement de la sonde ──────────────────────────────────
assert.equal(pkg.scripts["verify:v12.1.0"], "node scripts/verify-v12.1.0.mjs", "la sonde a son entrée npm")
assert.ok(pkg.scripts.verify.includes("scripts/verify-v12.1.0.mjs"), "npm run verify inclut la sonde v12.1.0")
assert.match(readme, new RegExp(`^# Aven v${pkg.version.replaceAll(".", "\\.")}$`, "m"), "README annonce la version courante")
assert.match(readme, new RegExp(`v${pkg.version.replaceAll(".", "\\.")} — `), "README porte la note de la version courante")

// ── A. La composition remplace le titre plein écran ────────────────────────
assert.match(home, /className="wb-home-grid"/, "l'accueil est une grille de composition, pas un empilement centré")
for (const zone of ["wb-home-id", "wb-home-scene", "wb-home-foot"]) {
  assert.match(home, new RegExp(`className="${zone}"`), `la zone « ${zone} » existe`)
}
// AMENDEMENT v12.5.0 : le libellé « Aven / Voice workspace » était en anglais et
// disait la marque, pas l'endroit où l'on est. L'invariant conservé est celui de
// la sonde — l'accueil porte UN en-tête technique, une seule fois —, il nomme
// désormais la destination et la date réelles.
assert.match(home, /wb-home-eyebrow">Aujourd’hui · \{today\}/, "l'en-tête de l'accueil nomme la destination et la date, une seule fois")
assert.match(home, /<span>Votre espace\.<\/span>\s*<span>Votre agent\.<\/span>/, "le titre tient deux lignes courtes, dans l'ordre éditorial")
assert.ok(!home.includes("Bonjour. Je suis Aven"), "le titre monumental de la v12.0.0 ne revient pas")
assert.match(css, /\.wb-home-title span \+ span \{ color: var\(--muted\)/, "la seconde ligne recule au lieu de doubler la masse")
// Le statut vocal est DANS le bloc d'identité : une seule vérité, à côté du micro.
const voiceAt = home.indexOf('className="wb-home-voice"')
const statusAt = home.indexOf('className="wb-home-status"')
assert.ok(voiceAt > 0 && statusAt > voiceAt, "le micro et son état vivent dans le même bloc")

// ── B. « Reprendre » ne montre que du travail réel ─────────────────────────
assert.match(home, /import \{ ageLabel, resumeBoard, type ResumeEntry, type ResumeKind \} from "\.\/resume"/,
  "la sélection des entrées vient du module pur, pas d'un calcul dans le rendu")
assert.match(resume, /^\/\/ Pur : testable avec Node seul, sans dépendance desktop\./, "resume.ts se déclare pur (AGENTS.md §8)")
assert.match(resume, /export function resumeBoard/, "la sélection vit dans une fonction pure exportée")
assert.match(resume, /\.filter\(\(chat\) => chat\.id && chat\.title\)/, "une ligne sans titre ni identifiant n'est jamais reprise")
assert.match(resume, /delta < 60_000\) return "à l’instant"/, "un âge ne s'affiche jamais négatif (horloge en avance comprise)")
assert.ok(exists("tests/resume.test.mjs"), "le module pur a son test Node")
assert.match(home, /entries\.length > 0 \?/, "sans entrée réelle, la zone le dit au lieu d'inventer")
assert.ok(!/\b(lorem|exemple|exemple de)\b/i.test(home), "aucun contenu de démonstration dans l'accueil")

// ── C. Trois actions, nommées pour ce qu'elles font ────────────────────────
assert.equal(home.match(/className="button ghost wb-home-action"/g)?.length, 3, "trois actions rapides, pas une barre d'outils")
for (const label of ["Nouvelle conversation", "Dicter une note", "Parcourir les fichiers"]) {
  assert.ok(home.includes(label), `l'action « ${label} » est nommée dans l'interface`)
}
assert.ok(!home.includes("Rechercher un fichier"),
  "aucune action ne promet une recherche que la vue Fichiers n'offre pas (AGENTS.md §6)")
assert.match(shell, /onNewChat=\{\(\) => \{ void newChat\(\) \}\}/, "« Nouvelle conversation » crée réellement une conversation")
assert.match(shell, /onDictateNote=\{\(\) => \{ setCaptureRequested\(true\); openNotesView\(\) \}\}/,
  "« Dicter une note » ouvre la capture de la vue Notes")
assert.match(shell, /onBrowseFiles=\{openFilesView\}/, "« Parcourir les fichiers » ouvre la vue Fichiers")
assert.match(shell, /chats=\{app\.chats\}/, "les conversations reprises sont celles réellement chargées")
assert.match(shell, /delegation=\{TASK_MODES_UI\.find/, "le mode de délégation affiché est le mode réel")
assert.match(home, /Délégation · \{delegation\}/, "la ligne d'état nomme la délégation, sans la dupliquer ailleurs")

// ── D. Un seul statut vocal sur l'accueil ──────────────────────────────────
assert.equal(home.match(/className="wb-home-status"/g)?.length, 1, "un seul statut vocal sur l'accueil (l'avis transitoire est un autre message)")
assert.equal(home.match(/\{error \?\? voice\.label\}/g)?.length, 1, "l'état vocal est dit une seule fois")
assert.match(shell, /\{!isHome && \(/, "l'en-tête ne répète pas l'état vocal quand l'accueil le porte déjà")
assert.match(shell, /onOpenConversation=\{openHomeConversation\}/, "reprendre une conversation passe par le chemin qui la sélectionne vraiment")

// ── E. La scène est décorative et honnête ──────────────────────────────────
const sceneRule = css.match(/\.wb-home-scene \{[\s\S]*?\n\}/)?.[0] ?? ""
assert.ok(sceneRule, "la scène de l'agent a sa règle dédiée")
assert.match(sceneRule, /pointer-events: none/, "les anneaux ne captent jamais le pointeur")
assert.match(css, /\.wb-home-ring--wide \{[^}]*border-left-color: transparent/, "les anneaux restent des arcs incomplets, jamais un cadre fermé")
assert.match(css, /\.wb-home-node \{[^}]*background: var\(--accent\)/, "un seul repère d'accent autour de la sphère")
assert.match(home, /className="wb-home-ring" aria-hidden="true"/, "l'anneau est décoratif pour les technologies d'assistance")
// Aucune coordonnée, aucun cap, aucune métrique : ces données n'existent pas.
assert.ok(!/\d{1,3}°|\d{2}:\d{2}\s?[NS]\b|\bkm\b/i.test(home + css), "aucune coordonnée ni métrique inventée dans l'accueil")

// ── F. Les styles restent tokenisés ────────────────────────────────────────
const homeCssStart = css.indexOf(".wb-home {")
const homeCssEnd = css.indexOf("/* ── L'agent : un seul canvas")
assert.ok(homeCssStart > 0 && homeCssEnd > homeCssStart, "le bloc de l'accueil est localisable")
const homeCss = css.slice(homeCssStart, homeCssEnd)
assert.ok(!/font-size:\s*\d+px/.test(homeCss), "aucune taille de police en dur dans l'accueil (AGENTS.md §2)")
assert.ok(!/#[0-9a-f]{3,8}\b/i.test(homeCss), "aucune couleur en dur dans l'accueil (AGENTS.md §3)")
assert.match(css, /\.wb-app\[data-nav="open"\] \.wb-home-foot/, "quand la constellation s'ouvre, la ligne basse libère la scène")
assert.match(homeCss, /transition: opacity var\(--dur-med\) var\(--ease-out\)/, "l'effet passe par les tokens de temps (AGENTS.md §12.4)")

// Le titre éditorial reste borné : un plafond raisonnable, jamais un mur de texte.
const display = da.match(/--font-size-display: clamp\((\d+)px, min\(([\d.]+)vw, ([\d.]+)vh\), (\d+)px\)/)
assert.ok(display, "le token du titre d'accueil est borné en largeur ET en hauteur")
assert.ok(Number(display[4]) <= 96, `le titre ne redevient pas monumental (plafond mesuré : ${display[4]}px)`)
assert.match(agents, /L'accueil est une composition, pas une affiche \(v12\.1\.0\)/, "AGENTS.md dit la règle de l'accueil")

console.log("v12.1.0 verification: OK (accueil éditorial, reprise réelle, actions nommées, un seul statut)")
