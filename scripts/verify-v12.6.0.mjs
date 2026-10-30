import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v12.6.0 : quatre retours d'usage réels, figés chacun par la propriété qui les
// rend vérifiables :
//   A. la sphère s'anime plus fort PENDANT que l'utilisateur parle, sur le niveau
//      réel du micro — jamais sur un minuteur ;
//   B. supprimer/archiver une note la retire de la vue tout de suite, sans changer
//      de page ;
//   C. aucune barre de recherche ne réserve une bande permanente en bas du Poste :
//      la palette se demande (Ctrl+K) ;
//   D. la navigation s'active sur TOUT le bas du Poste et ne se referme pas au
//      moindre écart du pointeur.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

const pkg = JSON.parse(read("package.json"))
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"))
const cargo = read("src-tauri/Cargo.toml")
const readme = read("README.md")
const shell = read("web/src/workbench/WorkbenchShell.tsx")
const css = read("web/src/styles/workbench.css")
const nav = read("web/src/workbench/NavigationConstellation.tsx")
const agent = read("web/src/agent/WireframeAgent.tsx")
const sphere = read("web/src/agent/sphere.ts")
const level = read("web/src/voice-agent/level.ts")
const voice = read("web/src/voice-agent/use-voice-agent.ts")
const notes = read("web/src/NotesView.tsx")

// ── 0. Version et enregistrement ───────────────────────────────────────────
assert.equal(tauri.version, pkg.version, "tauri.conf.json suit package.json")
assert.match(cargo, new RegExp(`^version = "${pkg.version.replaceAll(".", "\\.")}"$`, "m"), "Cargo.toml suit package.json")
assert.equal(pkg.scripts["verify:v12.6.0"], "node scripts/verify-v12.6.0.mjs", "la sonde a son entrée npm")
assert.ok(pkg.scripts.verify.includes("scripts/verify-v12.6.0.mjs"), "npm run verify inclut la sonde v12.6.0")
const version = pkg.version.replaceAll(".", "\\.")
assert.match(readme, new RegExp(`^# Aven v${version}$`, "m"), "README annonce la version courante")
assert.match(readme, new RegExp(`v${version} — `), "README porte la note de la version courante")

// ── A. La sphère entend l'utilisateur ──────────────────────────────────────
// Le niveau est une MESURE du VAD, poussée une fois par trame, micro coupé = 0.
assert.match(level, /export function pushLevel/, "le niveau s'enregistre par une fonction dédiée")
assert.match(level, /export function readLevel/, "la boucle de rendu doit pouvoir le lire")
assert.match(level, /const FLOOR = 0\.0/, "un plancher existe : le bruit de fond n'anime rien")
assert.match(voice, /pushLevel\(sessionRef\.current\.micMuted \? 0 : rms\)/, "le VAD pousse le niveau réel, et zéro micro coupé")
assert.match(voice, /resetLevel\(\)/, "couper le micro éteint le mouvement")
// L'amplification vit dans un module pur, pas dans le canvas.
assert.match(sphere, /export function withInput/, "l'amplification est pure et testable")
assert.match(sphere, /capturing: \{ spin: 0\.085/, "la capture domine l'écoute : c'est le moment où l'on parle")
assert.match(agent, /withInput\(phaseEnergy\(phase\), speaking \? readLevel\(\) : 0\)/,
  "seules les phases où l'UTILISATEUR parle amplifient le mouvement")
assert.match(agent, /phase === "capturing" \|\| phase === "listening"/, "la voix de l'agent ne s'amplifie pas elle-même")
assert.match(agent, /const swell = /, "les particules portent l'énergie")
assert.ok(!/setInterval\(|requestAnimationFrame\([^)]*\)\s*;\s*\/\/ simule/.test(agent), "aucun minuteur ne simule une activité")

// ── B. Supprimer une note se voit tout de suite ────────────────────────────
assert.match(notes, /import \{ pruneNote \} from "\.\/notes-tree"/, "le retrait de l'arbre est un module pur")
assert.match(notes, /if \(removedId\) dropFromView\(removedId\)/, "la vue est mise à jour avant le rechargement disque")
assert.match(notes, /setSelected\(null\)/, "la note ouverte n'est pas laissée affichée après sa suppression")
// Chaque chemin destructeur nomme la note retirée. Un `withNote` sans identifiant
// laisserait la note à l'écran — le défaut exact de cette version.
for (const appel of ["api.noteDelete(selected.id), selected.id", "api.noteArchive(selected.id), selected.id", "api.notePurge(id), id"]) {
  assert.ok(notes.includes(appel), `suppression : « ${appel} » doit retirer la note de la vue`)
}
assert.ok(!/withNote\(\(\) => api\.note(Delete|Archive)\(selected\.id\)\)/.test(notes),
  "aucun chemin de suppression ne laisse la note affichée")

// ── C. Plus de bande de recherche permanente ───────────────────────────────
assert.match(shell, /\{commandOpen && <CommandBar app=\{app\} onDismiss=/, "la palette n'est rendue que si elle est demandée")
assert.ok(!/commandVisible/.test(shell), "l'ancien état « visible partout sauf accueil » a disparu")
assert.match(shell, /event\.key\.toLowerCase\(\) !== "k"/, "Ctrl+K reste le seul chemin vers la palette")
const commandRule = css.match(/\.wb-command \{[^}]*\}/)?.[0] ?? ""
assert.match(commandRule, /position: absolute/, "la palette flotte au lieu d'occuper une rangée")
assert.match(commandRule, /transform: translateX\(-50%\)/, "elle est centrée sur le Poste")
assert.ok(!/grid-row: 2/.test(commandRule), "elle n'appartient plus au gabarit du corps")
const bodyRule = css.match(/\.wb-body \{[^}]*\}/)?.[0] ?? ""
assert.match(bodyRule, /grid-template-rows: minmax\(0, 1fr\);/, "le corps n'a plus qu'une rangée")
assert.ok(!css.includes("--wb-command-h"), "aucune hauteur de barre ne subsiste dans les jetons")

// ── D. Tout le bas active la navigation ────────────────────────────────────
const openBand = Number(nav.match(/const OPEN_BAND_H = (\d+)/)?.[1] ?? 0)
const keepBand = Number(nav.match(/const KEEP_BAND_H = (\d+)/)?.[1] ?? 0)
const grace = Number(nav.match(/const CLOSE_GRACE_MS = (\d+)/)?.[1] ?? 0)
assert.ok(openBand >= 40, `la bande d'ouverture couvre le bas du Poste (mesuré : ${openBand}px)`)
assert.ok(keepBand > openBand, `la fermeture demande d'aller plus loin que l'ouverture (${keepBand} > ${openBand})`)
assert.ok(grace >= 400, `la fermeture attend au lieu de surprendre (mesuré : ${grace} ms)`)
assert.match(nav, /window\.addEventListener\("pointermove", onMove, \{ passive: true \}\)/,
  "l'activation se mesure au mouvement, pas au rectangle d'un élément")
assert.match(nav, /const inBand = \(clientY: number, height: number\)/, "la bande est une distance au bord inférieur")
assert.match(nav, /isContentEditable/, "écrire dans un champ n'appelle pas la navigation")
assert.ok(!/onPointerLeave=\{scheduleClose\}/.test(nav), "le moindre écart du pointeur ne referme plus l'arc")

console.log("v12.6.0 verification: OK (sphère réactive au micro, note supprimée visible, palette à la demande, bande de navigation pleine largeur)")
