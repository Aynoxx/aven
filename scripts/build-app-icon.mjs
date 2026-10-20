// v10.3.0 : l'icône Windows d'Aven est DÉRIVÉE du logo du frontend
// (`web/public/icons/brand-mark.svg` : carré vert arrondi + étoile blanche), au lieu
// d'un carré 32×32 sans rapport livré avec la coque Tauri. Windows ne lit pas le SVG :
// on rastérise ici les tailles qu'il demande (côté fenêtre, barre des tâches,
// exécutable et installateurs) dans un ICO 32 bits multi-images.
//
// Pourquoi pas une dépendance (sharp/resvg) : le dépôt n'en a aucune et l'icône est un
// artefact de build stable — un rasteriseur de 120 lignes suffit pour deux formes
// (rectangle arrondi + polygone). Aucun réseau, aucun binaire natif.
//
// Usage : node scripts/build-app-icon.mjs (écrit src-tauri/icons/icon.ico)
import { readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const SVG = path.join(root, "web", "public", "icons", "brand-mark.svg")
const OUT = path.join(root, "src-tauri", "icons", "icon.ico")
// Tailles demandées par Windows : 16 (barre de titre), 20/24 (échelles DPI),
// 32 (barre des tâches), 48 (Explorateur), 64/128/256 (grandes vues, installeurs).
const SIZES = [16, 20, 24, 32, 48, 64, 128, 256]

// ── 1. Lire le logo : couleurs du dégradé, rectangle, tracé de l'étoile ─────────
const svg = readFileSync(SVG, "utf8")
const stops = [...svg.matchAll(/stop-color="(#[0-9a-fA-F]{6})"/g)].map((m) => m[1])
if (stops.length < 2) throw new Error("brand-mark.svg : dégradé introuvable")
const rect = svg.match(/<rect x="([\d.]+)" y="([\d.]+)" width="([\d.]+)" height="([\d.]+)" rx="([\d.]+)"/)
if (!rect) throw new Error("brand-mark.svg : rectangle arrondi introuvable")
const [, rx0, ry0, rw, rh, rr] = rect.map(Number)
const starPath = svg.match(/<path fill="#fff" d="([^"]+)"/)?.[1]
if (!starPath) throw new Error("brand-mark.svg : étoile (path blanc) introuvable")
const gradient = svg.match(/x1="([\d.]+)" y1="([\d.]+)" x2="([\d.]+)" y2="([\d.]+)"/)?.slice(1).map(Number)
if (!gradient) throw new Error("brand-mark.svg : axe du dégradé introuvable")

const hex = (value) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16))
const FROM = hex(stops[0])
const TO = hex(stops[1])
const [gx1, gy1, gx2, gy2] = gradient

// ── 2. Géométrie : parseur minimal du tracé (M/L/l, fermeture z) ────────────────
function parsePath(d) {
  const points = []
  const tokens = d.match(/[MmLlZz]|-?\d*\.?\d+/g) ?? []
  let cursor = [0, 0]
  let command = "M"
  let i = 0
  while (i < tokens.length) {
    const token = tokens[i]
    if (/[MmLlZz]/.test(token)) { command = token; i++; continue }
    const x = Number(tokens[i])
    const y = Number(tokens[i + 1])
    if (!Number.isFinite(x) || !Number.isFinite(y)) break
    cursor = command === "l" || command === "m"
      ? [cursor[0] + x, cursor[1] + y]
      : [x, y]
    points.push(cursor)
    i += 2
  }
  return points
}
const star = parsePath(starPath)
if (star.length < 3) throw new Error("étoile : polygone dégénéré")

// Distance d'un point au bord d'un rectangle arrondi (négatif = dedans).
function roundedRectDistance(x, y, x0, y0, w, h, radius) {
  const cx = Math.abs(x - (x0 + w / 2)) - (w / 2 - radius)
  const cy = Math.abs(y - (y0 + h / 2)) - (h / 2 - radius)
  const outside = Math.hypot(Math.max(cx, 0), Math.max(cy, 0))
  const inside = Math.min(Math.max(cx, cy), 0)
  return outside + inside - radius
}

function inPolygon(x, y, polygon) {
  let inside = false
  for (let a = 0, b = polygon.length - 1; a < polygon.length; b = a++) {
    const [ax, ay] = polygon[a]
    const [bx, by] = polygon[b]
    if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside
  }
  return inside
}

// ── 3. Rendu : supersampling 4×4, dégradé du logo, ombre douce, étoile blanche ─
function render(size) {
  const SS = 4
  const scale = 128 / size
  const pixels = new Uint8ClampedArray(size * size * 4) // RGBA droit
  const denom = (gx2 - gx1) ** 2 + (gy2 - gy1) ** 2

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      // Accumulation alpha-droite : une couleur de sample ne compte que pour sa
      // couverture — sinon les bords anti-aliasés tirent vers le noir.
      let alphaSum = 0
      let red = 0, green = 0, blue = 0
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const x = (px + (sx + 0.5) / SS) * scale
          const y = (py + (sy + 0.5) / SS) * scale
          const dist = roundedRectDistance(x, y, rx0, ry0, rw, rh, rr)

          if (dist <= 0) {
            const t = Math.min(1, Math.max(0, ((x - gx1) * (gx2 - gx1) + (y - gy1) * (gy2 - gy1)) / denom))
            const color = inPolygon(x, y, star)
              ? [255, 255, 255]
              : [
                  FROM[0] + (TO[0] - FROM[0]) * t,
                  FROM[1] + (TO[1] - FROM[1]) * t,
                  FROM[2] + (TO[2] - FROM[2]) * t,
                ]
            alphaSum += 1
            red += color[0]; green += color[1]; blue += color[2]
            continue
          }

          // Ombre du logo (feDropShadow dy=8) : croissant d'autant plus clair qu'on
          // s'éloigne du rectangle, uniquement AUTOUR de lui (le rect opaque couvre).
          const shadow = roundedRectDistance(x, y - 8, rx0, ry0, rw, rh, rr)
          const edge = dist < 0.9 ? 1 - dist / 0.9 : 0
          if (edge > 0) {
            const t = Math.min(1, Math.max(0, ((x - gx1) * (gx2 - gx1) + (y - gy1) * (gy2 - gy1)) / denom))
            const color = [
              FROM[0] + (TO[0] - FROM[0]) * t,
              FROM[1] + (TO[1] - FROM[1]) * t,
              FROM[2] + (TO[2] - FROM[2]) * t,
            ]
            alphaSum += edge
            red += color[0] * edge; green += color[1] * edge; blue += color[2] * edge
          } else if (shadow < 0) {
            const soft = Math.min(1, -shadow / 10) * 0.16
            alphaSum += soft
            red += FROM[0] * soft; green += FROM[1] * soft; blue += FROM[2] * soft
          }
        }
      }
      const samples = SS * SS
      const o = (py * size + px) * 4
      if (alphaSum > 0) {
        pixels[o] = Math.round(red / alphaSum)
        pixels[o + 1] = Math.round(green / alphaSum)
        pixels[o + 2] = Math.round(blue / alphaSum)
      }
      pixels[o + 3] = Math.round(Math.min(1, alphaSum / samples) * 255)
    }
  }
  return pixels
}

// ── 4. Encodage ICO : entrées DIB 32 bits (compatibles toutes versions) ────────
function dib(size, rgba) {
  const header = Buffer.alloc(40)
  header.writeUInt32LE(40, 0) // biSize
  header.writeInt32LE(size, 4) // biWidth
  header.writeInt32LE(size * 2, 8) // biHeight = XOR + AND
  header.writeUInt16LE(1, 12) // biPlanes
  header.writeUInt16LE(32, 14) // biBitCount
  header.writeUInt32LE(0, 16) // BI_RGB
  header.writeUInt32LE(size * size * 4, 20)
  const xor = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    const srcRow = size - 1 - y // lignes DIB de bas en haut
    for (let x = 0; x < size; x++) {
      const s = (srcRow * size + x) * 4
      const d = (y * size + x) * 4
      xor[d] = rgba[s + 2] // B
      xor[d + 1] = rgba[s + 1] // G
      xor[d + 2] = rgba[s] // R
      xor[d + 3] = rgba[s + 3] // A
    }
  }
  const maskRow = Math.ceil(size / 32) * 4
  const mask = Buffer.alloc(maskRow * size) // AND vide : l'alpha décide
  return Buffer.concat([header, xor, mask])
}

const images = SIZES.map((size) => ({ size, data: dib(size, render(size)) }))
const directory = Buffer.alloc(6 + images.length * 16)
directory.writeUInt16LE(0, 0) // réservé
directory.writeUInt16LE(1, 2) // type icône
directory.writeUInt16LE(images.length, 4)
let offset = directory.length
images.forEach((image, index) => {
  const entry = 6 + index * 16
  directory.writeUInt8(image.size >= 256 ? 0 : image.size, entry) // 0 = 256
  directory.writeUInt8(image.size >= 256 ? 0 : image.size, entry + 1)
  directory.writeUInt8(0, entry + 2)
  directory.writeUInt8(0, entry + 3)
  directory.writeUInt16LE(1, entry + 4) // plans
  directory.writeUInt16LE(32, entry + 6) // bits
  directory.writeUInt32LE(image.data.length, entry + 8)
  directory.writeUInt32LE(offset, entry + 12)
  offset += image.data.length
})
writeFileSync(OUT, Buffer.concat([directory, ...images.map((image) => image.data)]))

// ── 5. Vérification du fichier écrit (pas seulement du rendu en mémoire) ──────
const written = readFileSync(OUT)
const count = written.readUInt16LE(4)
if (count !== SIZES.length) throw new Error(`ICO : ${count} images au lieu de ${SIZES.length}`)
for (let index = 0; index < count; index++) {
  const entry = 6 + index * 16
  const size = written.readUInt8(entry) || 256
  const length = written.readUInt32LE(entry + 8)
  const start = written.readUInt32LE(entry + 12)
  if (start + length > written.length) throw new Error(`ICO : image ${size} hors fichier`)
  // Le logo doit être RECONNAISSABLE à chaque taille : une part notable de pixels
  // blancs (l'étoile) et une surface verte opaque. Un simple pixel central ne suffit
  // pas — à 16 px il tombe sur le bord de l'étoile et mélange les deux couleurs.
  const header = written.subarray(start, start + 40)
  const width = header.readInt32LE(4)
  let white = 0
  let opaque = 0
  for (let y = 0; y < width; y++) {
    for (let x = 0; x < width; x++) {
      const at = start + 40 + ((width - 1 - y) * width + x) * 4
      const [b, g, r, a] = [written[at], written[at + 1], written[at + 2], written[at + 3]]
      if (a > 200) opaque++
      if (a > 200 && r > 200 && g > 200 && b > 200) white++
    }
  }
  const total = width * width
  if (white < Math.max(2, total * 0.01)) throw new Error(`ICO ${size}px : étoile blanche absente (${white} px)`)
  if (opaque < total * 0.6) throw new Error(`ICO ${size}px : surface du logo insuffisante (${opaque}/${total})`)
}
console.log(`✓ icône Windows : ${SIZES.join(", ")} px → ${path.relative(root, OUT)} (${(written.length / 1024).toFixed(1)} Kio)`)
