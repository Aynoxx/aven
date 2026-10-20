import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Sonde v10.3.0 — quatre conventions NOUVELLES et stables, figées ici :
//   A. Toutes les sections principales sont des PAGES pleines issues de `PageShell`
//      (AGENTS.md §6), sans défilement global.
//   B. Le CLI Freebuff est vérifié/installé par UN gestionnaire, au démarrage.
//   C. Le terminal Freebuff est un vrai PTY : entrées clavier ET redimensionnement.
//   D. L'icône Windows est dérivée du logo du frontend (étoile), multi-tailles.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")
const has = (p) => existsSync(path.join(root, p))

const css = read("web/src/App.css")
const app = read("web/src/App.tsx")
const notes = read("web/src/NotesView.tsx")
const files = read("web/src/FilesView.tsx")
const settings = read("web/src/SettingsDialog.tsx")
const freebuff = read("web/src/FreebuffAgentPage.tsx")
const pageShell = read("web/src/PageShell.tsx")
const agents = read("AGENTS.md")
const host = read("host/aven-app-host.ts")
const manager = read("host/freebuff-cli-manager.ts")
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"))

// ── A. Pages pleines (AGENTS.md §6) ─────────────────────────────────────────────
// Une seule charpente : la barre supérieure est déclarative (actions par page).
assert.match(pageShell, /export default function PageShell/, "PageShell est la charpente commune des pages")
assert.match(pageShell, /className="page-topbar"/, "la barre supérieure est commune")
assert.match(pageShell, /role="toolbar" aria-label=/, "la barre d'actions est nommée (accessibilité)")

for (const [name, source] of [["Notes", notes], ["Fichiers", files], ["Réglages", settings], ["Tâches", app], ["Freebuff", freebuff]]) {
  assert.match(source, /<PageShell|import PageShell/, `la page ${name} utilise la charpente PageShell`)
}
// Aucun de ces écrans n'est plus un dialogue superposé : c'est la cause racine
// (« impression de fenêtre contextuelle ») et non un simple ajustement visuel.
for (const [name, source] of [["Notes", notes], ["Fichiers", files], ["Réglages", settings]]) {
  assert.ok(!/className="overlay"/.test(source), `la page ${name} n'est plus un overlay`)
  assert.ok(!/className="dialog[ "]/.test(source), `la page ${name} n'est plus un dialogue`)
}

// Une page n'est PAS un calque posé sur l'accueil : Notes, Fichiers et Réglages
// quittent le hub comme Tâches/Projet. Sinon la barre de fenêtre restait masquée
// (`.window-chrome-home`) et la page n'avait pas la même hauteur que les autres.
// Fermer rend l'écran d'origine (hub si la page a été ouverte du hub).
assert.match(app, /const pageReturnHome = useRef\(false\)/, "une page retient l'écran d'où elle vient")
assert.match(app, /if \(pageReturnHome\.current\) \{ pageReturnHome\.current = false; setShowHome\(true\) \}/, "fermer une page rend l'écran d'origine")
for (const [fn, label] of [["openNotesView", "Notes"], ["openFilesView", "Fichiers"], ["openConfiguration", "Réglages"]]) {
  const body = app.match(new RegExp(`const ${fn} = [\\s\\S]*?\\n  \\}`))?.[0] ?? ""
  assert.ok(body.length > 0, `${label} : l'ouverture de page est centralisée`)
  assert.match(body, /pageReturnHome\.current = .*showHome/, `${label} : la page retient d'où elle vient`)
  assert.match(body, /setShowHome\(false\)/, `${label} : la page remplace le hub (barre de fenêtre visible)`)
}
assert.match(css, /\.window-chrome\.window-chrome-home \{ display: none; \}/, "la barre de fenêtre ne se masque que sur le hub")

// Défilement : la fenêtre ne défile jamais, le corps de page non plus ; seuls les
// conteneurs internes (liste, éditeur, terminal) défilent.
assert.match(css, /body \{ margin: 0; overflow: hidden;/, "la fenêtre ne défile pas globalement")
assert.match(css, /\.page-main \{[^}]*overflow:hidden/, "une page pleine ne défile pas")
assert.match(css, /\.page-body \{[^}]*overflow:hidden/, "le corps de page ne défile pas")
assert.match(css, /\.page-body \.notes-layout, \.page-body \.files-layout \{ flex:1; min-height:0; height:100%/, "les listes internes gardent leur propre défilement")

// Règle permanente écrite dans AGENTS.md (et non seulement dans le code).
assert.match(agents, /occupant l'intégralité de la surface de contenu/, "AGENTS.md §6 énonce la règle des pages pleines")
assert.match(agents, /défiler globalement ; tout défilement nécessaire/, "AGENTS.md §6 énonce l'absence de défilement global")

// Le flou au survol des cartes du hub : `scale()` + `will-change` étaient la cause.
const hubCard = css.match(/\.hub-card \{[\s\S]*?\}/)?.[0] ?? ""
const hubHover = css.match(/\.hub-card:hover \{[^}]*\}/)?.[0] ?? ""
assert.ok(hubHover.length > 0, "la règle de survol des cartes existe toujours")
assert.ok(!/scale\(/.test(hubCard) && !/scale\(/.test(hubHover), "aucun scale() au survol des cartes (cause du texte flou)")
assert.ok(!/will-change/.test(hubCard), "plus de will-change sur les cartes (rastérisation fractionnaire = flou)")

// ── B. CLI Freebuff : un seul gestionnaire, au démarrage ────────────────────────
assert.ok(has("host/freebuff-cli-manager.ts"), "le gestionnaire du CLI existe")
assert.match(manager, /export function createCliManager/, "le gestionnaire est exporté et testable sans Tauri")
assert.match(manager, /if \(inflight\) return inflight/, "le singleton empêche deux installations concurrentes")
assert.match(host, /import \{ createCliManager \}/, "le host branche le gestionnaire unique")
assert.match(host, /freebuff\.cli\.state/, "l'état du CLI remonte au renderer (progression visible)")
assert.match(app, /api\.freebuffCliEnsure\(\)/, "le démarrage de l'app vérifie/installe le CLI")
assert.match(app, /freebuff\.cli\.state/, "l'app écoute la progression de l'installation")
// Plus AUCUNE installation lancée depuis le renderer : elles se marchaient dessus.
assert.ok(!/freebuffCliLaunch\("install"\)/.test(app + freebuff + settings), "plus d'installation lancée depuis une page")
assert.match(freebuff, /api\.freebuffCliEnsure\(\)/, "la page Projet lit l'état partagé au lieu d'installer")

// ── C. Terminal Freebuff : PTY réellement bidirectionnel ───────────────────────
assert.match(freebuff, /term\.onData\(\(data\) => \{[\s\S]{0,120}freebuffPtyInput/, "chaque frappe part vers le PTY")
assert.match(freebuff, /term\.onResize\(\(\{ cols, rows \}\) => \{[\s\S]{0,120}freebuffPtyResize/, "le redimensionnement atteint le process")
assert.match(host, /case "freebuffPtyInput"/, "le host relaie les frappes au PTY")
assert.match(host, /case "freebuffPtyResize"/, "le host relaie les dimensions au PTY")
// Le composeur maison n'existe plus : il ne doit pas revenir comme substitut.
assert.ok(!/composer/.test(freebuff), "aucune barre de saisie maison ne double le terminal")
// Le clavier appartient au terminal dès qu'il a le focus (sinon Entrée/Échap sont volés).
assert.match(app, /closest\?\.\("\.bridge-term-host"\)\) return/, "les raccourcis de l'app cèdent le clavier au terminal")

// ── D. Icône Windows dérivée du logo du frontend ───────────────────────────────
assert.ok(has("web/public/icons/brand-mark.svg"), "le logo du frontend existe")
assert.match(read("web/public/icons/brand-mark.svg"), /<path fill="#fff"/, "le logo porte bien l'étoile blanche")
assert.ok(has("src-tauri/icons/icon.ico"), "l'icône Windows existe")
assert.deepEqual(tauri.bundle.icon, ["icons/icon.ico"], "le packaging Tauri utilise cette icône unique")
assert.ok(has("scripts/build-app-icon.mjs"), "l'icône est reproductible depuis la source SVG")
const iconScript = read("scripts/build-app-icon.mjs")
assert.match(iconScript, /brand-mark\.svg/, "le générateur lit le logo du frontend")
assert.match(iconScript, /const SIZES = \[16, 20, 24, 32, 48, 64, 128, 256\]/, "toutes les tailles Windows sont rastérisées")

// Contenu réel de l'ICO : multi-images 32 bits, et l'étoile blanche au centre
// (preuve que l'icône n'est pas un carré uni resté de l'ancienne coque).
const ico = readFileSync(path.join(root, "src-tauri/icons/icon.ico"))
assert.equal(ico.readUInt16LE(2), 1, "ICO : type icône")
const count = ico.readUInt16LE(4)
assert.ok(count >= 7, `ICO : ${count} images (Windows attend au moins 7 tailles)`)
const sizes = []
let largest = { size: 0, offset: 0, length: 0 }
for (let i = 0; i < count; i++) {
  const entry = 6 + i * 16
  const width = ico[entry] || 256
  const height = ico[entry + 1] || 256
  assert.equal(width, height, "ICO : chaque image est carrée")
  assert.equal(ico.readUInt16LE(entry + 6), 32, "ICO : images 32 bits (canal alpha)")
  sizes.push(width)
  const length = ico.readUInt32LE(entry + 8)
  const offset = ico.readUInt32LE(entry + 12)
  assert.ok(offset + length <= ico.length, "ICO : les données tiennent dans le fichier")
  if (width > largest.size) largest = { size: width, offset, length }
}
for (const required of [16, 32, 256]) assert.ok(sizes.includes(required), `ICO : taille ${required} présente`)

// Bitmap 32bpp : en-tête BITMAPINFOHEADER (40 octets), lignes de bas en haut.
const dib = largest.offset
assert.equal(ico.readUInt32LE(dib), 40, "ICO : image en BITMAPINFOHEADER (pas PNG)")
const pixels = dib + 40
const stride = largest.size * 4
const pixel = (x, y) => {
  const row = largest.size - 1 - y
  const at = pixels + row * stride + x * 4
  return [ico[at + 2], ico[at + 1], ico[at]] // B, G, R
}
const [cr, cg, cb] = pixel(largest.size / 2, largest.size / 2)
assert.ok(cr > 200 && cg > 200 && cb > 200, `ICO : l'étoile blanche est au centre (rgb ${cr},${cg},${cb})`)
const [er, eg, eb] = pixel(Math.round(largest.size * 0.16), Math.round(largest.size * 0.16))
assert.ok(eg > 110 && er < 110 && eb < 170, `ICO : le fond est le vert du logo (rgb ${er},${eg},${eb})`)
const alphaAt = (x, y) => ico[pixels + (largest.size - 1 - y) * stride + x * 4 + 3]
assert.equal(alphaAt(0, 0), 0, "ICO : coins transparents (rayon du carré arrondi)")

console.log("v10.3.0 verification: OK (pages pleines, CLI au démarrage, PTY interactif, icône du logo)")
