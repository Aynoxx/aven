// Dictée push-to-talk (v8.7.8) : on maintient le bouton (ou le raccourci), on parle,
// on relâche → l'audio part vers Groq (transcription + reformage) et le texte atterrit
// dans le composeur, JAMAIS directement chez l'agent : c'est l'utilisateur qui valide.
import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "./api"
import type { DictationResult } from "./types"

export type DictationState = "idle" | "recording" | "transcribing" | "error"

export function useDictation(options: {
  onText: (result: DictationResult) => void
  onError: (message: string) => void
  /** Enregistrement trop court pour contenir de la parole (< ~75 ms). */
  onTooShort?: () => void
  /** Transcription réussie mais vide (silence ou bruit sans parole reconnaissable). */
  onEmpty?: () => void
}) {
  const [state, setState] = useState<DictationState>("idle")
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const mimeTypeRef = useRef("audio/webm")
  const cancellingRef = useRef(false)

  const cleanup = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    recorderRef.current = null
    chunksRef.current = []
  }, [])

  const start = useCallback(async () => {
    if (recorderRef.current || state !== "idle") return
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error("Le microphone n'est pas disponible dans cette fenêtre.")
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      })
      streamRef.current = stream
      // webm/opus : compact (~30 Ko / 10 s), accepté par Groq. Fallback ogg si webm absent.
      const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]
      mimeTypeRef.current = candidates.find((m) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) ?? ""
      const recorder = mimeTypeRef.current ? new MediaRecorder(stream, { mimeType: mimeTypeRef.current }) : new MediaRecorder(stream)
      chunksRef.current = []
      recorder.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data) }
      recorder.onstop = () => {
        if (cancellingRef.current) {
          cancellingRef.current = false
          cleanup()
          setState("idle")
          return
        }
        const mime = recorder.mimeType || mimeTypeRef.current || "audio/webm"
        const blob = new Blob(chunksRef.current, { type: mime })
        cleanup()
        if (blob.size < 1200) { // < ~75 ms d'audio : clic involontaire — on prévient, on n'ignore pas
          setState("idle")
          options.onTooShort?.()
          return
        }
        setState("transcribing")
        blob.arrayBuffer().then((buffer) => api.voiceTranscribe(new Uint8Array(buffer), mime))
          .then((result) => {
            setState("idle")
            if (!result.raw?.trim()) {
              options.onEmpty?.() // silence ou bruit sans parole : message clair plutôt que rien
              return
            }
            options.onText(result)
          })
          .catch((err) => {
            setState("error")
            options.onError(err instanceof Error ? err.message : String(err))
          })
      }
      recorderRef.current = recorder
      recorder.start() // pas de timeslice : un seul blob à l'arrêt
      setState("recording")
    } catch (err) {
      cleanup()
      setState("error")
      const message = err instanceof DOMException && err.name === "NotAllowedError"
        ? "L'accès au microphone a été refusé. Autorise-le pour Aven puis réessaie."
        : err instanceof Error ? err.message : String(err)
      options.onError(message)
    }
  }, [cleanup, options, state])

  const stop = useCallback(() => {
    // L'arrêt déclenche onstop → envoi + transcription.
    try { recorderRef.current?.stop() } catch { /* déjà arrêté */ }
  }, [])

  const cancel = useCallback(() => {
    // Marque l'annulation AVANT le stop : onstop saura que ce clip ne doit pas partir.
    chunksRef.current = []
    cancellingRef.current = true
    try { recorderRef.current?.stop() } catch { /* déjà arrêté */ }
    setState("idle")
    cleanup()
  }, [cleanup])

  // Filet de sécurité : si la promesse d'IPC n'aboutit jamais (main bloqué, crash),
  // on ne reste pas coincé sur « Transcription… » plus de 35 s.
  useEffect(() => {
    if (state !== "transcribing") return
    const t = setTimeout(() => setState((s) => (s === "transcribing" ? "error" : s)), 35_000)
    return () => clearTimeout(t)
  }, [state])

  const resetError = useCallback(() => setState((s) => (s === "error" ? "idle" : s)), [])

  return { state, start, stop, cancel, resetError }
}
