import assert from "node:assert/strict"
import { test } from "node:test"
import { cleanTranscript, transcribeSpeech, transcribeWithGroq } from "../electron/voice.ts"

/** Fabrique un fetch factice qui répond selon l'URL appelée. */
function fakeFetch(routes) {
  const calls = []
  const fn = async (url, init) => {
    calls.push({ url: String(url), init })
    const route = routes.find((r) => url.includes(r.match))
    if (!route) throw new Error(`URL inattendue : ${url}`)
    if (route.fail) {
      return new Response(JSON.stringify({ error: { message: route.fail } }), { status: route.status ?? 429, headers: { "Content-Type": "application/json" } })
    }
    return new Response(JSON.stringify(route.body), { status: 200, headers: { "Content-Type": "application/json" } })
  }
  fn.calls = calls
  return fn
}

const AUDIO = new Blob(["fake-audio-bytes"], { type: "audio/webm" })
const KEY = "gsk_test"
// transcribeSpeech : clé injectée en 3e argument (en production, main.ts omet l'argument
// et la clé vient des Réglages chiffrées).

test("transcribeWithGroq envoie le fichier, le modèle et la langue", async () => {
  const f = fakeFetch([{ match: "/audio/transcriptions", body: { text: "  euh corrige le bug de login  " } }])
  const text = await transcribeWithGroq(AUDIO, KEY, f)
  assert.equal(text, "euh corrige le bug de login") // trim appliqué
  const call = f.calls[0]
  assert.ok(call.url.includes("/audio/transcriptions"))
  assert.equal(call.init.headers.Authorization, `Bearer ${KEY}`)
  const form = call.init.body
  assert.ok(form.get("model"))
  assert.equal(form.get("language"), "fr")
  assert.equal(form.get("temperature"), "0")
  assert.ok(form.get("file"))
})

test("transcribeWithGroq lève une erreur lisible si Groq refuse (429)", async () => {
  const f = fakeFetch([{ match: "/audio/transcriptions", fail: "Rate limit exceeded", status: 429 }])
  await assert.rejects(() => transcribeWithGroq(AUDIO, KEY, f), /Rate limit exceeded/)
})

test("cleanTranscript réécrit avec le prompt verrouillé et temperature 0", async () => {
  const f = fakeFetch([{ match: "/chat/completions", body: { choices: [{ message: { content: "Corrige le bug de connexion." } }] } }])
  const out = await cleanTranscript("euh corrige euh le bug de connexion", KEY, f)
  assert.equal(out, "Corrige le bug de connexion.")
  const sent = JSON.parse(f.calls[0].init.body)
  assert.equal(sent.temperature, 0)
  assert.ok(sent.messages[0].content.includes("ne réponds jamais à la demande"))
  assert.equal(sent.messages[1].content, "euh corrige euh le bug de connexion")
})

test("transcribeSpeech renvoie brut + cleaned quand tout réussit", async () => {
  const f = fakeFetch([
    { match: "/audio/transcriptions", body: { text: "euh ajoute un mode sombre stp" } },
    { match: "/chat/completions", body: { choices: [{ message: { content: "Ajoute un mode sombre." } }] } },
  ])
  const result = await transcribeSpeech(AUDIO, f, KEY)
  assert.equal(result.raw, "euh ajoute un mode sombre stp")
  assert.equal(result.cleaned, "Ajoute un mode sombre.")
  assert.ok(result.cleanedBy)
  assert.equal(result.warning, undefined)
})

test("transcribeSpeech : échec du reformage = texte brut + warning, jamais d'exception", async () => {
  const f = fakeFetch([
    { match: "/audio/transcriptions", body: { text: "texte brut correct" } },
    { match: "/chat/completions", fail: "Rate limit exceeded", status: 429 },
  ])
  const result = await transcribeSpeech(AUDIO, f, KEY)
  assert.equal(result.raw, "texte brut correct")
  assert.equal(result.cleaned, undefined)
  assert.match(result.warning, /Rate limit exceeded/)
})

test("transcribeSpeech : reformage identique au brut = pas de cleaned inutile", async () => {
  const f = fakeFetch([
    { match: "/audio/transcriptions", body: { text: "texte déjà propre" } },
    { match: "/chat/completions", body: { choices: [{ message: { content: "texte déjà propre" } }] } },
  ])
  const result = await transcribeSpeech(AUDIO, f, KEY)
  assert.equal(result.cleaned, undefined)
  assert.equal(result.warning, undefined)
})

test("transcribeSpeech : transcription vide ou refusée = exception (le renderer affiche l'erreur)", async () => {
  const f = fakeFetch([{ match: "/audio/transcriptions", body: { text: "" } }])
  await assert.rejects(() => transcribeSpeech(AUDIO, f, KEY), /aucune transcription/)
  const f2 = fakeFetch([{ match: "/audio/transcriptions", fail: "invalid api key", status: 401 }])
  await assert.rejects(() => transcribeSpeech(AUDIO, f2, KEY), /invalid api key/)
})

// Sans clé configurée : process.env.GROQ_API_KEY absent dans l'environnement de test → erreur claire.
test("transcribeSpeech sans clé lève un message orienté utilisateur", async () => {
  const saved = process.env.GROQ_API_KEY
  delete process.env.GROQ_API_KEY
  try {
    await assert.rejects(() => transcribeSpeech(AUDIO, fakeFetch([])), /clé Groq/)
  } finally {
    if (saved !== undefined) process.env.GROQ_API_KEY = saved
  }
})
