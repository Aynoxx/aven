// v11.1.0 : session vocale du Poste. Le hook possède le micro, la segmentation
// (VAD pur, sans IA locale), l'appel IPC au host (STT/LLM/TTS) et la lecture
// phrase par phrase. Il ne rend aucune interface : le bandeau et les Réglages
// lisent `phase`, `label` et `error`.
//
// Choix explicites :
//   - l'audio vit en mémoire (Blob) et n'est jamais écrit sur disque ;
//   - reprendre la parole coupe la lecture et invalide la réponse en attente ;
//   - aucun repli payant : une erreur de quota s'affiche, elle ne bascule rien ;
//   - écoute continue tant que le micro n'est pas coupé et que l'app est prête.
import { useCallback, useEffect, useRef, useState } from "react"
import { api } from "../api"
import type { VoiceAnswer } from "../types"
// v11.3.0 : la phrase lue peut être un MP3 neuronal que la webview joue elle-même.
import { playVoiceSpeech, stopVoicePlayback } from "./playback"
// v11.4.0 : création de note — le brouillon, la question de confirmation et le
// classement du « oui » vivent dans un module pur testé.
import {
  NOTE_CANCELLED_REPLY,
  NOTE_CONFIRM_MS,
  NOTE_CONTENT_PROMPT,
  NOTE_UNCONFIRMED_REPLY,
  classifyNoteReply,
  noteConfirmPrompt,
  noteConfirmationOpen,
  noteCreatedReply,
  parseNoteDraft,
} from "./note"
// v11.4.1 : la webview s'entend elle-même — une transcription de sa propre voix
// n'est pas une réponse (elle annulait la note en attente).
import { isSelfEcho } from "./echo"
// v11.4.2 : couper la lecture à la détection de parole, sauf pendant une question
// de note — la voix de l'agent ne doit pas tronquer sa propre question.
import { shouldInterruptSpeech } from "./barge-in"
import { DEFAULT_VAD_CONFIG, initialVadState, vadStep, type VadState } from "./vad"
import {
  acceptsFollowUp,
  initialVoiceSession,
  reduceVoiceSession,
  voicePhaseLabel,
  type VoicePhase,
  type VoiceSessionEvent,
  type VoiceSessionState,
} from "./session"

/** Un segment plus court que ~75 ms d'audio n'est même pas envoyé au STT. */
const SEGMENT_MIN_BYTES = 1_200
/** Délai de garde après le début d'une phrase lue : évite l'auto-interruption par l'écho. */
const TTS_ECHO_BARRIER_MS = 900
const VAD_INTERVAL_MS = 50
// v11.1.1 : pré-roll. Le VAD n'ouvre un segment qu'après ~220 ms de voix : si
// l'enregistrement ne démarrait qu'à cet instant, le « A » de « Aven » était
// perdu et le mot d'activation n'arrivait jamais au STT. On démarre donc la
// capture dès la première trame au-dessus du seuil, et on jette le clip si
// aucune parole n'est confirmée dans cette fenêtre (bruit bref).
const PRE_ROLL_MS = 700

export type VoiceAgentApi = {
  phase: VoicePhase
  label: string
  muted: boolean
  error?: string
  heard?: string
  reply?: string
  toggleMic: () => void
  stop: () => void
}

export function useVoiceAgent(options: {
  enabled: boolean
  /** Exécute une commande de navigation ; renvoie la confirmation à lire. */
  onAction: (action: string) => string | void
  /**
   * v11.4.0 : écrit la note confirmée et renvoie son titre (pour le dire).
   * Appelée UNIQUEMENT après un « oui » explicite — jamais sur la demande seule.
   */
  onCreateNote: (draft: string) => Promise<string | null | undefined>
}): VoiceAgentApi {
  const [session, setSession] = useState<VoiceSessionState>(() => initialVoiceSession(false))
  const sessionRef = useRef(session)
  const optionsRef = useRef(options)
  optionsRef.current = options
  const enabledRef = useRef(options.enabled)
  enabledRef.current = options.enabled

  const streamRef = useRef<MediaStream | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const vadTimerRef = useRef<number | null>(null)
  const vadStateRef = useRef<VadState>(initialVadState())
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const discardNextRef = useRef(false)
  const preRollTimerRef = useRef<number | null>(null)
  const noiseFloorRef = useRef(0)
  const gestureArmedRef = useRef(false)
  const gestureHandlerRef = useRef<(() => void) | null>(null)
  const playbackTokenRef = useRef(0)
  const speakingSinceRef = useRef(0)
  // v11.4.1 : mémoire de la dernière phrase dite, pour la reconnaître si le
  // micro la reprend (haut-parleurs + STT).
  const spokenTextRef = useRef("")
  const spokenEndedAtRef = useRef(0)
  const setMutedRef = useRef<(muted: boolean) => void>(() => undefined)
  const startRecorderRef = useRef<(preRoll?: boolean) => void>(() => undefined)
  const segmentRef = useRef<(blob: Blob) => void>(() => undefined)
  const handlersRef = useRef<{ start: () => void; end: () => void }>({ start: () => undefined, end: () => undefined })

  const commit = useCallback((event: VoiceSessionEvent, now = Date.now()) => {
    const next = reduceVoiceSession(sessionRef.current, event, now)
    if (next === sessionRef.current) return next
    sessionRef.current = next
    setSession(next)
    return next
  }, [])

  const reportError = useCallback((error: unknown) => {
    const message = error instanceof DOMException && error.name === "NotAllowedError"
      ? "Accès au microphone refusé. Autorise-le pour Aven, puis active le micro."
      : error instanceof Error ? error.message : String(error)
    commit({ type: "error", message })
  }, [commit])

  const stopPlayback = useCallback(() => {
    playbackTokenRef.current += 1
    stopVoicePlayback()
    void api.voiceAgentStop().catch(() => undefined)
  }, [])

  // v11.3.0 : une réponse = une synthèse. La lecture phrase par phrase ajoutait le
  // temps réseau ET le silence de fin de chaque clip : ~1,5 s de trou entre deux
  // phrases (mesuré). Le service enchaîne les phrases d'un même texte avec ses
  // propres pauses (~0,9 s), sans coupure ajoutée. Une interruption invalide la
  // lecture (le token change) au lieu de laisser parler dans le vide.
  const speakReply = useCallback(async (text: string, requestId: number): Promise<boolean> => {
    const token = ++playbackTokenRef.current
    const stale = () => token !== playbackTokenRef.current || sessionRef.current.requestId !== requestId
    if (stale()) return false
    speakingSinceRef.current = Date.now()
    // v11.4.1 : ce que l'agent dit est mémorisé AVANT d'être joué — c'est la
    // référence qui permet de reconnaître sa propre voix dans une transcription.
    spokenTextRef.current = text
    // Le host choisit le moteur et rend l'audio ; la webview le joue. Voix Windows :
    // le host a déjà parlé, playVoiceSpeech rend `false` sans rien bloquer.
    const speech = await api.voiceAgentSay(text)
    spokenEndedAtRef.current = Date.now()
    if (stale()) return false
    await playVoiceSpeech(speech)
    // Fin de lecture réelle : la fin d'écho court à partir d'ici.
    spokenEndedAtRef.current = Date.now()
    // v11.3.0 : le service neuronal est gratuit mais non contractuel. Un repli sur
    // la voix Windows est possible, à condition de le dire.
    if (speech.warning) commit({ type: "error", message: speech.warning })
    return !stale()
  }, [commit])

  // v11.4.0 : une seule façon de prendre la parole. Réponses de commande,
  // questions de note et confirmations d'écriture passent par ici, pour que
  // l'interruption et l'anti-mélange de demandes s'appliquent partout.
  const say = useCallback(async (text: string) => {
    const requestId = sessionRef.current.requestId
    commit({ type: "speaking", requestId, reply: text })
    const finished = await speakReply(text, requestId)
    if (finished) commit({ type: "done" })
  }, [commit, speakReply])

  // ── Commande et demande libre ───────────────────────────────────────────────
  const runCommand = useCallback(async (command: string) => {
    if (command === "mute-microphone") {
      setMutedRef.current(true)
      return
    }
    if (command === "stop-speaking") {
      stopPlayback()
      commit({ type: "interrupt" })
      return
    }
    const confirmation = optionsRef.current.onAction(command)
    const text = typeof confirmation === "string" && confirmation.trim() ? confirmation : "C'est fait."
    await say(text)
  }, [say, stopPlayback])

  const ask = useCallback(async (demand: string) => {
    const requestId = sessionRef.current.requestId
    commit({ type: "thinking", requestId })
    try {
      const answer: VoiceAnswer = await api.voiceAgentAsk(demand)
      if (sessionRef.current.requestId !== requestId || sessionRef.current.micMuted) return
      if (!answer.text.trim()) {
        commit({ type: "interrupt" })
        return
      }
      commit({ type: "speaking", requestId, reply: answer.text })
      const finished = await speakReply(answer.text, requestId)
      if (finished) commit({ type: "done" })
    } catch (error) {
      reportError(error)
    }
  }, [commit, reportError, speakReply])

  // ── Création de note : aucune écriture sans « oui » explicite ────────────────
  // v11.4.0 : `draft: null` = Aven a demandé le texte et attend le contenu ;
  // `draft: "…"` = la question de confirmation a été posée. Dans les deux cas, la
  // note n'existe pas encore : seule la branche « confirm » écrit.
  const pendingNoteRef = useRef<{ draft: string | null; askedAt: number; timer: number | null } | null>(null)

  const clearPendingNote = useCallback(() => {
    const pending = pendingNoteRef.current
    if (pending && pending.timer !== null) window.clearTimeout(pending.timer)
    pendingNoteRef.current = null
  }, [])

  /**
   * Ouvre une attente de note et arme sa fermeture. La question n'est pas lue
   * ici : l'appelant choisit la phrase (contenu manquant ou confirmation).
   */
  const awaitNote = useCallback((draft: string | null) => {
    clearPendingNote()
    pendingNoteRef.current = {
      draft,
      askedAt: Date.now(),
      // v11.4.0 : passé le délai, un « oui » tardif n'écrit plus rien — une note
      // écrite sur un accord périmé serait une surprise silencieuse.
      timer: window.setTimeout(() => { pendingNoteRef.current = null }, NOTE_CONFIRM_MS),
    }
  }, [clearPendingNote])

  /** Question de confirmation : elle RÉPÈTE le contenu avant toute écriture. */
  const askNoteConfirmation = useCallback(async (draft: string) => {
    awaitNote(draft)
    await say(noteConfirmPrompt(draft))
  }, [awaitNote, say])

  /** Le contenu manquait : on le demande au lieu de deviner. */
  const askNoteContent = useCallback(async () => {
    awaitNote(null)
    await say(NOTE_CONTENT_PROMPT)
  }, [awaitNote, say])

  /** Le SEUL chemin d'écriture — atteint uniquement après un « oui » classé. */
  const writeConfirmedNote = useCallback(async (draft: string) => {
    clearPendingNote()
    try {
      const title = await optionsRef.current.onCreateNote(draft)
      await say(noteCreatedReply(typeof title === "string" ? title : undefined))
    } catch (error) {
      reportError(error)
    }
  }, [clearPendingNote, reportError, say])

  /** Traite une parole comme réponse à la note en attente et rend vrai si elle l'était. */
  const answerPendingNote = useCallback(async (text: string): Promise<boolean> => {
    const pending = pendingNoteRef.current
    if (!pending) return false
    // v11.4.0 : la décision expire même si la réponse arrive — sans quoi une
    // question oubliée resterait ouverte indéfiniment.
    if (!noteConfirmationOpen(pending.askedAt)) {
      clearPendingNote()
      await say(NOTE_UNCONFIRMED_REPLY)
      return true
    }
    if (pending.draft === null) {
      if (classifyNoteReply(text) === "cancel" || text.length < 2) {
        clearPendingNote()
        await say(NOTE_CANCELLED_REPLY)
      } else {
        // Le contenu vient d'être dit : il est répété, puis la confirmation est
        // redemandée. L'utilisateur ne peut donc pas écrire par inadvertance.
        await askNoteConfirmation(text)
      }
      return true
    }
    const reply = classifyNoteReply(text)
    if (reply === "confirm") {
      await writeConfirmedNote(pending.draft)
      return true
    }
    clearPendingNote()
    await say(reply === "cancel" ? NOTE_CANCELLED_REPLY : NOTE_UNCONFIRMED_REPLY)
    return true
  }, [askNoteConfirmation, clearPendingNote, say, writeConfirmedNote])

  // v11.1.1 : le chemin d'une transcription est isolé du micro. Le segment
  // audio n'est qu'un producteur de texte : mot d'activation, fenêtre de suivi,
  // commande et demande libre se décident ici, exactement pareil pour le micro
  // et pour la passerelle de test DEV (voir plus bas).
  const handleTranscript = useCallback(async (rawText: string) => {
    // v11.1.5 : ne jamais convertir une charge non textuelle en « [object Object] ».
    // C'est ce qui rendait une phrase muette : le host ré-emballait le résultat de
    // transcription, la chaîne devenait un objet et tout le reste était ignoré sans
    // la moindre erreur. Une rupture de contrat doit se voir, pas se taire.
    if (typeof rawText !== "string") {
      reportError(new Error("Transcription illisible : le host n'a pas renvoyé de texte."))
      return
    }
    const text = rawText.trim()
    commit({ type: "heard", text })
    if (!text) return
    // v11.4.1 : l'agent s'entend lui-même par les haut-parleurs. Sans ce garde, sa
    // propre phrase revient transcrite et passe pour une réponse : elle annulait
    // la note en attente. Rien n'est exécuté, la décision reste ouverte.
    if (isSelfEcho({
      heard: text,
      spoken: spokenTextRef.current,
      speaking: sessionRef.current.phase === "speaking",
      endedAt: spokenEndedAtRef.current,
    })) {
      commit({ type: "interrupt" })
      return
    }
    // v11.4.2 : la question de confirmation n'a pas été coupée à la détection de la
    // parole ; elle s'arrête ici, quand le texte prouve que c'est bien toi. Un écho
    // est déjà sorti plus haut : il n'arrête donc rien.
    if (pendingNoteRef.current) stopPlayback()
    // v11.4.0 : tant qu'une note attend sa confirmation, toute parole est une
    // réponse à cette question — « Aven » n'est pas exigé, et aucune autre
    // lecture ne s'intercale entre la question et la décision.
    try {
      if (await answerPendingNote(text)) return
    } catch (error) {
      reportError(error)
      return
    }
    try {
      const interpreted = await api.voiceAgentInterpret(text)
      // Sans mot d'activation ni fenêtre de suivi, la parole n'est pas adressée
      // à Aven : elle est ignorée (aucune action, aucune réponse).
      if (!interpreted.woken && !acceptsFollowUp(sessionRef.current)) {
        commit({ type: "interrupt" })
        return
      }
      if (interpreted.command) {
        await runCommand(interpreted.command)
        return
      }
      if (!interpreted.demand.trim()) {
        commit({ type: "interrupt" })
        return
      }
      // v11.4.0 : une demande de note ne part JAMAIS au LLM — il répondrait
      // « c'est noté » sans rien écrire. Elle ouvre la confirmation orale.
      const note = parseNoteDraft(interpreted.demand)
      if (note) {
        if (note.draft.trim()) await askNoteConfirmation(note.draft)
        else await askNoteContent()
        return
      }
      await ask(interpreted.demand)
    } catch (error) {
      reportError(error)
    }
  }, [answerPendingNote, ask, askNoteConfirmation, askNoteContent, commit, reportError, runCommand, stopPlayback])

  const handleSegment = useCallback(async (blob: Blob) => {
    if (blob.size < SEGMENT_MIN_BYTES) {
      commit({ type: "heard", text: "" })
      return
    }
    try {
      const buffer = await blob.arrayBuffer()
      const { text } = await api.voiceAgentTranscribe(new Uint8Array(buffer), blob.type || "audio/webm")
      await handleTranscript(text)
    } catch (error) {
      reportError(error)
    }
  }, [commit, handleTranscript, reportError])
  segmentRef.current = handleSegment

  // v11.1.1 : passerelle de test DEV — injecter un texte comme s'il venait du
  // STT, sans micro, et suivre la VRAIE réaction (navigation, lecture, erreur).
  // Absente du build de production : `import.meta.env.DEV` est faux après build.
  useEffect(() => {
    if (!import.meta.env.DEV) return
    const target = window as unknown as { __avenVoice?: { simulate: (text: string) => Promise<void>; state: () => VoiceSessionState } }
    target.__avenVoice = {
      simulate: (text: string) => handleTranscript(text),
      state: () => ({ ...sessionRef.current }),
    }
    return () => { delete target.__avenVoice }
  }, [handleTranscript])

  const clearPreRollTimer = useCallback(() => {
    if (preRollTimerRef.current !== null) {
      window.clearTimeout(preRollTimerRef.current)
      preRollTimerRef.current = null
    }
  }, [])

  const startRecorder = useCallback((preRoll = false) => {
    const stream = streamRef.current
    if (!stream || recorderRef.current) return
    try {
      const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"]
      const mime = candidates.find((type) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(type)) ?? ""
      const recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream)
      chunksRef.current = []
      discardNextRef.current = false
      recorder.ondataavailable = (event) => { if (event.data.size) chunksRef.current.push(event.data) }
      recorder.onstop = () => {
        const type = recorder.mimeType || mime || "audio/webm"
        const blob = new Blob(chunksRef.current, { type })
        chunksRef.current = []
        recorderRef.current = null
        // v11.1.1 : un pré-roll sans parole confirmée n'est jamais transcrit —
        // aucun quota consommé pour une porte qui claque.
        if (discardNextRef.current) {
          discardNextRef.current = false
          return
        }
        void segmentRef.current(blob)
      }
      recorder.start()
      recorderRef.current = recorder
      if (preRoll) {
        clearPreRollTimer()
        preRollTimerRef.current = window.setTimeout(() => {
          preRollTimerRef.current = null
          if (sessionRef.current.phase === "capturing") return
          discardNextRef.current = true
          const pending = recorderRef.current
          if (pending && pending.state !== "inactive") {
            try { pending.stop() } catch { discardNextRef.current = false }
          }
        }, PRE_ROLL_MS)
      }
    } catch (error) {
      reportError(error)
    }
  }, [clearPreRollTimer, reportError])
  startRecorderRef.current = startRecorder

  const handleSpeechStart = useCallback(() => {
    if (sessionRef.current.micMuted) return
    const previous = sessionRef.current.phase
    // Pendant une phrase lue, l'écho peut ressembler à une voix : garde courte.
    if (previous === "speaking" && Date.now() - speakingSinceRef.current < TTS_ECHO_BARRIER_MS) return
    clearPreRollTimer()
    discardNextRef.current = false
    // v11.4.2 : pendant une question de note, la lecture continue. Le micro
    // entend Aven ; couper ici tronquerait la question avant « Je l'enregistre ? ».
    // La question s'arrêtera dès que le texte aura prouvé que c'est toi.
    const cutNow = shouldInterruptSpeech({ phase: previous, awaitingNote: pendingNoteRef.current !== null })
    commit({ type: "speech-start" })
    if (cutNow) {
      // v11.3.0 : couper la lecture coupe aussi l'audio neuronal déjà décodé.
      stopPlayback()
    }
    // Le pré-roll contient déjà le début de la phrase : ne pas rouvrir de
    // recorder (cela perdrait précisément l'attaque du mot d'activation).
    startRecorderRef.current(false)
    // v11.3.0 : stopPlayback coupe désormais aussi l'audio neuronal.
  }, [clearPreRollTimer, commit, stopPlayback])

  const handleSpeechEnd = useCallback(() => {
    if (sessionRef.current.phase !== "capturing") return
    commit({ type: "speech-end" })
    const recorder = recorderRef.current
    if (recorder && recorder.state !== "inactive") {
      try { recorder.stop() } catch { commit({ type: "heard", text: "" }) }
    } else {
      commit({ type: "heard", text: "" })
    }
  }, [commit])
  handlersRef.current = { start: handleSpeechStart, end: handleSpeechEnd }

  // ── Boucle VAD et micro ─────────────────────────────────────────────────────
  const tick = useCallback(() => {
    const analyser = analyserRef.current
    if (!analyser) return
    const frames = new Float32Array(analyser.fftSize)
    analyser.getFloatTimeDomainData(frames)
    let sum = 0
    for (let i = 0; i < frames.length; i++) sum += frames[i] * frames[i]
    const rms = Math.sqrt(sum / frames.length)
    const phase = sessionRef.current.phase
    // v11.1.1 : seuil adaptatif. Sur un micro discret, la voix restait sous le
    // seuil fixe de 0,012 et aucun segment ne partait — le symptôme exact de
    // « rien ne se passe ». Le plancher suit le bruit ambiant (moyenne lente),
    // borné entre 0,006 et 0,02 : une voix proche le dépasse, un bruit constant
    // ne le déclenche pas indéfiniment.
    if (phase !== "capturing" && rms < 0.03) {
      noiseFloorRef.current = noiseFloorRef.current > 0
        ? noiseFloorRef.current * 0.97 + rms * 0.03
        : rms
    }
    const threshold = Math.min(0.02, Math.max(0.006, (noiseFloorRef.current || 0) * 2.4))
    // Pendant la lecture, le seuil monte : la voix de l'agent ne se coupe pas elle-même.
    const config = phase === "speaking"
      ? { ...DEFAULT_VAD_CONFIG, threshold: Math.max(threshold, DEFAULT_VAD_CONFIG.threshold) * 2.5 }
      : { ...DEFAULT_VAD_CONFIG, threshold }
    // Pré-roll uniquement hors capture : on garde l'attaque du mot d'activation.
    if (!vadStateRef.current.speaking && phase !== "capturing" && rms >= config.threshold && !recorderRef.current) {
      startRecorderRef.current(true)
    }
    const step = vadStep(vadStateRef.current, rms, performance.now(), config)
    vadStateRef.current = step.state
    if (step.event === "speech-start") handlersRef.current.start()
    else if (step.event === "speech-end") handlersRef.current.end()
  }, [])
  const tickRef = useRef(tick)
  tickRef.current = tick

  const startListening = useCallback(async () => {
    if (!enabledRef.current || sessionRef.current.micMuted) return
    try {
      let stream = streamRef.current
      if (!stream) {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("Le microphone n'est pas disponible dans cette fenêtre.")
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        })
        streamRef.current = stream
      }
      stream.getAudioTracks().forEach((track) => { track.enabled = true })
      if (!audioContextRef.current) {
        const context = new AudioContext()
        const source = context.createMediaStreamSource(stream)
        const analyser = context.createAnalyser()
        analyser.fftSize = 1024
        analyser.smoothingTimeConstant = 0.5
        source.connect(analyser)
        audioContextRef.current = context
        analyserRef.current = analyser
      }
      if (audioContextRef.current.state === "suspended") await audioContextRef.current.resume()
      // v11.1.1 : la politique d'autoplay de la webview peut garder l'AudioContext
      // suspendu : sans énergie, le VAD ne voit jamais de parole. On réessaie au
      // premier geste de l'utilisateur, une seule fois.
      if (audioContextRef.current.state !== "running" && !gestureArmedRef.current) {
        gestureArmedRef.current = true
        const resume = () => {
          window.removeEventListener("pointerdown", resume, true)
          window.removeEventListener("keydown", resume, true)
          gestureArmedRef.current = false
          gestureHandlerRef.current = null
          void audioContextRef.current?.resume().catch(() => undefined)
        }
        gestureHandlerRef.current = resume
        window.addEventListener("pointerdown", resume, true)
        window.addEventListener("keydown", resume, true)
      }
      if (vadTimerRef.current === null) {
        vadTimerRef.current = window.setInterval(() => tickRef.current(), VAD_INTERVAL_MS)
      }
    } catch (error) {
      reportError(error)
    }
  }, [reportError])

  const setMuted = useCallback((muted: boolean) => {
    const next = commit({ type: "mic", muted })
    if (next.phase === "muted") {
      // v11.4.0 : couper le micro renonce aussi à la note en attente — on ne
      // laisse pas une décision d'écriture ouverte sans moyen de répondre.
      clearPendingNote()
      stopPlayback()
      clearPreRollTimer()
      // Un clip en cours (pré-roll compris) ne doit pas être transcrit après
      // la coupure du micro.
      discardNextRef.current = true
      const recorder = recorderRef.current
      if (recorder && recorder.state !== "inactive") {
        try { recorder.stop() } catch { discardNextRef.current = false }
      }
      streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = false })
    } else {
      streamRef.current?.getAudioTracks().forEach((track) => { track.enabled = true })
      void startListening()
    }
    void api.setVoiceAgentPrefs({ micMuted: muted }).catch(() => undefined)
  }, [clearPendingNote, clearPreRollTimer, commit, startListening, stopPlayback])
  setMutedRef.current = setMuted

  // ── Cycle de vie ────────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    void api.voiceAgentPrefs()
      .then((prefs) => {
        if (cancelled || !prefs.micMuted) return
        // Le choix « micro coupé » est restauré avant toute demande de permission.
        commit({ type: "mic", muted: true })
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [commit])

  useEffect(() => {
    if (!options.enabled) return
    if (!sessionRef.current.micMuted) void startListening()
    return () => {
      if (vadTimerRef.current !== null) {
        window.clearInterval(vadTimerRef.current)
        vadTimerRef.current = null
      }
      clearPreRollTimer()
      if (gestureHandlerRef.current) {
        window.removeEventListener("pointerdown", gestureHandlerRef.current, true)
        window.removeEventListener("keydown", gestureHandlerRef.current, true)
        gestureHandlerRef.current = null
        gestureArmedRef.current = false
      }
      discardNextRef.current = true
      // v11.4.0 : aucune décision d'écriture ne survit au démontage du hook.
      clearPendingNote()
      const recorder = recorderRef.current
      if (recorder && recorder.state !== "inactive") {
        try { recorder.stop() } catch { /* déjà arrêté */ }
      }
      recorderRef.current = null
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = null
      analyserRef.current = null
      void audioContextRef.current?.close().catch(() => undefined)
      audioContextRef.current = null
      stopPlayback()
    }
  }, [clearPendingNote, clearPreRollTimer, options.enabled, startListening, stopPlayback])

  const toggleMic = useCallback(() => setMuted(!sessionRef.current.micMuted), [setMuted])
  const stop = useCallback(() => {
    // v11.4.0 : interrompre la lecture de la confirmation annule la note — une
    // écriture ne survit pas à un « stop ».
    clearPendingNote()
    stopPlayback()
    commit({ type: "interrupt" })
  }, [clearPendingNote, commit, stopPlayback])

  return {
    phase: session.phase,
    label: voicePhaseLabel(session.phase),
    muted: session.micMuted,
    error: session.error,
    heard: session.heard,
    reply: session.reply,
    toggleMic,
    stop,
  }
}
