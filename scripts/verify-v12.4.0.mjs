import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v12.4.0 : la sphère de l'agent devient une STRUCTURE, pas une bille éclairée.
// La référence montrait un maillage géodésique dense, des particules sur chaque
// sommet et une lumière RASANTE en haut-droite laissant le centre charbon. Ce que
// cette sonde fige, dans l'ordre où une régression se verrait :
//   A. la géométrie reste PURE et testable (aucun calcul dans le canvas) ;
//   B. la lumière est fixe, asymétrique, et n'applique jamais le yaw de la sphère ;
//   C. aucun halo, aucun dégradé radial : le volume vient du disque opaque et du
//      maillage, et le dos de la sphère n'est pas dessiné (occlusion réelle) ;
//   D. le rendu se paie en lots, pas en 15 000 traits, et le détail suit la taille ;
//   E. le thème, l'accent et le mouvement réduit sont relus à chaud ;
//   F. l'accueil et l'en-tête partagent le MÊME composant : un seul objet, deux
//      tailles.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

const pkg = JSON.parse(read("package.json"))
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"))
const cargo = read("src-tauri/Cargo.toml")
const agent = read("web/src/agent/WireframeAgent.tsx")
const sphere = read("web/src/agent/sphere.ts")
const shell = read("web/src/workbench/WorkbenchShell.tsx")
const tests = read("tests/wireframe-agent.test.mjs")
const readme = read("README.md")

// ── A. Version et enregistrement ───────────────────────────────────────────
assert.equal(tauri.version, pkg.version, "tauri.conf.json suit package.json")
assert.match(cargo, new RegExp(`^version = "${pkg.version.replaceAll(".", "\\.")}"$`, "m"), "Cargo.toml suit package.json")
assert.equal(pkg.scripts["verify:v12.4.0"], "node scripts/verify-v12.4.0.mjs", "la sonde a son entrée npm")
assert.ok(pkg.scripts.verify.includes("scripts/verify-v12.4.0.mjs"), "npm run verify inclut la sonde v12.4.0")
const version = pkg.version.replaceAll(".", "\\.")
assert.match(readme, new RegExp(`^# Aven v${version}$`, "m"), "README annonce la version courante")
assert.match(readme, new RegExp(`v${version} — `), "README porte la note de la version courante")

// ── A bis. La géométrie est PURE, et le canvas ne calcule rien ─────────────
const pure = sphere.slice(0, sphere.indexOf("export type Vec3"))
assert.match(pure, /Pur : testable avec Node seul/, "sphere.ts reste un module pur (AGENTS.md §8)")
assert.match(sphere, /export function geodesicMesh/, "la sphère a une géométrie géodésique exportée")
assert.match(sphere, /export function lightCurve/, "la courbe de lumière est une fonction pure")
assert.match(sphere, /export const AGENT_LIGHT/, "la lumière est une constante exportée")
assert.match(agent, /geodesicMesh,[\s\S]*?phaseEnergy,/, "le rendu CONSOMME la géométrie pure au lieu de la recalculer")
assert.match(agent, /const \{ mesh, dust \} = sceneFor\(detail\)/, "la scène vient du cache pur, pas d'une boucle de rendu")
// Aucune coordonnée de sphère n'est écrite à la main dans le composant.
assert.ok(!/Math\.cos\(.*\)\s*\*\s*Math\.sin\(.*\)/.test(agent), "aucune trigonométrie de surface dans le canvas")
for (const name of ["geodesicMesh", "lightCurve", "lightAt", "AGENT_LIGHT"]) {
  assert.ok(tests.includes(name), `la géométrie est testée sans canvas (${name} manquant)`)
}

// ── B. Lumière fixe, asymétrique ───────────────────────────────────────────
const light = sphere.match(/export const AGENT_LIGHT: Vec3 = unit\(\{ x: ([\d.]+), y: ([\d.]+), z: ([\d.]+) \}\)/)
assert.ok(light, "AGENT_LIGHT garde une déclaration littérale lisible")
const [lx, ly, lz] = light.slice(1, 4).map(Number)
assert.ok(lx > ly && ly > 0, "la lumière vient bien du HAUT-DROITE")
assert.ok(lz > 0 && lz < 0.7, "elle est RASANTE (z < 0,7) : sinon le centre s'allume et la sphère redevient une bille")
const norm = Math.hypot(lx, ly, lz)
for (const component of [lx, ly, lz]) assert.ok(Math.abs(component / norm) <= 1)
assert.match(agent, /const LX = AGENT_LIGHT\.x\nconst LY = AGENT_LIGHT\.y\nconst LZ = AGENT_LIGHT\.z/, "le rendu lit la constante, il n'invente pas de direction")
// La lumière s'applique à la normale TOURNÉE, avec les constantes d'écran : elle ne
// suit donc pas le yaw. Une lumière solidaire de la sphère effacerait l'asymétrie.
assert.match(agent, /const dot = x1 \* LX \+ y2 \* LY \+ z2 \* LZ/, "la lumière est évaluée dans le repère de l'écran")
assert.ok(!/light\[index\] = .*cyw/.test(agent), "le yaw ne doit jamais entrer dans l'éclairage")

// ── C. Pas de halo, pas de calotte : du volume par la matière ──────────────
assert.ok(!/createRadialGradient/.test(agent), "aucun dégradé radial : la lumière vient des particules, pas d'une lueur")
assert.ok(!/shadowBlur|shadowColor/.test(agent), "aucun flou de halo")
assert.ok(!/cap\.addColorStop/.test(agent), "la calotte opaque de la v12.0.0 ne revient pas")
assert.match(agent, /const core = withAlpha\(panel, 0\.96\)/, "le disque est opaque : le fond ne traverse plus la sphère")
// Occlusion réelle : le dos n'est pas dessiné, sinon deux réseaux se superposent.
assert.match(agent, /if \(mid <= 0\) continue/, "les arêtes du dos sont écartées")
assert.match(agent, /if \(sz\[i\] <= 0\.02\) continue/, "les particules du dos sont écartées")
// La silhouette est un cercle, jamais une ellipse « planète ».
assert.match(agent, /ctx\.arc\(0, 0, radius, 0, Math\.PI \* 2\)/, "la silhouette reste sphérique")
// Le croissant lumineux est un ARC sur le limbe, pas un remplissage.
assert.match(agent, /const limb = Math\.atan2\(-LY, LX\)/, "le croissant est orienté par la lumière réelle")
assert.match(agent, /ctx\.arc\(0, 0, radius \* 0\.995, limb - span, limb \+ span\)/, "il est tracé en arc sur le limbe")

// ── D. Lots de rendu et détail adaptatif ───────────────────────────────────
assert.match(agent, /const edgeBuckets: number\[\]\[\] = Array\.from\(\{ length: LEVELS \}, \(\) => \[\]\)/, "les arêtes sont groupées par palier d'alpha")
assert.match(agent, /bucket\.push\(sx\[a\], sy\[a\], sx\[b\], sy\[b\]\)/, "un seul chemin par palier, pas un trait par arête")
assert.match(agent, /const dustPaths: Path2D\[\]/, "les particules sont regroupées en chemins")
assert.match(agent, /ctx\.fill\(dustPaths\[level\]\)/, "un fill par palier")
assert.match(agent, /const SCENES = new Map<number, Scene>\(\)/, "les scènes sont mises en cache par niveau de détail")
assert.match(agent, /return size >= 300 \? 5 : size >= 240 \? 4 : size >= 110 \? 3 : 2/, "le détail suit la taille rendue")
assert.match(agent, /const dotScale = Math\.max\(0\.5, Math\.min\(1, radius \/ 170\)\)/, "le compact ne porte pas des points de 2 px")
assert.match(agent, /if \(now - lastDraw >= 32\)/, "la sphère ne repeint pas plus vite que 30 images/s")

// ── E. Thème, accent, mouvement réduit relus à chaud ───────────────────────
assert.match(agent, /const recolorRef = useRef<\(\(\) => void\) \| null>\(null\)/, "un repaint à la demande existe")
assert.match(agent, /attributeFilter: \["style", "class", "data-theme"\]/, "le changement de thème déclenche une relecture")
assert.match(agent, /media\.addEventListener\("change", refresh\)/, "le thème « système » est suivi aussi")
assert.match(agent, /css\.getPropertyValue\("--text"\)/, "l'encre vient du jeton --text")
assert.match(agent, /css\.getPropertyValue\("--accent"\)/, "l'accent vient du jeton --accent")
assert.match(agent, /css\.getPropertyValue\("--panel-solid"\)/, "le disque vient de --panel-solid")
// Les SEULES valeurs littérales tolérées sont les replis de readColors, quand un
// jeton manque (feuille non chargée). Partout ailleurs, une couleur en dur est une
// régression de thème, et la sonde la refuse.
const withoutTokenReader = agent.replace(/function readColors[\s\S]*?\n}\n/, "")
assert.ok(!/#[0-9a-f]{6}/i.test(withoutTokenReader.replace(/\/\/.*$/gm, "")), "aucune couleur littérale dans le rendu")
assert.match(agent, /const animate = !reduced\.matches && !document\.hidden && energy\.spin > 0/, "le mouvement réduit arrête la rotation")
assert.match(agent, /redrawRef\.current\?\.\(\)/, "un changement de phase repeint même sans boucle")

// ── F. Un seul objet, deux tailles ─────────────────────────────────────────
assert.equal(shell.match(/<WireframeAgent/g)?.length, 1, "une seule instance du canvas pour l'accueil ET l'en-tête")
assert.match(shell, /agent-home-anchor|agent-toolbar-anchor/, "les deux ancres restent mesurées")
assert.match(agent, /const detail = detailFor\(size\)/, "la taille compacte réduit la complexité, pas l'identité")
// Le composant ne capte jamais le pointeur : il est décoratif.
assert.match(agent, /aria-hidden="true"/, "le canvas reste décoratif pour l'accessibilité")

console.log("v12.4.0 verification: OK (maillage géodésique particulaire, lumière rasante fixe, occlusion, rendu en lots)")
