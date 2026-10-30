import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v12.3.0 : « Reprendre » devient une vraie zone — une colonne par nature
// (conversation, note, fichier), alimentée uniquement par des données réelles.
// Ce que la sonde fige, dans l'ordre du risque :
//   A. trois entrées, chacune avec nature, titre, extrait réel et âge ;
//   B. aucune entrée fabriquée : pas de note vide, pas de fichier sans chemin,
//      extrait = dernier message / début de note / chemin réel ;
//   C. le « dernier document » vient d'un historique PAR ESPACE, écrit par le host
//      quand un fichier est ouvert — pas d'invention côté renderer ;
//   D. une entrée ouvre sa vraie destination (note, fichier, conversation) ;
//   E. les actions rapides sont séparées de « Reprendre » ;
//   F. la diagonale s'efface et les anneaux tournent — une seule boucle, déclarée.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")
const exists = (p) => existsSync(path.join(root, p))

const pkg = JSON.parse(read("package.json"))
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"))
const cargo = read("src-tauri/Cargo.toml")
const home = read("web/src/workbench/HomeStage.tsx")
const shell = read("web/src/workbench/WorkbenchShell.tsx")
const filesView = read("web/src/FilesView.tsx")
const resume = read("web/src/workbench/resume.ts")
const host = read("host/aven-app-host.ts")
const recent = read("host/recent-files.ts")
const css = read("web/src/styles/workbench.css")
const readme = read("README.md")

// ── Version et enregistrement ──────────────────────────────────────────────
assert.equal(tauri.version, pkg.version, "tauri.conf.json suit package.json")
assert.match(cargo, new RegExp(`^version = "${pkg.version.replaceAll(".", "\\.")}"$`, "m"), "Cargo.toml suit package.json")
assert.equal(pkg.scripts["verify:v12.3.0"], "node scripts/verify-v12.3.0.mjs", "la sonde a son entrée npm")
assert.ok(pkg.scripts.verify.includes("scripts/verify-v12.3.0.mjs"), "npm run verify inclut la sonde v12.3.0")
assert.match(readme, new RegExp(`v${pkg.version.replaceAll(".", "\\.")} — `), "README porte la note de la version courante")

// ── A. Trois natures, trois champs lisibles ────────────────────────────────
for (const part of ["wb-home-cell", "wb-home-cell-kind", "wb-home-cell-title", "wb-home-cell-excerpt", "wb-home-cell-age"]) {
  assert.ok(home.includes(part), `la cellule expose « ${part} »`)
}
// (Les colonnes fixées par nature et l'alignement des métadonnées sont figés par
//  scripts/verify-v12.3.1.mjs — la passe de finition qui les a introduits.)
assert.match(home, /const KIND_LABEL: Record<ResumeKind, string>/, "chaque nature a son libellé, pas un identifiant technique")
assert.match(home, /entries\.length > 0 \?/, "sans entrée réelle, la zone le dit")
assert.match(home, /Aucune activité récente dans cet espace/, "l'état vide est une phrase utile, pas un faux historique")

// ── B. Aucune entrée fabriquée ─────────────────────────────────────────────
assert.match(resume, /\.filter\(\(note\) => note\.id && note\.title && cleanText\(note\.markdown\)\)/,
  "une note sans contenu n'est pas une reprise")
// « Nouvelle conversation » est le titre que le Poste donne au démarrage : vide, ce
// n'est pas un travail à reprendre (constaté à l'écran dans un espace neuf).
assert.match(resume, /const PLACEHOLDER_TITLES = new Set/, "les titres par défaut sont nommés")
assert.match(resume, /\.filter\(\(chat\) => !\(PLACEHOLDER_TITLES\.has\(chat\.title\.toLowerCase\(\)\) && !chat\.preview\)\)/,
  "une conversation vide au titre par défaut n'est jamais proposée")
assert.match(resume, /\.filter\(\(file\) => file\.path\)/, "un fichier sans chemin est écarté")
assert.match(resume, /export function excerptOf/, "l'extrait est calculé par une fonction pure")
assert.match(home, /api\.messages\(lastChatId\)/, "l'extrait d'une conversation est son dernier message RÉEL")
assert.match(home, /const last = \[\.\.\.messages\]\.reverse\(\)\.find\(\(message\) => message\.text\?\.trim\(\)\)/,
  "un message vide ne sert pas d'extrait")
assert.match(resume, /const MAX_EXCERPT = 96/, "l'extrait est borné")
// Un extrait qui répète le titre affiché ne dit rien de plus (constaté à l'écran).
assert.match(resume, /export function noteExcerpt/, "l'extrait d'une note a son calcul dédié")
assert.match(resume, /if \(first >= 0 && \/\^#\\s\+\/\.test/, "la ligne de titre qui ouvre une note n'est pas récitée")
assert.match(resume, /const dir = file\.path\.split\("\/"\)\.slice\(0, -1\)\.join\("\/"\)/, "un fichier montre son dossier, pas un chemin qui répète son nom")
assert.ok(exists("tests/resume.test.mjs") && exists("tests/recent-files.test.mjs"), "les deux modules purs ont leurs tests")

// ── C. L'historique de fichiers vit côté host, par espace ──────────────────
assert.ok(exists("host/recent-files.ts"), "le module d'historique de fichiers existe")
assert.match(recent, /^\/\/ Historique des fichiers OUVERTS dans Aven/m, "le module dit pourquoi il existe")
assert.match(recent, /\.opencode-app/, "l'historique vit dans les métadonnées de l'espace, jamais dans le renderer")
assert.match(recent, /writeJsonAtomicPretty/, "l'écriture passe par le fichier atomique (AGENTS.md §7)")
assert.match(recent, /segment === "\.\."/, "un chemin avec traversée est refusé avant d'entrer dans l'historique")
assert.match(host, /case "filesRecent":/, "le host expose la lecture de l'historique")
assert.match(host, /case "filesTouch":/, "le host enregistre une ouverture réelle")
assert.match(host, /import \{ loadRecentFiles, rememberWorkspaceFile \} from "\.\/recent-files\.js"/, "le host importe le module (aucun second chemin)")
assert.match(filesView, /void api\.filesTouch\(path\)/, "la vue Fichiers enregistre chaque ouverture")
assert.match(home, /api\.filesRecent\(\)/, "l'accueil lit l'historique réel de l'espace")
assert.match(shell, /initialPath=\{filesInitialPath\}/, "un fichier repris s'ouvre dans la vue Fichiers")
assert.match(filesView, /const initial = props\.initialPath/, "la vue Fichiers accepte le fichier demandé")

// ── D. Une entrée ouvre sa destination ─────────────────────────────────────
assert.match(home, /if \(entry\.kind === "note"\) \{ onOpenNote\(entry\.id\); return \}/, "une note s'ouvre dans Notes")
assert.match(home, /if \(entry\.kind === "file"\) \{ onOpenFile\(entry\.id\); return \}/, "un fichier s'ouvre dans Fichiers")
assert.match(home, /const chat = chats\.find\(\(c\) => c\.id === entry\.id\)/, "une conversation s'ouvre par son identifiant")
assert.match(shell, /onOpenFile=\{\(path\) => openFilesView\(path\)\}/, "le Poste transmet le chemin à la vue Fichiers")
assert.match(read("web/src/app/use-aven-app.ts"), /const openFilesView = \(initialPath\?: string\)/, "le chemin est un état de passage, pas une préférence")

// ── D bis. La reprise ne lit que l'espace réellement actif ──────────────────
assert.match(shell, /ready=\{appState\.status === "ready" && !appState\.needsWorkspace\}/,
  "l'accueil reçoit l'état réel du Poste, pas une supposition")
// AMENDEMENT v12.7.0 : le bloc « non prêt » remet aussi le chargement des notes et
// fichiers à zéro, pour ne pas annoncer un vide avant les données. La règle de
// v12.3.0 ne bouge pas — aucune lecture d'historique hors d'un espace actif — et le
// motif ne fige donc plus la mise en forme d'une seule ligne.
assert.match(home, /if \(!ready\) \{[\s\S]{0,160}?setNotes\(\[\]\)[\s\S]{0,80}?setFiles\(\[\]\)[\s\S]{0,80}?return\s*\}/,
  "hors d'un espace actif, aucune lecture d'historique n'est affichée")
assert.match(home, /\}, \[ready, lastChatId\]\)/, "l'extrait se recharge quand l'espace devient actif")

// ── E. Actions et reprise ne se mélangent pas ──────────────────────────────
const actionsAt = home.indexOf('className="wb-home-actions"')
const footAt = home.indexOf('className="wb-home-foot"')
assert.ok(actionsAt > 0 && footAt > 0 && actionsAt < footAt, "les actions rapides vivent dans la zone d'identité, pas dans la reprise")
assert.equal(home.match(/className="button ghost wb-home-action"/g)?.length, 3, "trois actions, pas une barre")
// AMENDEMENT v12.7.0 : la bande garde trois colonnes de largeur égale — les
// largeurs ne sautent pas d'un rendu à l'autre — mais seules les entrées réelles
// les occupent, une nature absente ne recevant plus de case vide.
assert.match(css, /\.wb-home-resume-list \{[^}]*grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/,
  "« Reprendre » garde trois colonnes de largeur égale")

// La bande basse est UNE zone horizontale : le libellé à gauche, les trois entrées
// à droite, sur la même ligne. Empilé, « Reprendre » redevenait un pied de page.
const footRule = css.match(/\n\.wb-home-foot \{[^}]*\}/)?.[0] ?? ""
assert.match(footRule, /display: grid/, "la bande basse est une grille, pas un empilement")
assert.match(footRule, /grid-template-columns: auto minmax\(0, 1fr\)/, "libellé et entrées partagent la même bande")
assert.match(footRule, /min-height: clamp\(84px, 12vh, 118px\)/, "la zone garde une hauteur : elle ne se comprime plus en filet")

// ── F. Diagonale discrète, une seule boucle déclarée ───────────────────────
const traceRule = css.match(/\.wb-home-trace \{[^}]*\}/)?.[0] ?? ""
assert.ok(traceRule, "la diagonale a sa règle")
// v12.3.0 : la revue visuelle la trouvait encore envahissante à .62 — elle repasse
// sous la moitié en sombre et aux deux tiers en clair, et s'efface avant les bords.
// Un PLAFOND, pas une valeur figée : la règle est « la diagonale ne domine pas »,
// et la revue l'a fait baisser deux fois (0,62 → 0,48 → 0,40).
const traceOpacity = Number(/opacity: (\.\d+)/.exec(traceRule)?.[1] ?? 1)
assert.ok(traceOpacity <= 0.42, `la diagonale reste un trait de construction (opacité ${traceOpacity})`)
assert.match(traceRule, /70%, transparent\)/, "elle s'efface avant le bord au lieu de traverser la page")
const lightTrace = /:root\[data-theme="light"\] \.wb-home-trace \{ opacity: (\.\d+); \}/.exec(css)
assert.ok(lightTrace && Number(lightTrace[1]) <= 0.3, "elle s'efface encore en thème clair")
assert.match(css, /\.wb-home-ring \{[^}]*animation: wb-home-orbit 48s linear infinite/, "les anneaux tournent lentement, en boucle déclarée")
assert.equal(css.match(/animation: wb-home-orbit/g)?.length, 1, "une seule déclaration de boucle pour les deux anneaux")
assert.match(css, /v12\.3\.0 : la rotation est une boucle AMBIANTE lente \(48 s\), déclarée/, "la boucle est justifiée dans la feuille")
assert.match(read("scripts/verify-v10.3.2.mjs"), /ambient\.length <= 7/, "le plafond de boucles a été amendé avec sa justification")
// Les particules d'anneau n'ont pas leur propre boucle : elles tournent avec l'arc.
const ringParticle = css.match(/\.wb-home-ring::after \{[^}]*\}/)?.[0] ?? ""
assert.ok(ringParticle, "les anneaux portent une particule")
assert.ok(!/animation/.test(ringParticle), "la particule ne déclare AUCUNE animation : elle suit l'anneau")
assert.equal(css.match(/wb-home-orbit/g)?.length, 2, "une keyframe et une déclaration : toujours une seule boucle")
// Les liaisons s'allument sur une phase réelle, jamais au chargement.
assert.match(css, /\.wb-home-scene\[data-phase="thinking"\] \.wb-home-link,/, "les liaisons répondent à la réflexion")
assert.match(home, /className="wb-home-link wb-home-link--a" aria-hidden="true"/, "les liaisons sont décoratives pour les technologies d'assistance")

console.log("v12.3.0 verification: OK (trois entrées réelles, historique host par espace, actions séparées)")
