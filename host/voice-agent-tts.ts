// v11.3.0 : transport du service vocal d'Edge (WebSocket), sans SDK.
// Pourquoi ce fichier existe : `msedge-tts` 2.1.0 — la version la plus récente —
// présentait une poignée de main que le service refuse désormais (HTTP 200 au
// lieu de 101) : 3 échecs sur 3 mesurés le 23/10/2026, quand le protocole
// ci-dessous répondait 9 fois sur 9 dans la même minute. Le service est gratuit
// et sans compte ; il ne demande qu'un jeton dérivé de l'horloge (calculé dans
// voice-agent-edge.ts, module pur testé).
//
// Protocole (celui de `edge-tts`, MIT) : configuration JSON, puis SSML ; l'audio
// arrive en trames binaires préfixées d'en-têtes, la synthèse se termine sur
// « Path:turn.end ». Aucun secret n'est manipulé, aucun fichier n'est écrit.
import { randomUUID } from "node:crypto"
import WebSocket from "ws"
import { EDGE_SPEECH_VERSION, EDGE_TRUSTED_TOKEN, edgeSpeechToken, escapeSsml } from "./voice-agent-edge.js"

export const EDGE_SPEECH_ENDPOINT = "wss://api.msedgeservices.com/tts/cognitiveservices/websocket/v1"
/** Format demandé : 24 kHz mono, 48 kbit/s — le même que la référence. */
const AUDIO_FORMAT = "audio-24khz-48kbitrate-mono-mp3"
const CONNECT_TIMEOUT_MS = 20_000

/** Horodatage attendu par le service (style JavaScript, en UTC). */
function stamp(at: number): string {
  return new Date(at).toUTCString().replace("GMT", "GMT+0000 (Coordinated Universal Time)")
}

/**
 * En-têtes de la poignée de main. Le cookie `muid` n'est pas décoratif : sans lui
 * le service répond 200 au lieu d'accepter le WebSocket (mesuré).
 */
function handshakeHeaders(): Record<string, string> {
  return {
    Pragma: "no-cache",
    "Cache-Control": "no-cache",
    Origin: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0",
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Accept-Language": "en-US,en;q=0.9",
    Cookie: `muid=${randomUUID().replaceAll("-", "").toUpperCase()};`,
  }
}

function configMessage(at: number): string {
  return (
    `X-Timestamp:${stamp(at)}\r\n` +
    "Content-Type:application/json; charset=utf-8\r\n" +
    "Path:speech.config\r\n\r\n" +
    '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},' +
    `"outputFormat":"${AUDIO_FORMAT}"}}}}\r\n`
  )
}

function ssmlMessage(text: string, voice: string, requestId: string, at: number): string {
  // La voix vient des préférences : on ne la laisse pas sortir de son alphabet.
  const safeVoice = String(voice ?? "").replace(/[^A-Za-z0-9-]/g, "") || "fr-FR-DeniseNeural"
  return (
    `X-RequestId:${requestId}\r\n` +
    "Content-Type:application/ssml+xml\r\n" +
    // Le « Z » après un horodatage déjà suffixé est une particularité du service.
    `X-Timestamp:${stamp(at)}Z\r\n` +
    "Path:ssml\r\n\r\n" +
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='fr-FR'>` +
    `<voice name='${safeVoice}'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>` +
    `${escapeSsml(text)}</prosody></voice></speak>`
  )
}

/** Signature d'une demande de synthèse — injectable pour tester le retry sans réseau. */
export type EdgeSpeechRequester = (text: string, voice: string) => Promise<Uint8Array>

/** Point d'injection des tests : aucun réseau n'est ouvert par les tests purs. */
export type EdgeSpeechTransport = {
  now?: () => number
  uuid?: () => string
  open?: (url: string, headers: Record<string, string>) => WebSocket
  timeoutMs?: number
}

/**
 * Demande la synthèse d'un texte et rend le MP3 complet.
 * Lève une erreur lisible : le host s'en sert pour annoncer le repli Windows.
 */
export async function requestEdgeSpeech(text: string, voice: string, options: EdgeSpeechTransport = {}): Promise<Uint8Array> {
  const now = options.now ?? Date.now
  const uuid = options.uuid ?? randomUUID
  const open = options.open ?? ((url: string, headers: Record<string, string>) => new WebSocket(url, { headers }))
  const at = now()
  const query = new URLSearchParams({
    "Ocp-Apim-Subscription-Key": EDGE_TRUSTED_TOKEN,
    "Sec-MS-GEC": edgeSpeechToken(at),
    "Sec-MS-GEC-Version": EDGE_SPEECH_VERSION,
    ConnectionId: uuid(),
  })
  const socket = open(`${EDGE_SPEECH_ENDPOINT}?${query.toString()}`, handshakeHeaders())
  const chunks: Buffer[] = []
  let settled = false

  return await new Promise<Uint8Array>((resolve, reject) => {
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { socket.close() } catch { /* déjà fermé */ }
      if (error) reject(error)
      else if (!chunks.length) reject(new Error("Le service vocal Edge n'a renvoyé aucun audio."))
      else resolve(new Uint8Array(Buffer.concat(chunks)))
    }
    const timer = setTimeout(
      () => finish(new Error(`Le service vocal Edge n'a pas répondu dans les ${Math.round((options.timeoutMs ?? CONNECT_TIMEOUT_MS) / 1000)} s.`)),
      options.timeoutMs ?? CONNECT_TIMEOUT_MS,
    )

    socket.on("open", () => {
      socket.send(configMessage(at))
      socket.send(ssmlMessage(text, voice, uuid(), at))
    })
    socket.on("message", (data: unknown, isBinary: boolean) => {
      if (isBinary) {
        const frame = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer)
        // Trame audio : 2 octets de longueur d'en-têtes, les en-têtes, puis le MP3.
        const headerLength = frame.readUInt16BE(0)
        if (frame.length > headerLength + 2) chunks.push(frame.subarray(headerLength + 2))
        return
      }
      if (String(data).includes("Path:turn.end")) finish()
    })
    socket.on("unexpected-response", (_request: unknown, response: { statusCode?: number }) => {
      // 429 = limite de débit ; le host retente une fois puis bascule en le disant.
      finish(new Error(`Le service vocal Edge a refusé la connexion (HTTP ${response?.statusCode ?? "inconnu"}).`))
    })
    socket.on("error", (error: Error) => finish(new Error(`Connexion au service vocal interrompue : ${error.message}`)))
    // v11.3.0 : le service dit POURQUOI il ferme (ex. « Unsupported voice … »,
    // code 1007). Sans ce motif, l'utilisateur lisait une panne réseau imaginaire.
    socket.on("close", (_code: number, reason: unknown) => {
      const detail = String(reason ?? "").trim()
      finish(new Error(detail || "Le service vocal Edge a fermé la connexion avant la fin de l'audio."))
    })
  })
}
