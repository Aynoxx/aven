// Génère les assets PNG du manifeste MSIX d'Aven.Native — phase 0.
// PNG minimaux écrits avec le module zlib natif de Node (aucune dépendance) :
// chaque tuile = losange violet (#8b5cf6, accent d'Aven) centré sur fond transparent.
import fs from "node:fs"
import path from "node:path"
import zlib from "node:zlib"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const outDir = path.join(__dirname, "..", "native", "src", "Aven.Native", "Assets")
fs.mkdirSync(outDir, { recursive: true })

// CRC32 (table standard, PNG exige little-endian CRC-32/Adler non — c'est CRC-32 IEEE)
const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c
})
function crc32(buf) {
  let c = -1
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, "ascii"), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

// Rend les pixels RGBA w×h (haut → bas) du losange plein centré
// (|dx|/rx + |dy|/ry <= 1) — même dessin pour le PNG du manifeste et le ICO du tray.
function diamondPixels(w, h) {
  const px = Buffer.alloc(w * h * 4)
  const cx = (w - 1) / 2
  const cy = (h - 1) / 2
  const rx = w * 0.42
  const ry = h * 0.42
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4
      const dedans = Math.abs(x - cx) / rx + Math.abs(y - cy) / ry <= 1
      px[o] = 0x8b // R
      px[o + 1] = 0x5c // G
      px[o + 2] = 0xf6 // B
      px[o + 3] = dedans ? 0xff : 0x00
    }
  }
  return px
}

function diamondPng(w, h) {
  const px = diamondPixels(w, h)
  const raw = Buffer.alloc(h * (w * 4 + 1))
  for (let y = 0; y < h; y++) {
    const ligne = y * (w * 4 + 1)
    raw[ligne] = 0 // filtre 0 = None
    px.copy(raw, ligne + 1, y * w * 4, (y + 1) * w * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0)
  ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8 // profondeur
  ihdr[9] = 6 // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ])
}

// ICO multi-tailles (J7) pour l'icône du tray : entrées BMP 32 bpp classiques
// (BITMAPINFOHEADER à hauteur doublée + masque AND à zéro, alpha porté par le BGRA) —
// format lu par Shell_NotifyIconW depuis l'XP, sans dépendance ni PNG décodé.
function diamondIco(sizes) {
  const entrées = []
  let offset = 6 + sizes.length * 16 // en-tête + une ICONDIRENTRY par taille
  for (const n of sizes) {
    const px = diamondPixels(n, n)
    const xor = Buffer.alloc(n * n * 4)
    for (let y = 0; y < n; y++) {
      // Les lignes BMP remontent depuis le bas ; le masque AND (lignes alignées 32 b) est vide.
      const src = (n - 1 - y) * n * 4
      px.copy(xor, y * n * 4, src, src + n * 4)
      for (let x = 0; x < n * 4; x += 4) {
        const o = y * n * 4 + x
        const b = xor[o]
        xor[o] = xor[o + 2]
        xor[o + 2] = b // RGBA → BGRA
      }
    }
    const etMasque = Math.ceil(n / 32) * 4 * n // masque AND : lignes alignées sur 32 bits
    const bmi = Buffer.alloc(40)
    bmi.writeUInt32LE(40, 0)          // BITMAPINFOHEADER
    bmi.writeInt32LE(n, 4)            // biWidth
    bmi.writeInt32LE(n * 2, 8)         // biHeight = 2× (XOR en bas + AND au-dessus)
    bmi.writeUInt16LE(1, 12)           // biPlanes
    bmi.writeUInt16LE(32, 14)          // biBitCount
    bmi.writeUInt32LE(xor.length + etMasque, 20) // biSizeImage
    const and = Buffer.alloc(etMasque) // tout à zéro : alpha BGRA porte la transparence
    const image = Buffer.concat([bmi, xor, and])
    const dir = Buffer.alloc(16)
    dir.writeUInt8(n >= 256 ? 0 : n, 0)
    dir.writeUInt8(n >= 256 ? 0 : n, 1)
    dir.writeUInt8(0, 2)              // couleurs du masque (palettisé)
    dir.writeUInt8(0, 3)
    dir.writeUInt16LE(1, 4)           // planes
    dir.writeUInt16LE(32, 6)          // bits/pixel
    dir.writeUInt32LE(image.length, 8)
    dir.writeUInt32LE(offset, 12)
    entrées.push({ dir, image })
    offset += image.length
  }
  const enTête = Buffer.alloc(6)
  enTête.writeUInt16LE(0, 0)          // réservé
  enTête.writeUInt16LE(1, 2)          // type = icône
  enTête.writeUInt16LE(sizes.length, 4)
  return Buffer.concat([enTête, ...entrées.map(e => e.dir), ...entrées.map(e => e.image)])
}

const assets = {
  "Square44x44Logo.png": [44, 44],
  "Square150x150Logo.png": [150, 150],
  "Wide310x150Logo.png": [310, 150],
  "StoreLogo.png": [50, 50],
  "SplashScreen.png": [620, 300],
  "LockScreenLogo.scale-200.png": [44, 44],
  "Square44x44Logo.targetsize-24_altform-unplated.png": [24, 24],
}

for (const [name, [w, h]] of Object.entries(assets)) {
  fs.writeFileSync(path.join(outDir, name), diamondPng(w, h))
  console.log(`✓ ${name} (${w}×${h})`)
}

// J7 : icône du tray système (16/24/32/48 px — pêche Shell_NotifyIconW).
const tray = path.join(outDir, "tray.ico")
fs.writeFileSync(tray, diamondIco([16, 24, 32, 48]))
console.log("✓ tray.ico (16/24/32/48)")
console.log(`\n${Object.keys(assets).length + 1} assets écrits dans ${outDir}`)
