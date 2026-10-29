import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v11.5.2 : cache des clés déchiffrées côté host. Le déchiffrement DPAPI coûte
// ~580 ms par clé et était refait à chaque requête vocale (~40 % de la latence
// mesurée). Ce que la sonde fige : le cache est PUR (aucun I/O, le clair ne
// quitte jamais le host), il est branché sur le déchiffrement réel, il est
// invalidé à chaque changement de settings (mtime) ET à chaque enregistrement
// d'une clé, et `requireGroqKey` passe par lui.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")
const pkg = JSON.parse(read("package.json"))
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"))
const lock = JSON.parse(read("package-lock.json"))
const cargo = read("src-tauri/Cargo.toml")
const cargoLock = read("src-tauri/Cargo.lock")
const readme = read("README.md")

// ── Version cohérente dans tous les manifestes ─────────────────────────────
assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "package.json porte une version sémantique")
assert.equal(tauri.version, pkg.version, "tauri.conf.json suit package.json")
assert.equal(lock.version, pkg.version, "package-lock.json correspond à package.json")
assert.equal(lock.packages[""].version, pkg.version, "le paquet racine du lock est synchronisé")
assert.match(cargo, new RegExp(`^version = "${pkg.version.replaceAll(".", "\\.")}"$`, "m"), "Cargo.toml suit package.json")
assert.match(cargoLock, new RegExp(`\\[\\[package\\]\\]\\r?\\nname = "aven"\\r?\\nversion = "${pkg.version.replaceAll(".", "\\.")}"`), "Cargo.lock suit package.json")
assert.match(readme, new RegExp(`^# Aven v${pkg.version.replaceAll(".", "\\.")}$`, "m"), "README annonce la version courante")
assert.ok(pkg.scripts.verify.includes("scripts/verify-v11.5.2.mjs"), "npm run verify inclut la sonde courante")
assert.equal(pkg.scripts["verify:v11.5.2"], "node scripts/verify-v11.5.2.mjs", "la sonde a son entrée npm")

const cache = read("host/key-cache.ts")
const host = read("host/aven-app-host.ts")
const tests = read("tests/key-cache.test.mjs")
const audit = read("docs/audits/2026-10-26-latence-agent-vocal.md")

// ── Le module est PUR : aucune écriture, aucun disque ──────────────────────
assert.match(cache, /export function createKeyCache\(load: KeyLoader\): KeyCache/, "le cache est une fonction exportée")
assert.match(cache, /Pur : testable avec Node seul/, "le module se déclare pur")
assert.doesNotMatch(cache, /writeFileSync|readFileSync/, "le clair ne vit qu'en mémoire du processus")

// ── Branché sur le déchiffrement réel, invalidé à chaque changement ────────
assert.match(host, /const keyCache = createKeyCache\(decryptProviderKey\)/, "le cache charge via le déchiffrement DPAPI")
assert.match(host, /function cachedKey\(providerId: string\)/, "toute lecture passe par cachedKey")
assert.match(host, /const stamp = currentSettingsStamp\(\)/, "settings.json est revérifié à chaque accès (mtime)")
assert.match(host, /const key = cachedKey\("groq"\)\?\.trim\(\)/, "requireGroqKey passe par le cache")
assert.match(host, /const value = cachedKey\(provider\.id\)/, "loadKeys passe par le cache")
const clears = (host.match(/keyCache\.clear\(\)/g) ?? []).length
assert.ok(clears >= 2, `invalidation au changement de settings ET à l'enregistrement d'une clé (${clears})`)

// ── Testé, et l'audit du jour cite la sonde ────────────────────────────────
assert.match(tests, /createKeyCache/, "tests/key-cache.test.mjs couvre le cache")
assert.match(audit, /scripts\/verify-v11\.5\.2\.mjs/, "l'audit du 2026-10-26 cite la sonde")

console.log("v11.5.2 verification: OK (cache de clés : pur, branché sur DPAPI, invalidé à chaque changement)")
