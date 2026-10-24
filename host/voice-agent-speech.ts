// v11.1.3 : fournisseurs de l'agent vocal — STT et LLM distants (Groq, palier
// gratuit uniquement), et synthèse Windows via System.Speech.
// Contraintes du plan :
//   - AUCUN modèle ni serveur local ; l'audio part chez le fournisseur distant ;
//   - AUCUN repli payant : un 429 ou une indisponibilité s'affiche, elle ne
//     bascule jamais sur un service facturé ;
//   - aucune conservation de l'audio : les segments vivent en mémoire, rien
//     n'est écrit sur disque par ce module ;
//   - la voix Windows est choisie dans les Réglages et explicitement ;
//   - le texte est transmis par variables d'environnement (jamais interpolé
//     dans une commande PowerShell — évite l'injection par la dictée).
// Pur : `fetch` et le lanceur PowerShell sont injectables, donc testable avec
// Node seul, sans réseau ni Windows.
import type { VoicePersonality } from "./voice-agent-personality.js"
// v11.3.0 : voix neuronales via le service de lecture d'Edge (gratuit, sans compte).
// Le transport vit dans voice-agent-tts.ts ; ce module garde le nettoyage du
// texte, la décision de retenter une limite de débit et les messages lisibles.
import { requestEdgeSpeech, type EdgeSpeechRequester } from "./voice-agent-tts.js"
import { EDGE_RETRY_DELAY_MS, describeEdgeFailure, isEdgeRateLimit } from "./voice-agent-edge.js"
// v11.4.4 : dictionnaire de prononciation des noms propres, appliqué juste avant
// la synthèse. Une seule porte pour les deux moteurs, avec une table par moteur.
import { applyPronunciations } from "./pronunciation.js"
// v11.2.0 : outils de lecture — le modèle peut consulter l'espace au lieu de supposer.
import { MAX_CALLS_PER_TURN, MAX_TOOL_STEPS, VOICE_TOOLS, clip, readToolCalls, type VoiceToolRunner } from "./voice-agent-tools.js"

const GROQ_BASE = "https://api.groq.com/openai/v1"

export const STT_MODEL = "whisper-large-v3-turbo"
export const VOICE_AGENT_LLM_MODEL = "openai/gpt-oss-20b"

export const QUOTA_MESSAGE =
  "Quota gratuit Groq atteint. Aven n'a pas de repli payant : aucun service payant n'est déclenché automatiquement."

export function describeGroqFailure(status: number): string {
  if (status === 429) return QUOTA_MESSAGE
  // v11.1.5 : un 401 n'est pas une panne du service mais une clé absente ou refusée.
  // Le message doit dire où la corriger, sinon l'utilisateur ne peut rien en faire.
  if (status === 401 || status === 403) {
    return `Clé Groq refusée (HTTP ${status}) : vérifie-la dans Réglages → Services IA.`
  }
  return `Groq a refusé la réponse (HTTP ${status}).`
}

/**
 * STT distant Groq Whisper — texte transcrit en français.
 * Le segment audio (WebM/MP3) est envoyé à l'API Groq ; le texte renvoyé est
 * nettoyé localement (guillemets, espaces, ponctuation intrusive).
 * Pur : `fetch` injectable, testable sans réseau.
 */
/** Extension de fichier attendue par Whisper, déduite du type produit par MediaRecorder. */
function audioExtension(mime: string): string {
  if (mime.includes("ogg")) return "ogg"
  if (mime.includes("mp4")) return "m4a"
  if (mime.includes("wav")) return "wav"
  return "webm"
}

// v11.1.5 : la clé est un paramètre à part entière. Elle manquait : le host la passait
// à la place du type MIME, donc chaque segment partait SANS en-tête Authorization et
// Groq répondait 401 à chaque fois. Le type MIME se lit sur le Blob (audio.type).
export async function transcribeVoiceSegment(
  audio: Blob,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ text: string }> {
  const mime = audio.type || "audio/webm"
  const body = new FormData()
  body.set("file", new File([await audio.arrayBuffer()], `segment.${audioExtension(mime)}`, { type: mime }))
  body.set("language", "fr")
  body.set("model", STT_MODEL)

  const response = await fetchImpl(
    `${GROQ_BASE}/audio/transcriptions`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body,
      signal: AbortSignal.timeout(30_000),
    },
  )

  if (!response.ok) throw new Error(await describeGroqFailure(response.status))

  const raw = (await response.json()) as { text?: string }
  const cleaned = String(raw?.text ?? "")
    .replace(/^["\u201c\u201d\s]+/, "")
    .replace(/["\u201c\u201d\s]+$/, "")
    .replace(/\s+/g, " ")
    .trim()

  return { text: cleaned }
}

/**
 * System prompt de l'agent vocal — périmètre d'Aven, max deux phrases, pas de
 * Markdown, pas de code, pas de bruitage sonore, et directives prosodiques.
 */
export function voiceSystemPrompt(personality: VoicePersonality): string {
  const tone =
    personality === "direct"
      ? "Ton direct et factuel, sans flatterie ni remplissage."
      : personality === "chaleureux"
        ? "Ton chaleureux et bienveillant, sans familiarité excessive."
        : "Ton neutre et bref."

  const prosodicDirections =
    "Variez le rythme de parole : ralentissez légèrement sur les points importants, " +
    "accélérez sur les détails. " +
    "Insérez de courtes pauses après les virgules et avant les conjonctions majeures. " +
    "Utilisez un ton conversationnel : évitez le style « rapport de boîte de réception », " +
    "privilégiez « je pense que » / « according to ». " +
    "N'utilisez jamais de Markdown, de code, ni de description sonore dans la sortie vocale. " +
    "Gardez les réponses à deux phrases maximum, séparées par un point."

  return [
    "Tu es l'agent vocal d'Aven, un poste de travail de développement.",
    "Réponds en FRANÇAIS, à l'oral : deux phrases maximum, pas de Markdown, pas de code, aucun bruitage ni description de son.",
    "Si la demande est ambiguë, pose UNE question courte au lieu de deviner.",
    // v11.1.3 : le périmètre est une règle, pas une politesse. L'agent n'a
    // aucun outil hors de la webview ; la consigne doit le modèle de
    // raconter qu'il a la musique ou ouvert une application système.
    "Tu agis UNIQUEMENT à l'intérieur d'Aven : notes, fichiers, terminal intégré, orchestration, réglages.",
    "Tu n'as AUCUN accès à Windows, aux autres applications, à la musique, au volume, au réseau ou aux fichiers hors de l'espace de travail.",
    "Si on te demande d'ouvrir Spotify, de couper la musique, de régler le volume ou d'éteindre l'ordinateur, réponds que tu ne peux agir que dans Aven.",
    "Ne prétends jamais avoir exécuté une action que tu n'as pas faite, ni dans Aven ni dehors.",
    // v11.2.0 : les outils existent — la consigne doit dire de s'en servir, sinon le
    // modèle continue de répondre de mémoire et invente le contenu d'une note.
    "Tu disposes d'outils de LECTURE (état de l'app, recherche de notes, lecture d'une note). Utilise-les au lieu de supposer.",
    "Ne cite jamais le contenu d'une note ni un chiffre que tu n'as pas obtenu d'un outil : si la recherche ne trouve rien, dis-le.",
    tone,
    // Nouvelles directives de variété
    "Varie le rythme : ralentis sur l'important, accélère sur les détails. Pause courte après les virgules.",
  ].join(" ")
}

/** Un tour de la conversation vocale, borné par l'appelant. */
export type VoiceTurn = { role: "user" | "assistant"; content: string }

/** Message envoyé au fournisseur : le format est celui des outils (v11.2.0). */
export type VoiceChatMessage = {
  role: "system" | "user" | "assistant" | "tool"
  content: string | null
  tool_calls?: unknown[]
  tool_call_id?: string
}

function contentOf(json: unknown): string {
  const body = json as { choices?: Array<{ message?: { content?: unknown } }> }
  const content = body.choices?.[0]?.message?.content
  if (typeof content === "string") return content.trim()
  if (Array.isArray(content))
    return content
      .map((c) => (typeof (c as { text?: unknown }).text === "string" ? (c as { text: string }).text : ""))
      .join("")
      .trim()
  return ""
}

/**
 * Un tour de complétion Groq. Les outils ne sont proposés que si l'appelant a
 * fourni un exécutant : sans lui, l'agent reste un simple interlocuteur.
 */
async function chatCompletion(
  messages: VoiceChatMessage[],
  options: { apiKey: string; fetchImpl?: typeof fetch; temperature: number; maxTokens: number; withTools: boolean },
): Promise<{ content: string; tool_calls: unknown[] }> {
  const body: Record<string, unknown> = {
    model: VOICE_AGENT_LLM_MODEL,
    temperature: options.temperature,
    max_tokens: options.maxTokens,
    messages,
  }
  if (options.withTools) {
    body.tools = VOICE_TOOLS
    // Le modèle choisit : une question de conversation ne déclenche aucun outil.
    body.tool_choice = "auto"
  }
  const response = await (options.fetchImpl ?? fetch)(`${GROQ_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  })
  if (!response.ok) throw new Error(await describeGroqFailure(response.status))
  const json = (await response.json()) as { choices?: Array<{ message?: { tool_calls?: unknown } }> }
  const raw = json.choices?.[0]?.message?.tool_calls
  return { content: contentOf(json), tool_calls: Array.isArray(raw) ? raw : [] }
}

/**
 * Répond à une demande libre. `history` porte le contexte de la session (borné
 * par l'appelant). Lève une Error lisible en cas d'échec ; aucun repli payant.
 *
 * v11.2.0 : si `run` est fourni, la réponse peut s'appuyer sur les outils de
 * lecture (état de l'app, notes). La boucle est BORNÉE par MAX_TOOL_STEPS, puis
 * un dernier tour sans outils force une réponse parlée — jamais de silence.
 */
export async function answerVoiceQuestion(
  question: string,
  options: {
    apiKey: string
    fetchImpl?: typeof fetch
    personality: VoicePersonality
    history?: VoiceTurn[]
    run?: VoiceToolRunner
  },
): Promise<string> {
  const chat = { apiKey: options.apiKey, fetchImpl: options.fetchImpl }
  const messages: VoiceChatMessage[] = [
    { role: "system", content: voiceSystemPrompt(options.personality) },
    ...(options.history ?? []).slice(-6).map((turn) => ({ role: turn.role, content: turn.content })),
    { role: "user", content: question },
  ]
  const run = options.run
  if (!run) {
    const reply = await chatCompletion(messages, { ...chat, temperature: 0.4, maxTokens: 180, withTools: false })
    if (!reply.content) throw new Error("L'agent vocal n'a renvoyé aucune réponse.")
    return reply.content
  }
  for (let step = 0; step < MAX_TOOL_STEPS; step++) {
    // Température basse : on veut un choix d'outil stable, pas de la variété.
    const reply = await chatCompletion(messages, { ...chat, temperature: 0.2, maxTokens: 260, withTools: true })
    const calls = readToolCalls(reply.tool_calls)
    if (!calls.length) {
      if (!reply.content) throw new Error("L'agent vocal n'a renvoyé aucune réponse.")
      return reply.content
    }
    messages.push({ role: "assistant", content: reply.content || null, tool_calls: reply.tool_calls })
    for (const call of calls.slice(0, MAX_CALLS_PER_TURN)) {
      const outcome = await run(call)
      messages.push({ role: "tool", tool_call_id: call.id, content: clip(outcome.text) })
    }
    // Chaque appel doit recevoir sa réponse, sinon le tour suivant est refusé par
    // l'API : ceux qui dépassent le plafond reçoivent un refus explicite.
    for (const call of calls.slice(MAX_CALLS_PER_TURN)) {
      messages.push({ role: "tool", tool_call_id: call.id, content: "Trop d'appels à la fois : un seul outil par tour." })
    }
  }
  const final = await chatCompletion(messages, { ...chat, temperature: 0.4, maxTokens: 180, withTools: false })
  if (!final.content) throw new Error("L'agent vocal n'a renvoyé aucune réponse.")
  return final.content
}

/**
 * Découpe une réponse en phrases pour une lecture progressive. Les phrases trop
 * longues sont recoupées sur les virgules/points-virgules pour que la première
 * parole arrive vite.
 */
export function splitSentences(text: string): string[] {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim()
  if (!clean) return []
  const parts = clean.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) ?? [clean]
  const out: string[] = []
  for (const part of parts) {
    const sentence = part.trim()
    if (!sentence) continue
    if (sentence.length <= 220) { out.push(sentence); continue }
    let rest = sentence
    while (rest.length > 220) {
      const cut = Math.max(rest.lastIndexOf("; ", 160), rest.lastIndexOf(", ", 160), rest.lastIndexOf(" ", 160))
      if (cut <= 0) break
      out.push(rest.slice(0, cut + 1).trim())
      rest = rest.slice(cut + 1).trim()
    }
    if (rest) out.push(rest)
  }
  return out
}

/** Nettoie un texte avant synthèse : Markdown, liens, code et emoji de bruitage. */
export function sanitizeSpeechText(text: string): string {
  return String(text ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[*_#>~]/g, " ")
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/\s+/g, " ")
    // v11.3.0 : retirer le Markdown laissait « Aven . » — le service marquait alors
    // une pause et détachait la ponctuation. Point, virgule et points de suspension
    // ne prennent jamais d'espace devant en français ; on ne touche pas aux autres
    // signes (« : », « ! »), dont l'espace est voulu.
    .replace(/\s+([.,…])/g, "$1")
    .trim()
    .slice(0, 600)
}

/** scripts PowerShell. Le texte et la voix par
 * l'environnement du processus : aucune valeur dictée n'entre dans la commande. */
export const LIST_VOICES_SCRIPT =
  "Add-Type -AssemblyName System.Speech;" +
  "(New-Object System.Speech.Synthesis.SpeechSynthesizer).GetInstalledVoices()" +
  "| ForEach-Object { $_.VoiceInfo.Name }"

export const SPEAK_SCRIPT =
  "Add-Type -AssemblyName System.Speech;" +
  "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer;" +
  "if ($env:AVEN_SPEAK_VOICE) { try { $s.SelectVoice($env:AVEN_SPEAK_VOICE) } catch {} };" +
  "$s.Speak($env:AVEN_SPEAK_TEXT)"

/** Liste les voix Windows installées (une par ligne). */
// v11.3.0 : synthèse neuronale (Edge). Le texte est nettoyé AVANT l'envoi : le
// service prononce du Markdown tel quel, et une réponse d'agent en contient.
// Un 429 est retenté une seule fois (le service limite le débit) ; au-delà, le
// message remonte à l'appelant, qui bascule sur la voix Windows en le disant.
export async function synthesizeEdgeSpeech(
  text: string,
  voice: string,
  options: { retryDelayMs?: number; wait?: (ms: number) => Promise<void>; request?: EdgeSpeechRequester } = {},
): Promise<Uint8Array> {
  // v11.4.4 : la table « edge » est vide — les voix neuronales disent « Aven »
  // et « Freebuff » correctement ; on garde malgré tout le même passage, pour
  // qu'aucune voie de synthèse ne contourne le dictionnaire.
  const clean = applyPronunciations(sanitizeSpeechText(text), "edge")
  if (!clean) throw new Error("Aucun texte à prononcer.")
  const wait = options.wait ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const request = options.request ?? requestEdgeSpeech

  // v11.3.0 : une requête par réponse. La synthèse phrase par phrase insérait le
  // temps réseau PLUS la fin de silence de chaque clip (mesuré : ~1,5 s de trou
  // entre deux phrases), alors que le service enchaîne les phrases d'un même
  // texte avec ses propres pauses.
  const attempt = (): Promise<Uint8Array> => request(clean, voice)

  try {
    return await attempt()
  } catch (error) {
    if (!isEdgeRateLimit(error)) throw new Error(describeEdgeFailure(error))
    await wait(options.retryDelayMs ?? EDGE_RETRY_DELAY_MS)
    try {
      return await attempt()
    } catch (second) {
      throw new Error(describeEdgeFailure(second))
    }
  }
}

export async function listWindowsVoices(run: PowerShellRunner): Promise<string[]> {
  const stdout = await run(LIST_VOICES_SCRIPT)
  return stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

/** Lit une phrase avec la voix choisie (ou la voix par défaut de Windows). */
export async function speakWithWindowsVoice(
  text: string,
  voice: string | undefined,
  run: PowerShellRunner,
): Promise<void> {
  // v11.4.4 : la voix Windows est de la même famille ancienne que Piper : elle
  // avale « Freebuff ». C'est ici, et seulement ici, que le dictionnaire agit.
  const safe = applyPronunciations(sanitizeSpeechText(text), "sapi")
  if (!safe) return
  await run(SPEAK_SCRIPT, {
    AVEN_SPEAK_TEXT: safe,
    ...(voice ? { AVEN_SPEAK_VOICE: voice } : {}),
  })
  // v11.1.3 : la valeur envoyée est nettoyée, jamais le texte brut
}

export type PowerShellRunner = (script: string, env?: Record<string, string>) => Promise<string>

// v11.3.0 : deux moteurs, un seul chemin. Les voix neuronales passent par le
// service d'Edge (voice-agent-tts.ts, gratuit et sans compte) ; la voix Windows
// reste le repli local, hors ligne, sans conservation d'audio.
