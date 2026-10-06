import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// Sondes v9.7.6 : l'agent vocal exécute de nouveau les commandes dictées —
// ① gpt-oss-20b RAISONNE : sans reasoning_effort, ses jetons de pensée consomment
//    max_tokens et tronquent le JSON (constaté en prod : 45/60 → « Réponse
//    d'intention illisible » sur CHAQUE dictée) → bascule OBLIGATOIRE à "low" ;
// ② FILET D'ABORD : les motifs de commande déterministes (verbe + nom d'interface,
//    garde anti-faux-positifs testée) décident AVANT le classifieur LLM — une
//    commande dictée s'exécute même si l'appel LLM échoue ou répond tronqué ;
// ③ parité stricte web/natif (voice-intent.ts ≡ VoiceIntent.cs, voice.ts ≡ VoicePipeline).

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

const pkg = JSON.parse(read("package.json"))
const [vMaj, vMin, vPatch] = pkg.version.split(".").map(Number)
assert.ok(vMaj * 10000 + vMin * 100 + vPatch >= 90706, `version trop ancienne : ${pkg.version}`)
assert.ok(typeof pkg.scripts["verify:v9.7.6"] === "string", "script verify:v9.7.6 manquant")
assert.ok(pkg.scripts.verify.includes("verify-v9.7.6.mjs"), "sonde v9.7.6 non branchée dans npm run verify")

const intent = read("electron/voice-intent.ts")
const voice = read("electron/voice.ts")
const bridge = read("native/src/Aven.Bridge/VoiceIntent.cs")

// A. La bascule reasoning_effort est envoyée au classifieur (web ET natif).
assert.match(intent, /export const INTENT_REASONING_EFFORT = "low"/, "constante INTENT_REASONING_EFFORT absente")
assert.match(intent, /reasoning_effort: INTENT_REASONING_EFFORT/, "reasoning_effort non envoyé au classifieur web")
assert.match(bridge, /public const string IntentReasoningEffort = "low";/, "constante IntentReasoningEffort absente du natif")
assert.match(bridge, /\["reasoning_effort"\] = VoiceIntent\.IntentReasoningEffort/, "reasoning_effort non envoyé au classifieur natif")

// B. FILET D'ABORD : les commandes d'app ne dépendent plus du classifieur LLM.
assert.match(voice, /const filet = fallbackIntent\(raw\)/, "filet non calculé en amont")
assert.match(voice, /if \(filet && filet\.intent === "app"\)\s*\{\s*result\.intent = filet/, "priorité du filet app absente")
assert.ok(!/classified\.intent === "chat" \? \(fallbackIntent\(raw\) \?\? classified\)/.test(voice), "l'ancienne fusion classifieur-d'abord doit avoir disparu")
assert.match(bridge, /var commande = VoiceIntent\.FallbackIntent\(raw\);/, "filet natif non calculé en amont")
assert.match(bridge, /if \(commande is \{ Kind: "app" \}\) résultat\.Intent = commande;/, "priorité du filet app absente du natif")

// C. Le budget de réponse reste minuscule (garde de coût) malgré la bascule.
assert.match(intent, /max_tokens: 60/, "budget max_tokens du classifieur modifié")

console.log("verify-v9.7.6 : OK (reasoning_effort + filet d'abord, web et natif)")
