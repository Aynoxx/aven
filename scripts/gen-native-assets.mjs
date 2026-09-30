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

// Rend un PNG RGBA w×h : losange plein centré (|dx|/rx + |dy|/ry <= 1).
function diamondPng(w, h) {
  const raw = Buffer.alloc(h * (w * 4 + 1))
  const cx = (w - 1) / 2
  const cy = (h - 1) / 2
  const rx = w * 0.42
  const ry = h * 0.42
  for (let y = 0; y < h; y++) {
    const ligne = y * (w * 4 + 1)
    raw[ligne] = 0 // filtre 0 = None
    for (let x = 0; x < w; x++) {
      const o = ligne + 1 + x * 4
      const dedans = Math.abs(x - cx) / rx + Math.abs(y - cy) / ry <= 1
      raw[o] = 0x8b // R
      raw[o + 1] = 0x5c // G
      raw[o + 2] = 0xf6 // B
      raw[o + 3] = dedans ? 0xff : 0x00
    }
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
console.log(`\n7 assets écrits dans ${outDir}`)
