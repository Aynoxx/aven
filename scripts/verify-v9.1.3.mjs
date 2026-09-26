import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// fileURLToPath (et non .pathname) : sous Windows, "/C:/…" n'est pas un chemin valide.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

const pkg = JSON.parse(read("package.json"))
const app = read("web/src/App.tsx")
const css = read("web/src/App.css")
const providers = read("electron/providers.ts")
const settingsDialog = read("web/src/SettingsDialog.tsx")
const appearance = read("web/src/appearance.ts")
const intent = read("electron/voice-intent.ts")
const voice = read("electron/voice.ts")
const types = read("web/src/types.ts")
const freebuffCli = read("electron/freebuff-cli.ts")
const main = read("electron/main.ts")
const dictation = read("web/src/voice-dictation.ts")

// ── Version ──
const [vMaj, vMin, vPatch] = pkg.version.split(".").map(Number)
assert.ok(vMaj * 10000 + vMin * 100 + vPatch >= 90103, `version trop ancienne : ${pkg.version}`)

// ① Plus de carte « Paramètres » dans le hub circulaire (6 cartes réparties à 60°).
assert.ok(!/key: "settings"/.test(app), "la carte « Paramètres » doit avoir disparu du hub")
assert.ok(!/\.hub-card-settings/.test(css), "le CSS .hub-card-settings doit avoir disparu")
assert.match(css, /--hub-angle:300deg/) // 6ᵉ et dernière carte de l'orbite
// L'accès aux réglages reste possible hors du hub (barre de fenêtre + barre d'accueil).
assert.match(app, /Ouvrir les paramètres/)

// ② Plus de bouton Freebuff dans le composeur : override, hint backend et préfixe caché.
assert.ok(!/freebuffOverride/.test(app), "l'override Freebuff du composeur doit avoir disparu")
assert.ok(!/nextManualChoice/.test(app), "nextManualChoice ne doit plus être utilisé dans App")
assert.ok(!/\/freebuff\\s\+/.test(app), "le préfixe caché /freebuff doit avoir disparu de sendText")
assert.ok(!/Freebuff actif/.test(app), "le bouton « Freebuff actif » doit avoir disparu du composeur")
assert.ok(!/effectiveBackend/.test(app), "App n'appelle plus effectiveBackend")

// ③ L'agent vocal exécute réellement les actions demandées.
assert.match(intent, /"open-freebuff", "open-stats", "new-chat"/)
assert.match(intent, /export function fallbackIntent/)
assert.match(intent, /n'est JAMAIS une commande/) // garde : une demande de contenu n'est pas une commande
assert.match(voice, /fallbackIntent\(raw\)/) // filet de secours dans le pipeline
assert.match(types, /"open-freebuff" \| "open-stats" \| "new-chat"/)
assert.match(app, /case "open-freebuff"/)
assert.match(app, /case "open-stats"/)
assert.match(app, /case "new-chat"/)
assert.match(app, /routeAppActionRef\.current\(intent\.action\)/) // exécution avec closure fraîche
assert.match(dictation, /optionsRef/) // callbacks de dictée toujours à jour

// ④ Plus de clé API Codebuff nulle part dans l'application.
assert.ok(!/codebuff/i.test(providers), "le fournisseur codebuff doit avoir disparu de PROVIDERS")
assert.ok(!/codebuff/i.test(settingsDialog), "plus aucune mention Codebuff dans les Réglages")
assert.ok(!/freebuffAsEngine/.test(appearance), "le champ freebuffAsEngine doit avoir disparu de l'apparence")

// ⑤ Freebuff CLI : statut vérifié AVANT lancement, quoting Windows corrigé.
assert.match(freebuffCli, /export function freebuffMissingMessage/)
assert.match(main, /checkFreebuffCli/)
assert.match(main, /if \(action !== "install"\)/)
assert.match(main, /freebuffMissingMessage\(\)/)
assert.ok(!/windowsVerbatimArguments/.test(main), "windowsVerbatimArguments doit avoir disparu (quoting correct des chemins avec espaces)")
assert.match(settingsDialog, /await api\.freebuffCliStatus\(\)/) // re-vérification après installation

console.log("v9.1.3 verification: OK")
