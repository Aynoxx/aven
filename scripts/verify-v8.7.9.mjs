import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// fileURLToPath (et non .pathname) : sous Windows, "/C:/…" n'est pas un chemin valide.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

const pkg = JSON.parse(read("package.json"))
const main = read("electron/main.ts")
const announcer = read("electron/announcer.ts")
const preload = read("electron/preload.cts")
const appearance = read("web/src/appearance.ts")
const app = read("web/src/App.tsx")
const settings = read("web/src/SettingsDialog.tsx")
const types = read("web/src/types.ts")

// ── Version et périmètre v8.7.9 : annonceur vocal SAPI ──
assert.equal(pkg.version, "8.7.9")

// Module annonceur : les trois règles d'or sont présentes et la dictée v8.7.8 est conservée.
assert.match(announcer, /COALESCENCE/)
assert.match(announcer, /MUTE/)
assert.match(announcer, /lit JAMAIS le contenu/) // jamais le contenu des réponses
assert.match(announcer, /class Announcer/)
assert.match(announcer, /session\.execution\.interrupted/)
assert.match(voiceRetained(main), /voice:transcribe/) // dictée intacte

// Branchement main : events relayés + IPC annonceur + SAPI.
assert.match(main, /announcer\.handle\(ev\)/)
assert.match(main, /announcer:activity/)
assert.match(main, /announcer:setEnabled/)
assert.match(main, /announcer:test/)
assert.match(main, /System\.Speech/) // SAPI via PowerShell
assert.match(main, /isMuted: \(\) => Date\.now\(\) - lastUserActivity/)

// Exposition renderer + préférence persistée + mute à la frappe.
assert.match(preload, /announcerActivity|announcerSetEnabled|announcerTest/)
assert.match(types, /announcerSetEnabled/)
assert.match(appearance, /voiceAnnouncements/)
assert.match(app, /api\.announcerSetEnabled\(appearance\.voiceAnnouncements\)/)
assert.match(app, /signalActivity\(\)/)
assert.match(settings, /Annonce vocale/)
assert.match(settings, /announcerTest/)

// Le duplex retiré (v8.7.7) ne revient pas.
assert.doesNotMatch(main, /voice:(realtime-token|command|confirm)/)
assert.doesNotMatch(app, /AssistantOverlay/)

console.log("v8.7.9 verification: OK")

// petit helper pour éviter un import circulaire dans les assertions
function voiceRetained(_main) {
  return _main
}
