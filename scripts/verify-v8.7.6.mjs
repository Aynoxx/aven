import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// fileURLToPath (et non .pathname) : sous Windows, "/C:/…" n'est pas un chemin valide.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"))
const priorities = JSON.parse(readFileSync(path.join(root, "model-priorities.json"), "utf8"))
const main = readFileSync(path.join(root, "electron/main.ts"), "utf8")
const operations = readFileSync(path.join(root, "electron/operations.ts"), "utf8")
const freebuff = readFileSync(path.join(root, "electron/freebuff.ts"), "utf8")
const providers = readFileSync(path.join(root, "electron/providers.ts"), "utf8")
const history = readFileSync(path.join(root, "electron/freebuff-history.ts"), "utf8")
const app = readFileSync(path.join(root, "web/src/App.tsx"), "utf8")
const preload = readFileSync(path.join(root, "electron/preload.cts"), "utf8")
const types = readFileSync(path.join(root, "web/src/types.ts"), "utf8")

assert.equal(pkg.version, "8.7.6")
assert.equal(pkg.dependencies?.["@codebuff/sdk"], "0.10.7")
assert.equal(pkg.devDependencies?.electron, "35.4.0")
assert.ok(main.includes('uses: 1'))
assert.ok(main.includes('expireTime'))
assert.ok(main.includes('newSessionExpireTime'))
assert.ok(main.includes('https://generativelanguage.googleapis.com/v1beta/auth_tokens'))
assert.ok(!main.includes('body: JSON.stringify({\n          uses: 1,\n          expireTime,\n          newSessionExpireTime,\n          liveConnectConstraints'))
assert.ok(main.includes('p.openCodeEnv !== false'))
assert.ok(providers.includes('id: "codebuff"'))
assert.ok(providers.includes('openCodeEnv: false'))
assert.ok(operations.includes('backend: "opencode" | "freebuff"'))
assert.ok(operations.includes('runFreebuff'))
assert.ok(operations.includes('getFreebuffMessages'))
assert.ok(freebuff.includes('CodebuffClient'))
assert.ok(freebuff.includes('codebuff/base@latest'))
assert.ok(freebuff.includes('codebuff/thinker@latest'))
assert.ok(freebuff.includes('codebuff/researcher@latest'))
assert.ok(freebuff.includes('previousRun'))
assert.ok(history.includes('freebuff-history.json'))
// v9.1.3 : le préfixe caché /freebuff et le hook useFreebuff ont disparu de l'UI.
assert.ok(!app.includes('useFreebuff'))
assert.ok(!app.includes('explicitFreebuff'))
assert.ok(preload.includes('backend?: "opencode" | "freebuff"'))
assert.ok(types.includes('export type SendResult'))

const bad = Object.keys(priorities.models ?? {}).filter((ref) => {
  if (ref === "openrouter/openrouter/free") return false
  if (ref.startsWith("openrouter/") && ref.endsWith(":free")) return false
  const allowed = new Set(["deepseek-v4-flash-free", "mimo-v2.5-free", "mimo-v2.6-flash-free", "laguna-s-2.1-free", "ling-3.0-tiny-free", "longcat-2.0-free", "north-mini-code-free", "nemotron-3-ultra-free", "nemotron-3.5-lightning-free", "space-bunny-free", "muse-spark-1.3-contributor-free", "jev-1.13-free", "big-pickle"])
  return !ref.startsWith("opencode/") || !allowed.has(ref.slice("opencode/".length))
})
assert.deepEqual(bad, [])

console.log("v8.7.6 verification: OK")
