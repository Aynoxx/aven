import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"))
assert.equal(pkg.version, "8.7.5")
const table = JSON.parse(readFileSync(new URL("../model-priorities.json", import.meta.url), "utf8"))
const openCodeFree = new Set(["deepseek-v4-flash-free","mimo-v2.5-free","laguna-s-2.1-free","ling-3.0-tiny-free","longcat-2.0-free","north-mini-code-free","nemotron-3-ultra-free","big-pickle"])
const isFree = (ref) => ref === "openrouter/openrouter/free"
  || (ref.startsWith("openrouter/") && ref.endsWith(":free"))
  || (ref.startsWith("opencode/") && openCodeFree.has(ref.slice("opencode/".length)))
for (const ref of Object.keys(table.models)) assert.equal(isFree(ref), true, `Modèle payant/non-free présent: ${ref}`)
assert.ok(table.models["opencode/deepseek-v4-flash-free"])
assert.ok(table.models["opencode/north-mini-code-free"])
assert.ok(table.models["opencode/big-pickle"])
assert.equal(isFree("openai/gpt-5.6"), false)
assert.equal(isFree("google/gemini-3.8-flash"), false)
assert.equal(isFree("opencode/foo-free"), false)
const discovered = [
  { ref: "opencode/north-mini-code-free", label: "North Mini Code Free" },
  { ref: "openai/paid-model", label: "Paid" },
].filter((m) => isFree(m.ref))
assert.deepEqual(discovered, [{ ref: "opencode/north-mini-code-free", label: "North Mini Code Free" }])
const source = readFileSync(new URL("../electron/priorities.ts", import.meta.url), "utf8")
assert.match(source, /addDiscoveredFreeModels/)
assert.match(readFileSync(new URL("../electron/main.ts", import.meta.url), "utf8"), /addDiscoveredFreeModels/)
console.log("v8.7.5 free-model checks: OK")
