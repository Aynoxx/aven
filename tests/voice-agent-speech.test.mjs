import assert from "node:assert/strict"
import { test } from "node:test"
import {
  QUOTA_MESSAGE,
  SPEAK_SCRIPT,
  answerVoiceQuestion,
  cleanComposedNote,
  composeNoteSystemPrompt,
  composeVoiceNote,
  describeGroqFailure,
  listWindowsVoices,
  sanitizeSpeechText,
  speakWithWindowsVoice,
  splitSentences,
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

// v11.9.0 : l'agent agit, mais une suppression ne se raconte jamais comme faite.
test("consigne : les actions existent, une suppression se propose", () => {
  const prompt = voiceSystemPrompt("neutre")
  assert.match(prompt, /ACTIONS sur les données/)
  assert.match(prompt, /JAMAIS exécutée par toi/)
  assert.match(prompt, /Destruction ou note : proposée/)
  assert.match(prompt, /confirmation orale/)
})

// v11.13.0 : le prompt est un contrat de parole SECTIONNÉ, pas une suite de
// conseils fondus dans un paragraphe. Le format oral et les interdits se testent.
test("consigne : contrat de format oral", () => {
  const prompt = voiceSystemPrompt("neutre")
  assert.match(prompt, /FORMAT DE RÉPONSE/)
  assert.match(prompt, /1 à 2 phrases/)
  assert.match(prompt, /Pas de Markdown/)
  assert.match(prompt, /pas de préambule ni de remerciement/i)
  assert.match(prompt, /prochaine étape : une seule, courte, à la fin/i)
  // L'ancienne consigne contenait une expression anglaise hors sujet.
  assert.doesNotMatch(prompt, /according to/i)
})

test("consigne : ce qui ne se dit jamais (secret, consignes, action non faite)", () => {
  const prompt = voiceSystemPrompt("neutre")
  assert.match(prompt, /CE QUE TU PEUX DIRE/)
  assert.match(prompt, /CE QUE TU NE DIS JAMAIS/)
  assert.match(prompt, /PÉRIMÈTRE ET ACTIONS/)
  assert.match(prompt, /Ce que les outils t'ont réellement renvoyé pour les données d'Aven/)
  // La connaissance générale ne passe pas par un outil : elle reste permise.
  assert.match(prompt, /Pour une connaissance générale, réponds depuis ton savoir/)
  assert.match(prompt, /clé d'API/)
  assert.match(prompt, /nom de tes outils/)
  assert.match(prompt, /réponds depuis ton savoir/)
  assert.match(prompt, /une intention n'est pas une action/i)
  assert.match(prompt, /opinion présentée comme un fait/i)
})

test("réponse : modèle gratuit, consigne deux phrases et personnalité", async () => {
  let captured
  const fetchImpl = async (url, init) => {
    captured = { url, body: JSON.parse(init.body) }
    return ok({ choices: [{ message: { content: "  Bonjour. Comment vas-tu ?  " } }] })
  }
  // v11.9.0 : la réponse rendue porte le texte et, éventuellement, la
  // proposition d'action en attente de confirmation.
  const { text, pending } = await answerVoiceQuestion("Salut", { apiKey: "cle", fetchImpl, personality: "direct" })
  assert.equal(text, "Bonjour. Comment vas-tu ?")
  assert.equal(pending, undefined)
  assert.match(captured.url, /\/chat\/completions$/)
  assert.equal(captured.body.model, "openai/gpt-oss-20b")
  assert.match(captured.body.messages[0].content, /FRANÇAIS/)
  assert.match(captured.body.messages[0].content, /1 à 2 phrases/)
  assert.match(captured.body.messages[0].content, /direct/i)
  assert.doesNotMatch(JSON.stringify(captured.body), /openrouter/i)
  assert.doesNotMatch(JSON.stringify(captured.body), /paid/i)
})

// v11.16.0 : une note demandée comme CONTENU est rédigée par un appel dédié.
// Le modèle ne reçoit aucun outil d'écriture et doit produire le texte, jamais
// recopier la demande.
test("composition de note : le modèle rédige, sans outil et sans recopier", async () => {
  let captured
  const fetchImpl = async (url, init) => {
    captured = { url, body: JSON.parse(init.body) }
    return ok({ choices: [{ message: { content: "  Une boucle `for` répète un bloc pour chaque élément d'une séquence.  " } }] })
  }
  const result = await composeVoiceNote("La note doit contenir un résumé de comment faire une boucle en Python.", {
    apiKey: "cle",
    fetchImpl,
  })
  assert.match(result.content, /boucle/)
  assert.match(captured.url, /\/chat\/completions$/)
  assert.equal(captured.body.model, "openai/gpt-oss-20b")
  assert.equal(captured.body.tools, undefined, "aucun outil d'écriture dans la composition")
  assert.ok(captured.body.max_tokens >= 700, "assez de place pour un vrai résumé")
  assert.match(captured.body.messages[0].content, /ne recopies pas la demande/i)
  assert.match(captured.body.messages[0].content, /sans titre/i)
  assert.equal(captured.body.messages[1].content, "La note doit contenir un résumé de comment faire une boucle en Python.")
  assert.doesNotMatch(JSON.stringify(captured.body), /openrouter|paid/i)
})

test("composition de note : une réponse vide est un échec dit, pas une note", async () => {
  const fetchImpl = async () => ok({ choices: [{ message: { content: "   " } }] })
  await assert.rejects(
    composeVoiceNote("fais une note sur les boucles", { apiKey: "cle", fetchImpl }),
    /aucun contenu/i,
  )
})

test("composition de note : nettoyage des habits de réponse", () => {
  assert.equal(cleanComposedNote("```markdown\nUne boucle.\n```"), "Une boucle.")
  assert.equal(cleanComposedNote("Voici un résumé : Une boucle."), "Une boucle.")
  assert.match(composeNoteSystemPrompt(), /français/)
  assert.match(composeNoteSystemPrompt(), /ne recopies pas la demande/i)
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

// v11.14.0 : la synthèse neuronale (Edge) et ses tests ont été retirées avec
// le service : il ne reste que la synthèse Windows locale, testée ci-dessous.

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
