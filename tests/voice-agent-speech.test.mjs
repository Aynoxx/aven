import assert from "node:assert/strict"
import { test } from "node:test"
import {
  QUOTA_MESSAGE,
  SPEAK_SCRIPT,
  answerVoiceQuestion,
  describeGroqFailure,
  listWindowsVoices,
  sanitizeSpeechText,
  speakWithWindowsVoice,
  splitSentences,
  synthesizeEdgeSpeech,
  transcribeVoiceSegment,
  voiceSystemPrompt,
} from "../host/voice-agent-speech.ts"
import { DEFAULT_VOICE_PERSONALITY } from "../host/voice-agent-personality.ts"

// v11.1.0 : le palier gratuit est explicite, aucun repli payant n'existe, et le
// texte dicté n'entre jamais dans la commande PowerShell (injection).

const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })

test("quota gratuit : message explicite, jamais un repli payant", () => {
  assert.equal(describeGroqFailure(429), QUOTA_MESSAGE)
  assert.match(describeGroqFailure(429), /aucun service payant/i)
  assert.doesNotMatch(describeGroqFailure(429), /openrouter/i)
})

test("transcription : le segment part en français et le texte est nettoyé", async () => {
  let captured
  const fetchImpl = async (url, init) => {
    captured = { url, init }
    return ok({ text: "  Aven, ouvre les notes  " })
  }
  const text = await transcribeVoiceSegment(new Blob([new Uint8Array([1, 2])], { type: "audio/webm" }), "cle", fetchImpl)
  assert.deepEqual(text, { text: "Aven, ouvre les notes" })
  assert.match(captured.url, /\/audio\/transcriptions$/)
  assert.ok(captured.init.body instanceof FormData)
  assert.equal(captured.init.body.get("language"), "fr")
  assert.equal(captured.init.body.get("model"), "whisper-large-v3-turbo")
  // v11.1.5 : régression d'origine — la clé était passée à la place du type MIME et
  // aucune requête ne portait d'en-tête d'authentification (401 systématique).
  assert.equal(captured.init.headers.Authorization, "Bearer cle")
  assert.equal(captured.init.body.get("file").type, "audio/webm")
})

test("clé refusée : le message dit où la corriger, la panne reste une panne", () => {
  assert.match(describeGroqFailure(401), /Réglages → Services IA/)
  assert.match(describeGroqFailure(403), /Réglages → Services IA/)
  assert.match(describeGroqFailure(500), /HTTP 500/)
  assert.doesNotMatch(describeGroqFailure(401), /openrouter/i)
})

// v11.1.3 : l'agent agit seulement DANS Aven. La consigne doit le dire
// explicitement, sinon le modèle prétend couper la musique ou ouvrir Spotify.
test("consigne : périmètre limité à l'intérieur d'Aven", () => {
  const prompt = voiceSystemPrompt("neutre")
  assert.match(prompt, /UNIQUEMENT à l'intérieur d'Aven/)
  assert.match(prompt, /AUCUN accès à Windows/i)
  assert.match(prompt, /musique/)
  assert.match(prompt, /volume/)
  assert.match(prompt, /ne peux agir que dans Aven/i)
})

test("réponse : modèle gratuit, consigne deux phrases et personnalité", async () => {
  let captured
  const fetchImpl = async (url, init) => {
    captured = { url, body: JSON.parse(init.body) }
    return ok({ choices: [{ message: { content: "  Bonjour. Comment vas-tu ?  " } }] })
  }
  const text = await answerVoiceQuestion("Salut", { apiKey: "cle", fetchImpl, personality: "direct" })
  assert.equal(text, "Bonjour. Comment vas-tu ?")
  assert.match(captured.url, /\/chat\/completions$/)
  assert.equal(captured.body.model, "openai/gpt-oss-20b")
  assert.match(captured.body.messages[0].content, /FRANÇAIS/)
  assert.match(captured.body.messages[0].content, /deux phrases/)
  assert.match(captured.body.messages[0].content, /direct/i)
  assert.doesNotMatch(JSON.stringify(captured.body), /openrouter/i)
  assert.doesNotMatch(JSON.stringify(captured.body), /paid/i)
})

test("réponse : un 429 lève le message de quota", async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ error: { message: "rate limit" } }), { status: 429 })
  await assert.rejects(
    answerVoiceQuestion("Salut", { apiKey: "cle", fetchImpl, personality: DEFAULT_VOICE_PERSONALITY }),
    /Quota gratuit Groq atteint/,
  )
})

test("découpage en phrases : lecture progressive", () => {
  assert.deepEqual(splitSentences("Bonjour. Comment vas-tu ? Très bien !"), [
    "Bonjour.",
    "Comment vas-tu ?",
    "Très bien !",
  ])
  assert.deepEqual(splitSentences("   "), [])
})

test("découpage : une phrase trop longue est recoupée", () => {
  const long = "mot, ".repeat(80).trim() + "."
  const parts = splitSentences(long)
  assert.ok(parts.length > 1, "la phrase longue est recoupée pour parler vite")
  assert.ok(parts.every((part) => part.length <= 230), "aucun morceau démesuré")
})

test("nettoyage avant synthèse : Markdown, liens et code retirés", () => {
  const cleaned = sanitizeSpeechText("**Salut** `code` [lien](https://exemple.fr) ![img](x.png) ```js\nx\n``` merci")
  assert.doesNotMatch(cleaned, /\*\*|`|https?:|!\[/)
  assert.match(cleaned, /Salut/)
  assert.ok(cleaned.length <= 600)
  // v11.3.0 : le retrait du Markdown ne laisse jamais un espace avant la ponctuation,
  // que le service lirait comme une pause.
  assert.doesNotMatch(cleaned, /\s[.,…]/)
  // L'espace devant « : » reste voulu (typographie française), celui devant le point non.
  assert.equal(sanitizeSpeechText("**Aven** : fini."), "Aven : fini.")
})

// v11.3.0 : la synthèse neuronale est testée sans réseau — le transport est
// injecté. Deux comportements comptent : une limite de débit se retente UNE fois,
// une panne ordinaire ne se retente pas et garde un message lisible.
test("voix neuronale : un 429 est retenté une fois, avec le texte nettoyé", async () => {
  let calls = 0
  const requests = []
  const waits = []
  const audio = await synthesizeEdgeSpeech("Bonjour **Aven**. Voici `du code`.", "fr-FR-DeniseNeural", {
    request: async (text) => {
      requests.push(text)
      calls++
      if (calls === 1) throw new Error("Le service vocal Edge a refusé la connexion (HTTP 429).")
      return new Uint8Array([1, 2, 3])
    },
    wait: async (ms) => { waits.push(ms) },
  })
  assert.deepEqual([...audio], [1, 2, 3])
  assert.equal(calls, 2, "une seule seconde tentative")
  assert.deepEqual(waits, [1_200], "le délai vient de la constante, pas d'un littéral")
  assert.deepEqual(requests, ["Bonjour Aven. Voici du code.", "Bonjour Aven. Voici du code."])
})

test("voix neuronale : une panne ordinaire n'est pas retentée", async () => {
  let calls = 0
  await assert.rejects(
    synthesizeEdgeSpeech("Bonjour.", "fr-FR-DeniseNeural", {
      request: async () => {
        calls++
        throw new Error("Le service vocal Edge a refusé la connexion (HTTP 503).")
      },
      wait: async () => undefined,
    }),
    /HTTP 503/,
  )
  assert.equal(calls, 1)
})

test("voix neuronale : un texte vide n'appelle pas le réseau", async () => {
  let calls = 0
  await assert.rejects(
    synthesizeEdgeSpeech("   ", "fr-FR-DeniseNeural", {
      request: async () => {
        calls++
        return new Uint8Array([1])
      },
    }),
    /Aucun texte à prononcer/,
  )
  assert.equal(calls, 0)
})

test("voix Windows : liste nettoyée", async () => {
  const voices = await listWindowsVoices(async () => "Microsoft Hortense\r\nMicrosoft Paul\r\n\r\n")
  assert.deepEqual(voices, ["Microsoft Hortense", "Microsoft Paul"])
})

test("lecture : le texte passe par l'environnement, jamais dans la commande", async () => {
  let captured
  await speakWithWindowsVoice("Bonjour **Aven**", "Microsoft Hortense", async (script, env) => {
    captured = { script, env }
    return ""
  })
  assert.equal(captured.script, SPEAK_SCRIPT)
  // v11.4.4 : la voix locale applique le dictionnaire de prononciation, d'où
  // « Aveun ». Le Markdown, lui, reste retiré avant : les deux corrections se
  // cumulent, et le test vérifie le texte réellement envoyé au moteur.
  assert.equal(captured.env.AVEN_SPEAK_TEXT, "Bonjour Aveun")
  assert.equal(captured.env.AVEN_SPEAK_VOICE, "Microsoft Hortense")
  assert.doesNotMatch(captured.script, /Bonjour/)
  assert.doesNotMatch(SPEAK_SCRIPT, /' \+|\+ '/, "aucune concaténation PowerShell")
})
