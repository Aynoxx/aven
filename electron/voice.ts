// Canal d'entrée vocal Aven (v8.8.0) : dictée push-to-talk.
//   1. transcription Whisper (whisper-large-v3-turbo) via Groq — audio webm/opus ~30 Ko/10 s ;
//   2. passe de reformage (modèle texte Groq, temperature 0) : supprime hésitations,
//      répétitions et faux départs, corrige les lapsus évidents — SANS répondre à la
//      demande ni ajouter d'information ;
//   3. classification d'intention (v8.8.0, en PARALLÈLE du reformage) : commande
//      d'application, changement d'agent, ou dictée ordinaire (voice-intent.ts) ;
//   4. en cas d'échec (429, réseau, timeout) le texte BRUT est renvoyé : la dictée
//      n'est jamais bloquante, et une passe manquante dégrade sans casser l'autre.
// Sans dépendance à Electron : testable avec Node seul (fetch et clé injectables).
import { loadKeys } from "./settings.js"
import { classifyIntent, type DictationIntent } from "./voice-intent.js"

const GROQ_BASE = "https://api.groq.com/openai/v1"
export const STT_MODEL = process.env.AVEN_VOICE_STT_MODEL || "whisper-large-v3-turbo"
export const CLEAN_MODEL = process.env.AVEN_VOICE_CLEAN_MODEL || "openai/gpt-oss-20b"

export type DictationResult = {
  raw: string // transcription Whisper telle quelle
  cleaned?: string // après passe de reformage (absent si la passe a échoué)
  cleanedBy?: string // nom du modèle de reformage
  warning?: string // raison pour laquelle le reformage n'a pas eu lieu
  intent?: DictationIntent // routage décidé par la passe d'intention (absent si elle a échoué)
}

const CLEAN_SYSTEM_PROMPT = [
  "Tu es un correcteur de dictée vocale en français. On te donne la transcription brute de la parole d'un utilisateur.",
  "Réécris-la en une demande claire et concise : supprime les hésitations (« euh », « ben »), les répétitions,",
  "les faux départs et les mots orphelins ; corrige les lapsus évidents.",
  "N'ajoute aucune information, ne réponds jamais à la demande, ne pose pas de question, ne change pas le sens.",
  "Conserve les noms de fichiers, commandes et termes techniques tels qu'entendus.",
  "Si le texte est incompréhensible, renvoie-le tel quel.",
  "Réponds uniquement par le texte corrigé, sans guillemets ni commentaire.",
].join(" ")

/** Extraction du texte d'une réponse de chat completion, défensive. */
function textOfCompletion(body: unknown): string {
  const choices = (body as { choices?: Array<{ message?: { content?: unknown } }> })?.choices
  const content = choices?.[0]?.message?.content
  if (typeof content === "string") return content.trim()
  if (Array.isArray(content)) {
    return content.map((c) => (typeof (c as { text?: unknown })?.text === "string" ? (c as { text: string }).text : "")).join("").trim()
  }
  return ""
}

/** Détail d'erreur lisible depuis une réponse Groq. */
async function groqError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } | string; message?: string }
    const detail = typeof body.error === "string" ? body.error : body.error?.message ?? body.message
    if (detail) return detail
  } catch { /* réponse non JSON */ }
  return `${fallback} (HTTP ${response.status})`
}

/** Transcrit un blob audio via Whisper (Groq). Lève une Error lisible en cas d'échec. */
export async function transcribeWithGroq(
  audio: Blob,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const form = new FormData()
  // Extension cohérente avec le mime type produit par MediaRecorder côté renderer.
  const mime = audio.type || "audio/webm"
  const ext = mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "m4a" : mime.includes("wav") ? "wav" : "webm"
  form.append("file", audio, `dictation.${ext}`)
  form.append("model", STT_MODEL)
  form.append("language", "fr")
  form.append("response_format", "json")
  form.append("temperature", "0")

  const response = await fetchImpl(`${GROQ_BASE}/audio/transcriptions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok) throw new Error(await groqError(response, "Groq a refusé la transcription"))
  const body = (await response.json()) as { text?: unknown }
  const text = typeof body.text === "string" ? body.text.trim() : ""
  if (!text) throw new Error("Groq n'a renvoyé aucune transcription.")
  return text
}

/** Passe de reformage : nettoie la dictée SANS y répondre. Échec = exception (gérée par l'appelant). */
export async function cleanTranscript(
  raw: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string> {
  const response = await fetchImpl(`${GROQ_BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: CLEAN_MODEL,
      temperature: 0,
      max_tokens: 500,
      messages: [
        { role: "system", content: CLEAN_SYSTEM_PROMPT },
        { role: "user", content: raw },
      ],
    }),
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(await groqError(response, "Groq a refusé le reformage"))
  const cleaned = textOfCompletion(await response.json())
  // Un reformage vide est pire que le brut : on l'ignore.
  if (!cleaned) throw new Error("Le reformage a renvoyé un texte vide.")
  return cleaned
}

/**
 * Pipeline complet : transcription + reformage (best effort). Jamais bloquant pour le
 * reformage ; lève seulement si la transcription échoue. La clé est injectable pour les
 * tests ; en production, main.ts omet l'argument et la clé vient des Réglages (chiffrée).
 */
export async function transcribeSpeech(
  audio: Blob,
  fetchImpl: typeof fetch = fetch,
  apiKeyOverride?: string,
): Promise<DictationResult> {
  const apiKey = (apiKeyOverride ?? loadKeys().groq)?.trim()
  if (!apiKey) throw new Error("Configure une clé Groq dans Paramètres pour dicter.")

  const raw = await transcribeWithGroq(audio, apiKey, fetchImpl)
  // Reformage et classification partent en PARALLÈLE : la classification (réponse très
  // courte) n'ajoute aucune latence, et un échec de l'une n'affecte pas l'autre.
  const [cleanedRes, intentRes] = await Promise.allSettled([
    cleanTranscript(raw, apiKey, fetchImpl),
    classifyIntent(raw, apiKey, fetchImpl),
  ])
  const result: DictationResult = { raw }
  if (cleanedRes.status === "fulfilled") {
    if (cleanedRes.value !== raw) { // rien à reformer
      result.cleaned = cleanedRes.value
      result.cleanedBy = CLEAN_MODEL
    }
  } else {
    // La dictée doit rester utilisable même sans reformage (quota, réseau, timeout).
    const reason = cleanedRes.reason
    result.warning = reason instanceof Error ? reason.message : String(reason)
  }
  // L'intention est best effort : absente = la dictée se comporte comme en v8.7.9.
  if (intentRes.status === "fulfilled") result.intent = intentRes.value
  return result
}
