import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v11.4.3 : le service vocal d'Edge limite le débit (429). Ce que la sonde fige :
//   A. une phrase déjà synthétisée ne repart pas au service — cache borné, pur ;
//   B. la voix fait partie de la clé (changer de voix ne sert pas l'ancienne) ;
//   C. après un 429, le service est laissé tranquille une minute, SANS requête ;
//   D. la voix neuronale revient d'elle-même, et le repli reste dit ;
//   E. rien n'est conservé sur disque : le cache vit en mémoire seulement.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")
const pkg = JSON.parse(read("package.json"))
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"))
const lock = JSON.parse(read("package-lock.json"))
const cargo = read("src-tauri/Cargo.toml")
const cargoLock = read("src-tauri/Cargo.lock")
const readme = read("README.md")
const agents = read("AGENTS.md")

const cache = read("host/voice-cache.ts")
const host = read("host/aven-app-host.ts")
const edge = read("host/voice-agent-edge.ts")
const tests = read("tests/voice-cache.test.mjs")
const edgeTests = read("tests/voice-agent-edge.test.mjs")

// ── Version cohérente dans tous les manifestes ───────────────────────────────
assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "package.json porte une version sémantique")
assert.equal(tauri.version, pkg.version, "tauri.conf.json suit package.json")
assert.equal(lock.version, pkg.version, "package-lock.json correspond à package.json")
assert.equal(lock.packages[""].version, pkg.version, "le paquet racine du lock est synchronisé")
assert.match(cargo, new RegExp(`^version = "${pkg.version.replaceAll(".", "\\.")}"$`, "m"), "Cargo.toml suit package.json")
assert.match(cargoLock, new RegExp(`\\[\\[package\\]\\]\\r?\\nname = "aven"\\r?\\nversion = "${pkg.version.replaceAll(".", "\\.")}"`), "Cargo.lock suit package.json")
assert.match(readme, new RegExp(`^# Aven v${pkg.version.replaceAll(".", "\\.")}$`, "m"), "README annonce la version courante")
assert.ok(pkg.scripts.verify.includes("scripts/verify-v11.4.3.mjs"), "npm run verify inclut la sonde courante")
assert.equal(pkg.scripts["verify:v11.4.3"], "node scripts/verify-v11.4.3.mjs", "la sonde a son entrée npm")

// ── A. Cache borné et pur, utilisé AVANT le service ────────────────────────
assert.ok(existsSync(path.join(root, "host/voice-cache.ts")), "le cache vit dans son module")
assert.match(cache, /Pur : testable avec Node seul/, "le module se déclare pur")
assert.match(cache, /export function createVoiceCache/, "le cache est créé par une fonction exportée")
assert.match(cache, /options\.maxEntries \?\? 16/, "la taille est bornée")
assert.match(cache, /options\.ttlMs \?\? 30 \* 60_000/, "la durée de vie est bornée")
assert.match(cache, /entries\.size > maxEntries/, "l'éviction existe")
assert.ok(existsSync(path.join(root, "tests/voice-cache.test.mjs")), "les tests du cache existent")
assert.match(tests, /l'entrée la moins récemment utilisée sort/, "l'éviction est testée")
assert.match(tests, /l'entrée expire/, "l'expiration est testée")

const cacheReadAt = host.indexOf("VOICE_CACHE.get(key)")
const synthAt = host.indexOf("await synthesizeEdgeSpeech(clean, route.voice)")
const cacheWriteAt = host.indexOf("VOICE_CACHE.set(key, base64)")
assert.ok(cacheReadAt > 0 && synthAt > 0 && cacheWriteAt > 0, "les trois étapes existent dans le host")
assert.ok(cacheReadAt < synthAt, "le cache est consulté AVANT le service")
assert.ok(synthAt < cacheWriteAt, "l'audio n'est mémorisé qu'après synthèse")
assert.match(host, /const key = `\$\{route\.voice\}\\u0000\$\{clean\}`/, "la clé porte la voix et le texte")

// ── B. Un autre texte ou une autre voix ne sert jamais l'ancien audio ──────
assert.match(tests, /la voix fait partie de la clé/, "le test verrouille la clé par voix")
assert.match(tests, /un texte déjà synthétisé est resservi/, "le test verrouille le service depuis le cache")

// ── C. Après un 429, une minute sans requête ───────────────────────────────
assert.match(edge, /EDGE_COOLDOWN_MS = 60_000/, "le blocage vaut une minute")
assert.match(edge, /export function edgeCooldownActive/, "le blocage est une fonction pure")
assert.match(edgeTests, /blocage après 429/, "le blocage est testé")
assert.match(host, /edgeCooldownActive\(edgeBlockedUntil\)/, "le host consulte le blocage avant de synthétiser")
const cooldownBranch = host.slice(host.indexOf("if (edgeCooldownActive(edgeBlockedUntil))"), host.indexOf("await synthesizeEdgeSpeech(clean, route.voice)"))
assert.doesNotMatch(cooldownBranch, /synthesizeEdgeSpeech/, "le blocage n'envoie AUCUNE requête")
assert.match(host, /if \(isEdgeRateLimit\(error\)\) edgeBlockedUntil = Date\.now\(\) \+ EDGE_COOLDOWN_MS/, "un 429 arme le blocage")

// ── D. Le repli reste dit, et la voix neuronale revient d'elle-même ────────
assert.match(host, /warning: `Voix neuronale indisponible \(\$\{reason\}\) : voix Windows utilisée\.`/, "le repli est toujours annoncé")
assert.match(host, /reason = EDGE_QUOTA_MESSAGE/, "le blocage utilise le message du service, pas une copie")
// Aucune purge manuelle : le cache expire de lui-même, donc le service est
// resservi sans redémarrage dès qu'il répond de nouveau.
assert.doesNotMatch(cache, /writeFile|appendFile/, "le cache n'écrit rien sur disque")
assert.doesNotMatch(cache, /localStorage/, "le cache ne touche pas au stockage du navigateur")

// ── E. Documentation et note de version ────────────────────────────────────
assert.match(agents, /Une phrase déjà synthétisée n'est pas redemandée/, "AGENTS.md fige la règle du cache vocal")
assert.match(readme, new RegExp(`v${pkg.version.replaceAll(".", "\\.")} — `), "README porte la note de la version courante")

console.log("v11.4.3 verification: OK (cache vocal borné, blocage 429 respecté, repli toujours dit)")
