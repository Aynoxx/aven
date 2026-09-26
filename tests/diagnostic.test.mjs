import assert from "node:assert/strict"
import { test } from "node:test"
import { buildDiagnostic, redactSecrets } from "../electron/diagnostic.ts"

const FAKE_KEY = "sk-TEST-123456789abcdef"

test("redactSecrets : masque les formats de clés usuels", () => {
  assert.equal(redactSecrets(`la clé est ${FAKE_KEY} ok`), "la clé est sk-*** ok")
  assert.equal(redactSecrets("Bearer abcdef1234567890"), "Bearer ***")
  assert.equal(redactSecrets("gsk_toto1234567890 fini"), "gsk_*** fini")
  assert.equal(redactSecrets("api_key=abcdefgh123456"), "api_key=***")
  assert.ok(redactSecrets('authorization: "Bearer abcdef123456"').includes("***"))
})

test("buildDiagnostic : aucune valeur de clé, seulement les ids de providers", () => {
  const out = buildDiagnostic({
    versions: { electron: "35.7.5" },
    platform: "win32 x64",
    status: "ready",
    keyIds: ["openrouter", "groq", "codebuff"],
    assignments: { code: [{ ref: "deepseek/deepseek-chat-v4:free", label: "DeepSeek" }] },
    log: ["démarrage", "session.execution.succeeded"],
  })
  assert.match(out, /"openrouter"/)
  assert.match(out, /"groq"/)
  assert.match(out, /deepseek\/deepseek-chat-v4:free/) // une ref de modèle n'est PAS une clé
})

test("ANTI-FUITE : une clé plantée dans le tampon de log n'apparaît nulle part", () => {
  const out = buildDiagnostic({
    versions: { electron: "35.7.5" },
    platform: "win32 x64",
    status: "ready",
    keyIds: ["codebuff"],
    // Un message d'erreur a accidentellement embarqué la clé :
    log: ["Freebuff : erreur 401 pour sk-TEST-123456789abcdef — réessaye"],
    keyWarnings: { openrouter: `Clé refusée : ${FAKE_KEY}` },
  })
  assert.ok(!out.includes(FAKE_KEY), "la clé a fui dans le diagnostic !")
  assert.ok(!out.includes("TEST-123456789abcdef"), "fragments de la clé visibles")
  assert.match(out, /sk-\*\*\*/)
})
