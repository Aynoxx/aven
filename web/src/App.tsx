import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { FormEvent, MouseEvent, ReactNode } from "react"
import { api } from "./api"
import Markdown from "./Markdown"
import MessageBubble from "./MessageBubble"
import { applyEvent, emptyLive, type Live } from "./stream"
import type { Agent, AppAction, AppState, Chat, Decision, FormAnswer, Msg, StreamEvent } from "./types"
import type { AggregatedStats } from "./types"
import FormDialog from "./FormDialog"
import SettingsDialog from "./SettingsDialog"
import NotesDialog from "./NotesDialog"
import { useAppearance } from "./appearance"
import { useDictation } from "./voice-dictation"
import { buildPrompt, selectionWithin } from "./selection-actions"
import { groupChatsByAgent } from "./chat-groups"
import { effectiveBackend, nextManualChoice, type ManualChoice } from "./backend-choice"
import { Icon, type IconName } from "./icons"
import "./App.css"

type Notice = { id: string; text: string }

function orderAgents(agents: Agent[], order: string[]) {
  const byId = new Map(agents.map((agent) => [agent.id, agent]))
  const ordered = order.map((id) => byId.get(id)).filter((agent): agent is Agent => Boolean(agent))
  const missing = agents.filter((agent) => !order.includes(agent.id))
  return [...ordered, ...missing]
}

export default function App() {
  const [agents, setAgents] = useState<Agent[]>([])
  const [tab, setTab] = useState("")
  const [chats, setChats] = useState<Chat[]>([])
  const [showArchived, setShowArchived] = useState(false)
  const [search, setSearch] = useState("")
  const [homeCommand, setHomeCommand] = useState("")
  const [loadedFor, setLoadedFor] = useState("")
  const [renamingChat, setRenamingChat] = useState<string | null>(null)
  const [chatValue, setChatValue] = useState("")
  const [renamingAgent, setRenamingAgent] = useState<string | null>(null)
  const [agentValue, setAgentValue] = useState("")
  const renameCancelled = useRef(false)
  const renameBusy = useRef(false)
  const creatingRef = useRef<Set<string>>(new Set())
  const autoFailed = useRef<Set<string>>(new Set())
  const [chatId, setChatId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [live, setLive] = useState<Live>(emptyLive)
  const [input, setInput] = useState("")
  // v9.0.0 : Freebuff prioritaire sur l'agent code (si clé + réglage) ; le bouton du
  // composeur reste un override manuel tri-état (auto / forcé / désactivé).
  const [freebuffOverride, setFreebuffOverride] = useState<ManualChoice>(null)
  const [error, setError] = useState<string>()
  const [appState, setAppState] = useState<AppState>({ status: "starting", keys: {}, providers: [], updatesConfigured: false })
  const [showSettings, setShowSettings] = useState(false)
  const [settingsSection, setSettingsSection] = useState<"general" | "appearance">("general")
  const [notices, setNotices] = useState<Notice[]>([])
  const [showHome, setShowHome] = useState(true)
  const [homeNotice, setHomeNotice] = useState<string | null>(null)
  const [showAgentsPage, setShowAgentsPage] = useState(false)
  const [agentsLoading, setAgentsLoading] = useState(true)
  const [agentsError, setAgentsError] = useState<string>()
  const [showConversationPicker, setShowConversationPicker] = useState(false)
  const [showNotes, setShowNotes] = useState(false)
  const [notesInitialId, setNotesInitialId] = useState<string | undefined>()
  // Barre d'actions sur sélection (v8.9.0) : position viewport de la mini-barre flottante.
  const [selBar, setSelBar] = useState<{ text: string; top: number; left: number } | null>(null)
  const selBarRef = useRef(selBar)
  selBarRef.current = selBar
  // "Projets", dans le hub d'accueil, ouvre les Réglages directement sur la liste des espaces
  // de travail plutôt que de rester sur le haut du panneau général.
  const [settingsFocus, setSettingsFocus] = useState<"workspaces" | undefined>(undefined)
  const liveRef = useRef<Live>(emptyLive)
  const rafScheduled = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [followBottom, setFollowBottom] = useState(true)
  const searchRef = useRef<HTMLInputElement>(null)
  const homeSearchRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const familyRef = useRef<Set<string>>(new Set())
  const tabRef = useRef("")
  const showArchivedRef = useRef(false)
  const chatsRef = useRef<Chat[]>([])
  const chatLoadSeq = useRef(0)
  const messageLoadSeq = useRef(0)
  const chatIdRef = useRef<string | null>(null)
  const preferredChatIdRef = useRef<string | null>(null)
  const { appearance, updateAppearance, resetAppearance } = useAppearance()
  chatIdRef.current = chatId

  // Dictée vocale (v8.8.0) : routage d'intention — une commande d'application s'exécute
  // directement, une tâche pour un autre agent y bascule, et le reste atterrit dans le
  // composeur (jamais chez l'agent directement) avec son badge de reformage ; l'utilisateur
  // valide toujours avec Entrée.
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e))
  const showHomeRef = useRef(true) // miroir de showHome pour les callbacks non recréés

  // Exécution d'une commande d'application dictée : mêmes handlers que les cartes du hub.
  // Retourne la phrase de confirmation, affichée là où l'utilisateur regarde.
  const routeAppAction = (action: AppAction): string => {
    switch (action) {
      case "open-notes":
        setShowAgentsPage(false); setShowSettings(false); setShowHome(false)
        setShowConversationPicker(false)
        setNotesInitialId(undefined); setShowNotes(true)
        return "Notes ouvertes."
      case "open-settings":
        openConfiguration()
        return "Paramètres ouverts."
      case "open-agents":
        openAgentsPage()
        return "Page des agents ouverte."
      case "open-projects":
        openConfiguration("workspaces")
        return "Espaces de travail ouverts."
      case "open-workspace":
        void api.openWorkspace().catch(fail)
        return "Dossier du projet ouvert."
    }
  }
  const [dictationMeta, setDictationMeta] = useState<{ cleaned: boolean; warning?: string; showRaw: boolean; rawText: string; cleanedText: string }>({ cleaned: false, showRaw: false, rawText: "", cleanedText: "" })
  const dictation = useDictation({
    onText: (result) => {
      if (!result.raw) return
      const cleaned = !!result.cleaned && result.cleaned !== result.raw
      const text = cleaned ? result.cleaned! : result.raw
      const intent = result.intent

      // Commande d'application : exécution immédiate — le texte ne va PAS au composeur.
      // La confirmation vit dans le journal des événements de routage (visible depuis la
      // conversation) ; l'écran ouvert est lui-même le retour principal.
      if (intent?.intent === "app") {
        const confirmation = routeAppAction(intent.action)
        setNotices((ns) => [...ns.slice(-19), { id: `${Date.now()}-intent`, text: confirmation }])
        // Le hub reste la surface active quand seule l'explorateur s'ouvre par-dessus.
        if (showHomeRef.current && intent.action === "open-workspace") setHomeNotice(confirmation)
        return
      }

      // Tâche pour un autre agent : on bascule d'abord — le composeur suit l'agent actif.
      // (target absent ou inconnu = pas de changement : dictée conservée sur l'agent courant.)
      // La sélection de conversation passe par loadChats / auto-création existants.
      if (intent?.intent === "agent" && intent.target && agents.some((a) => a.id === intent.target)) {
        const target: string = intent.target
        selectAgent(target)
        const confirmation = `Agent ${agents.find((a) => a.id === target)?.name ?? target} sélectionné.`
        setNotices((ns) => [...ns.slice(-19), { id: `${Date.now()}-intent`, text: confirmation }])
      }

      setInput(text)
      setDictationMeta({ cleaned, warning: result.warning, showRaw: false, rawText: result.raw, cleanedText: text })
      // La dictée peut partir du HUB : on y voit « Transcription… », mais le texte atterrit
      // dans le composeur qui n'est PAS visible depuis l'accueil. Sans cette navigation,
      // l'utilisateur ne voit rien après le relâchement.
      setShowHome(false)
      setShowConversationPicker(false)
      setShowAgentsPage(false)
      setHomeNotice(null)
      requestAnimationFrame(() => textareaRef.current?.focus())
    },
    onError: (message) => {
      // Une erreur survenue depuis le hub serait invisible (le composeur n'est pas à l'écran).
      if (showHomeRef.current) setHomeNotice(`Dictée : ${message}`)
      fail(new Error(message))
    },
    onTooShort: () => {
      if (showHomeRef.current) setHomeNotice("Appui trop court : maintiens le bouton le temps de parler.")
      else fail(new Error("Appui trop court : maintiens le bouton le temps de parler."))
    },
    onEmpty: () => {
      const msg = "Rien à transcrire : parle pendant que le bouton est maintenu."
      if (showHomeRef.current) setHomeNotice(msg)
      else fail(new Error(msg))
    },
  })
  const dictationRef = useRef(dictation)
  dictationRef.current = dictation

  // Sélection dans les messages (v8.9.0) : au relâchement de la souris, une mini-barre
  // propose Copier / Corriger / Expliquer / Citer. Le texte atterrit TOUJOURS dans le
  // composeur : l'utilisateur valide avec Entrée, rien ne part automatiquement.
  const onMessagesMouseUp = (e: MouseEvent<HTMLDivElement>) => {
    const root = e.currentTarget
    requestAnimationFrame(() => {
      const text = selectionWithin(root)
      if (!text) {
        setSelBar(null)
        return
      }
      const rect = window.getSelection()!.getRangeAt(0).getBoundingClientRect()
      setSelBar({
        text,
        top: Math.min(rect.bottom + 8, window.innerHeight - 56),
        left: Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - 330)),
      })
    })
  }

  // Applique l'action choisie : routage one-click (Corriger → code, Expliquer → recherche,
  // réutilise la bascule v8.8.0) puis préremplissage du composeur.
  const applySelection = (action: "fix" | "explain" | "send") => {
    if (!selBar) return
    setDictationMeta({ cleaned: false, showRaw: false, rawText: "", cleanedText: "" })
    setInput(buildPrompt(action, selBar.text))
    if (action === "fix" && tab !== "code" && agents.some((a) => a.id === "code")) selectAgent("code")
    if (action === "explain" && tab !== "recherche" && agents.some((a) => a.id === "recherche")) selectAgent("recherche")
    setSelBar(null)
    requestAnimationFrame(() => {
      const ta = textareaRef.current
      if (!ta) return
      ta.focus()
      ta.selectionStart = ta.selectionEnd = ta.value.length // curseur à la fin, prêt à compléter
    })
  }

  // Annonceur vocal (v8.7.9) : la préférence vit dans l'apparence ; toute frappe dans le
  // composeur signale l'activité au main, qui coupe la voix (l'utilisateur parle/pile, on se tait).
  const announceRef = useRef(appearance.voiceAnnouncements)
  announceRef.current = appearance.voiceAnnouncements
  useEffect(() => {
    api.announcerSetEnabled(appearance.voiceAnnouncements).catch(() => undefined)
  }, [appearance.voiceAnnouncements])
  const signalActivity = useCallback(() => {
    if (announceRef.current) api.announcerActivity().catch(() => undefined)
  }, [])
  const setLiveBoth = (next: Live) => {
    liveRef.current = next
    setLive(next)
  }

  useEffect(() => {
    // v9.0.0 : l'override Freebuff tri-état se réinitialise quand la clé disparaît.
    if (!appState.keys.codebuff) setFreebuffOverride(null)
  }, [appState.keys.codebuff])

  const closeNotesToHome = useCallback(() => {
    setShowNotes(false)
    setNotesInitialId(undefined)
    setShowSettings(false)
    setShowAgentsPage(false)
    setShowConversationPicker(false)
    setShowHome(true)
  }, [])

  const loadChats = useCallback(async (agent: string) => {
    const seq = ++chatLoadSeq.current
    setLoadedFor("")
    const c = await api.chats(agent, showArchived)
    if (seq !== chatLoadSeq.current || tabRef.current !== agent) return
    setChats(c)
    const preferred = preferredChatIdRef.current
    setChatId((cur) => {
      const next = preferred && c.some((x) => x.id === preferred)
        ? preferred
        : cur && c.some((x) => x.id === cur)
          ? cur
          : c[0]?.id ?? null
      if (preferred && next === preferred) preferredChatIdRef.current = null
      return next
    })
    if (!showArchived) setLoadedFor(agent)
  }, [showArchived])

  // Les titres/modèles générés ou modifiés côté serveur sont relus en fin de tour
  // sans perturber l'ordre ni la sélection courante.
  const refreshChatMeta = useCallback(async () => {
    if (!tabRef.current) return
    try {
      const fresh = await api.chats(tabRef.current, showArchivedRef.current)
      const byId = new Map(fresh.map((chat) => [chat.id, chat]))
      setChats((cs) => cs.map((c) => {
        const f = byId.get(c.id)
        return f ? { ...c, title: f.title, model: f.model, updated: f.updated } : c
      }))
    } catch {
      // Le rafraîchissement des métadonnées ne doit jamais bloquer la conversation.
    }
  }, [])

  // Pendant un tour, plusieurs deltas arrivent par seconde. On met à jour liveRef
  // immédiatement, mais on limite les rendus React à une fois par image.
  const scheduleFlush = useCallback(() => {
    if (rafScheduled.current) return
    rafScheduled.current = true
    requestAnimationFrame(() => {
      rafScheduled.current = false
      setLive(liveRef.current)
    })
  }, [])

  useEffect(() => {
    let stop = false
    const run = async () => {
      while (!stop) {
        const s = await api.state()
        setAppState(s)
        if (s.status === "ready") {
          setAgentsLoading(true)
          setAgentsError(undefined)
          try {
            const a = await api.agents()
            if (stop) return
            setAgents(a)
            setTab((cur) => cur || a[0]?.id || "")
          } catch (e) {
            if (stop) return
            setAgentsError(e instanceof Error ? e.message : String(e))
            setAgents([])
          } finally {
            if (!stop) setAgentsLoading(false)
          }
          return
        }
        if (s.status === "error") {
          setAgentsLoading(false)
          setAgentsError(s.error || "Le moteur Aven n’est pas disponible.")
          return
        }
        await new Promise((r) => setTimeout(r, 500))
      }
    }
    run().catch(fail)
    return () => {
      stop = true
    }
  }, [])

  useEffect(() => {
    if (!tab) return
    loadChats(tab).catch(fail)
  }, [tab, loadChats])

  useEffect(() => {
    if (appState.status !== "ready" || !tab || showArchived || loadedFor !== tab || chats.length > 0) return
    if (creatingRef.current.has(tab) || autoFailed.current.has(tab)) return
    creatingRef.current.add(tab)
    api
      .createChat(tab)
      .then((c) => {
        autoFailed.current.delete(tab)
        setChats([c])
        setChatId(c.id)
      })
      .catch((e) => {
        autoFailed.current.add(tab)
        fail(e)
      })
      .finally(() => {
        creatingRef.current.delete(tab)
      })
  }, [appState.status, tab, showArchived, loadedFor, chats.length])

  const reload = useCallback(async (id: string) => {
    const seq = ++messageLoadSeq.current
    const loaded = await api.messages(id)
    if (seq !== messageLoadSeq.current || chatIdRef.current !== id) return
    setMessages(loaded)
  }, [])

  useEffect(() => {
    setLiveBoth(emptyLive)
    setMessages([])
    setError(undefined)
    setFollowBottom(true)
    if (!chatId) return
    familyRef.current = new Set([chatId])
    reload(chatId).catch(fail)

    const off = api.onEvent((ev) => {
      const d = ev.data
      const sid = d.sessionID !== undefined ? String(d.sessionID) : undefined
      if (ev.type === "router.notice") {
        if (sid === chatId) {
          setNotices((ns) => [...ns.slice(-19), { id: `${Date.now()}-${Math.random()}`, text: String(d.text) }])
          if (d.model) setChats((cs) => cs.map((c) => (c.id === chatId ? { ...c, model: String(d.model) } : c)))
        }
        return
      }
      if (ev.type === "session.created" && d.parentID && familyRef.current.has(String(d.parentID)) && sid) {
        familyRef.current.add(sid)
      }
      if (!sid || !familyRef.current.has(sid)) return

      const wrapped: StreamEvent = { type: ev.type, child: sid !== chatId, data: d }
      const { live: next, finished } = applyEvent(liveRef.current, wrapped)
      liveRef.current = next
      if (finished) {
        setLive(next) // fin de tour : afficher l'état final sans attendre le prochain frame
        reload(chatId)
          .then(() => setLiveBoth({ ...emptyLive, error: next.error }))
          .catch(fail)
        void refreshChatMeta()
      } else {
        scheduleFlush()
      }
    })
    return off
  }, [chatId, reload, refreshChatMeta, scheduleFlush])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === "n") {
        e.preventDefault()
        void newChat()
      } else if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault()
        ;(showHome ? homeSearchRef.current : searchRef.current)?.focus()
      } else if (e.key === "F2" && chatId) {
        e.preventDefault()
        startRenameChat(chatId)
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "v") {
        // Push-to-talk clavier : Ctrl+Maj+V maintenue = enregistrer, relâchée = transcrire.
        // (keydown se répète tant que la touche est tenue : on n'agit qu'à la première.)
        e.preventDefault()
        if (!e.repeat && dictationRef.current.state === "idle") void dictationRef.current.start()
      } else if (e.key === "Escape") {
        if (dictationRef.current.state === "recording") {
          dictationRef.current.cancel()
          return
        }
        if (showConversationPicker) setShowConversationPicker(false)
        else if (showAgentsPage) { setShowAgentsPage(false); setShowHome(true) }
        else if (showNotes) closeNotesToHome()
        else if (showSettings) setShowSettings(false)
        else if (live.forms[0]) void api.cancelForm(live.forms[0].sessionID, live.forms[0].id).catch(fail)
        else if (live.busy && chatId) void api.interrupt(chatId).catch(fail)
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.shiftKey && e.key.toLowerCase() === "v") {
        e.preventDefault()
        if (dictationRef.current.state === "recording") dictationRef.current.stop()
        else if (dictationRef.current.state === "error") dictationRef.current.resetError()
      }
    }
    window.addEventListener("keydown", onKey)
    window.addEventListener("keyup", onKeyUp)
    return () => {
      window.removeEventListener("keydown", onKey)
      window.removeEventListener("keyup", onKeyUp)
    }
  }, [live.busy, live.forms, chatId, showSettings, showAgentsPage, showConversationPicker, showHome, showNotes, tab, closeNotesToHome])

  const newChat = async () => {
    if (!tab) return
    try {
      const c = await api.createChat(tab)
      setChats((prev) => [c, ...prev])
      setChatId(c.id)
      setShowConversationPicker(false)
      setShowAgentsPage(false)
      setShowHome(false)
      requestAnimationFrame(() => textareaRef.current?.focus())
    } catch (e) {
      fail(e)
    }
  }

  const removeChat = async (id: string) => {
    try {
      await api.deleteChat(id)
      setChats((cs) => {
        const rest = cs.filter((c) => c.id !== id)
        if (chatId === id) setChatId(rest[0]?.id ?? null)
        return rest
      })
    } catch (e) {
      fail(e)
    }
  }

  const toggleArchive = async (id: string, archived: boolean) => {
    try {
      await api.archiveChat(id, archived)
      setChats((cs) => (showArchived === archived ? cs.map((c) => (c.id === id ? { ...c, archived } : c)) : cs.filter((c) => c.id !== id)))
      if (chatId === id && showArchived !== archived) setChatId(null)
    } catch (e) {
      fail(e)
    }
  }

  const exportChat = async (id: string) => {
    try {
      await api.exportChat(id)
    } catch (e) {
      fail(e)
    }
  }

  const send = async () => {
    const text = input.trim()
    if (!text) return
    setInput("")
    await sendText(text)
  }
  const sendText = async (text: string) => {
    if (!chatId || live.busy) return
    const explicitFreebuff = /^\/freebuff\s+/i.test(text.trim())
    const prompt = explicitFreebuff ? text.trim().replace(/^\/freebuff\s+/i, "").trim() : text.trim()
    if (!prompt) return
    const backend: "opencode" | "freebuff" = explicitFreebuff
      ? "freebuff"
      : effectiveBackend({ hasCodebuffKey: !!appState.keys.codebuff, pref: appearance.freebuffAsEngine, manual: freebuffOverride })
    setError(undefined)
    setFollowBottom(true)
    setMessages((m) => [...m, { id: `local-${Date.now()}`, role: "user", text: prompt }])
    setLiveBoth({ ...emptyLive, busy: true })
    try {
      const result = await api.send(chatId, prompt, backend)
      if (result.backend === "freebuff") {
        setChats((cs) => cs.map((c) => c.id === chatId ? { ...c, model: result.model ?? "Freebuff / Codebuff SDK", updated: Date.now() } : c))
        setNotices((ns) => [...ns.slice(-19), { id: `${Date.now()}-freebuff`, text: "Freebuff a terminé ce tour." }])
        await reload(chatId)
        setLiveBoth(emptyLive)
      }
    } catch (e) {
      setLiveBoth(emptyLive)
      if (!(e instanceof Error && /interrompu/i.test(e.message))) fail(e)
    }
  }

  // Suivi automatique du bas de la conversation, avec une tolérance de ~80px.
  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    setFollowBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80)
  }

  useEffect(() => {
    if (!followBottom) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, live, followBottom])

  const editLastUserMessage = useCallback(() => {
    const lastUser = [...messages].reverse().find((m) => m.role === "user")
    if (!lastUser || live.busy) return
    setInput(lastUser.text)
    textareaRef.current?.focus()
  }, [messages, live.busy])

  const answer = async (decision: Decision) => {
    const ask = live.asks[0]
    if (!ask) return
    try {
      await api.reply(ask.sessionID, ask.id, decision)
    } catch (e) {
      fail(e)
    }
  }

  const labelOf = useCallback(
    (ref?: string) => {
      if (!ref) return "Aucun modèle assigné"
      const known = Object.values(appState.assignments ?? {}).flat().find((m) => m.ref === ref)
      if (known) return known.label
      // Session héritée d'une version antérieure : le modèle n'est (plus) dans le catalogue.
      // On l'affiche tel quel (traçabilité) plutôt que de masquer une information.
      return ref
    },
    [appState.assignments],
  )
  const currentModel = chats.find((c) => c.id === chatId)?.model

  const form = live.forms[0]
  const answerForm = async (a: FormAnswer) => {
    if (!form) return
    try {
      await api.replyForm(form.sessionID, form.id, a)
    } catch (e) {
      fail(e)
    }
  }
  const cancelForm = async () => {
    if (!form) return
    try {
      await api.cancelForm(form.sessionID, form.id)
    } catch (e) {
      fail(e)
    }
  }

  const startRenameChat = (id: string) => {
    const c = chatsRef.current.find((x) => x.id === id)
    if (!c) return
    renameCancelled.current = false
    setChatValue(c.title)
    setRenamingChat(id)
  }
  const commitChatRename = async (id: string) => {
    if (renameBusy.current) return
    renameBusy.current = true
    try {
      const title = chatValue.trim()
      const current = chatsRef.current.find((x) => x.id === id)?.title
      setRenamingChat(null)
      if (renameCancelled.current || !title || title === current) return
      const res = await api.renameChat(id, title)
      setChats((cs) => cs.map((c) => (c.id === id ? { ...c, title: res.title } : c)))
    } catch (e) {
      fail(e)
    } finally {
      renameBusy.current = false
    }
  }

  const commitAgentRename = async (id: string) => {
    if (renameBusy.current) return
    renameBusy.current = true
    try {
      setRenamingAgent(null)
      if (renameCancelled.current) return
      setAgents(await api.renameAgent(id, agentValue))
    } catch (e) {
      fail(e)
    } finally {
      renameBusy.current = false
    }
  }
  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id

  // Carte « Statistiques » du hub (v8.11.0) : chiffres clés de l'usage (conversations,
  // dictées, modèles). Les données sont rechargées à chaque ouverture.
  const [stats, setStats] = useState<AggregatedStats | null>(null)
  const [showStats, setShowStats] = useState(false)
  const openStats = () => {
    setShowStats(true)
    api.getStats().then(setStats).catch((e) => { setShowStats(false); fail(e) })
  }

  const orderedAgents = useMemo(() => orderAgents(agents, appearance.agentOrder), [agents, appearance.agentOrder])
  const workspaceName = appState.workspace ? appState.workspace.split(/[\\/]/).pop() : undefined
  const visibleChats = useMemo(() => chats.filter((c) => !search.trim() || c.title.toLowerCase().includes(search.trim().toLowerCase())), [chats, search])

  // v9.0.0 : quand le regroupement par agent est activé, la sidebar affiche TOUTES les
  // conversations de tous les agents (filtrées par la recherche), groupées par agent.
  // Cliquer une conversation d'un autre agent bascule sur cet agent puis ouvre.
  const openConversationFromSidebar = (chat: Chat) => {
    if (chat.agent && chat.agent !== tab && agents.some((a) => a.id === chat.agent)) {
      selectAgent(chat.agent)
      preferredChatIdRef.current = chat.id
      setChatId(chat.id)
      return
    }
    setChatId(chat.id)
  }
  const chatGroups = useMemo(() => {
    if (!appearance.chatsGroupedByAgent) return null
    const filtered = chats.filter((c) => !search.trim() || c.title.toLowerCase().includes(search.trim().toLowerCase()))
    return groupChatsByAgent(filtered, orderedAgents.map((a) => a.id))
  }, [appearance.chatsGroupedByAgent, chats, search, orderedAgents])
  const lastUserIdx = [...messages].map((m) => m.role).lastIndexOf("user")

  // L'ordre des blocs est persisté par le panneau Apparence.
  const mainBlocks = appearance.mainOrder

  const HubIcon = ({ kind }: { kind: string }) => {
    const icons: Record<string, IconName> = {
      project: "sparkle", // v9.1.0 : l'orchestrateur porte la marque Aven (à part des agents)
      freebuff: "terminal", // v9.1.2 : le CLI gratuit vit dans un terminal
      agent: "agent",
      files: "folder",
      notes: "file",
      settings: "settings",
      stats: "chart",
    }
    return <Icon name={icons[kind] ?? "sparkle"} />
  }

  // Basculer d’agent sans laisser une requête réseau tardive remplacer la conversation
  // du nouvel agent. La sélection reste cohérente entre le hub, les onglets et l’assistant vocal.
  const selectAgent = (id: string) => {
    if (!agents.some((a) => a.id === id)) return
    tabRef.current = id
    preferredChatIdRef.current = null
    setTab(id)
    setChatId(null)
    setShowAgentsPage(false)
    setShowConversationPicker(false)
    setShowSettings(false)
    setShowNotes(false)
    setShowHome(false)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const openAgentsPage = () => {
    setShowHome(false)
    setShowSettings(false)
    setShowNotes(false)
    setShowConversationPicker(false)
    setShowAgentsPage(true)
  }

  // v9.1.0 : retour accueil depuis la barre de fenêtre — ferme les panneaux ouverts.
  const goHome = () => {
    setShowAgentsPage(false)
    setShowSettings(false)
    setShowNotes(false)
    setShowConversationPicker(false)
    setShowHome(true)
  }

  const openConfiguration = (focus?: "workspaces") => {
    setShowAgentsPage(false)
    setShowNotes(false)
    setSettingsSection("general")
    setSettingsFocus(focus)
    setShowSettings(true)
  }


  const renderHome = () => {
    const nav = [
      // v9.1.0 : « projet » est à part — carte dédiée d'orchestrateur, hors sélecteur d'agents.
      { key: "project", label: "Projet", kind: "project", hint: "Orchestrateur des agents", action: () => selectAgent("projet") },
      // v9.1.2 : le CLI Freebuff gratuit (ad-financé) s'ouvre dans un terminal sur l'espace.
      { key: "freebuff", label: "Freebuff", kind: "freebuff", hint: "CLI gratuit (terminal)", action: () => { api.freebuffCliLaunch("launch").catch((e) => { setHomeNotice(e instanceof Error ? e.message : String(e)) }) } },
      { key: "agents", label: "Agents", kind: "agent", hint: orderedAgents.length === 1 ? "Agent actif" : `${orderedAgents.length} agents`, action: openAgentsPage },
      { key: "stats", label: "Statistiques", kind: "stats", hint: "Usage de l'app", action: openStats },
      { key: "files", label: "Fichiers", kind: "files", hint: "Parcourir l’espace", action: () => api.openWorkspace().catch(fail) },
      { key: "notes", label: "Notes", kind: "notes", hint: "Vos notes Markdown", action: () => { setShowAgentsPage(false); setShowSettings(false); setShowHome(false); setNotesInitialId(undefined); setShowNotes(true) } },
      { key: "settings", label: "Paramètres", kind: "settings", hint: "Configuration & apparence", action: () => openConfiguration() },
    ]
    const recent = chats.slice(0, 3)
    const allConversations = chats
    const online = appState.status === "ready"
    const command = homeCommand.trim()

    const submitHomeCommand = async (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      if (!command) return
      try {
        if (!chatId && tab) {
          const c = await api.createChat(tab)
          setChats((prev) => [c, ...prev])
          setChatId(c.id)
        }
        setShowHome(false)
        setShowAgentsPage(false)
        setShowConversationPicker(false)
        setInput(command)
        setHomeCommand("")
        requestAnimationFrame(() => textareaRef.current?.focus())
      } catch (e) {
        fail(e)
      }
    }

    const openConversation = (chat: Chat) => {
      if (chat.agent && chat.agent !== tab) {
        tabRef.current = chat.agent
        preferredChatIdRef.current = chat.id
        setTab(chat.agent)
      } else {
        preferredChatIdRef.current = null
      }
      setChatId(chat.id)
      setHomeCommand("")
      setShowConversationPicker(false)
      setShowAgentsPage(false)
      setShowHome(false)
      requestAnimationFrame(() => textareaRef.current?.focus())
    }

    return (
      <section className="home-shell" aria-label="Accueil Aven">
        <header className="home-toolbar">
          <button className="home-brand home-brand-button" onClick={() => { setHomeCommand(""); setShowAgentsPage(false); setShowHome(true) }} aria-label="Retour à l’accueil">
            <div className="brand-mark" aria-hidden="true"><Icon name="sparkle" size={18} /></div>
            <span className="home-brand-copy">
              <strong>Aven</strong>
              <small>{workspaceName || "Espace de travail"}</small>
            </span>
          </button>

          <form className="home-command" onSubmit={submitHomeCommand}>
            <span className="home-command-icon" aria-hidden="true"><Icon name="search" size={17} /></span>
            <input ref={homeSearchRef} value={homeCommand} onChange={(e) => setHomeCommand(e.target.value)} placeholder="Demander, chercher, créer…" aria-label="Rechercher ou commander" />
            <kbd>Ctrl K</kbd>
          </form>

          <div className="home-toolbar-actions">
            <span className={`home-status ${online ? "online" : ""}`} title={online ? "Aven est prêt" : appState.status === "starting" ? "Aven démarre" : "Aven est indisponible"}>
              <span className="status-dot" />
              <span>{online ? "En ligne" : appState.status === "starting" ? "Démarrage" : "Indisponible"}</span>
            </span>
            <button className="button button-icon home-icon-button home-control" onClick={() => openConfiguration()} aria-label="Ouvrir les paramètres" title="Paramètres" type="button">
              <HubIcon kind="settings" />
            </button>
          </div>
        </header>

        <div className="home-content">
          <div className="home-workspace">
            <aside className="home-recent" aria-label="Conversations récentes">
              <div className="home-section-heading">
                <div>
                  <span className="eyebrow">RÉCENTS</span>
                  <strong>Reprendre rapidement</strong>
                </div>
                <button className="button ghost home-text-button" onClick={() => setShowConversationPicker(true)} type="button">Tout voir</button>
              </div>
              <div className="home-recent-list">
                {recent.map((chat) => (
                  <button key={chat.id} className="home-recent-item" onClick={() => openConversation(chat)} type="button">
                    <span className="home-recent-icon"><HubIcon kind={chat.agent === tab ? "agent" : "notes"} /></span>
                    <span className="home-recent-copy">
                      <strong>{chat.title || "Conversation"}</strong>
                      <small>{chat.model || agentName(chat.agent || tab)}</small>
                    </span>
                    <span className="home-recent-arrow"><Icon name="chevron-right" size={16} /></span>
                  </button>
                ))}
                {!recent.length && (
                  <button className="home-empty-recent" onClick={() => void newChat()} disabled={!tab} type="button">
                    <span>Commencez une conversation pour la retrouver ici.</span>
                  </button>
                )}
              </div>
              <button className="button primary home-recent-new" onClick={() => void newChat()} disabled={!tab} type="button">
                <Icon name="plus" size={14} />Nouvelle conversation
              </button>
            </aside>

            <div className="home-hub-stage">
              <section className="home-hub" aria-label="Navigation principale">
                <div className="hub-grid-glow" aria-hidden="true" />
                <div className="hub-aura hub-aura-1" aria-hidden="true" />
                <div className="hub-aura hub-aura-2" aria-hidden="true" />
                <div className="hub-orbit hub-orbit-outer" aria-hidden="true" />
                <div className="hub-orbit hub-orbit-inner" aria-hidden="true" />
                <div className="hub-orbit hub-orbit-core" aria-hidden="true" />
                <div className="hub-crosshair" aria-hidden="true"><span /><span /></div>

                {nav.map((item) => (
                  <button key={item.key} className={`hub-card hub-card-${item.key}`} onClick={item.action} aria-label={`${item.label} — ${item.hint}`} type="button">
                    <span className="hub-card-icon"><HubIcon kind={item.kind} /></span>
                    <span className="hub-card-copy"><strong>{item.label}</strong><small>{item.hint}</small></span>
                  </button>
                ))}

                {/* Bouton central : dictée push-to-talk (retour du point focal du hub).
                    Maintenir pour parler, relâcher pour transcrire → le texte atterrit dans
                    le composeur de la conversation (créée si besoin) pour validation. */}
                <button
                  className={`voice-core ${dictation.state === "recording" ? "dictation-recording" : ""}`}
                  onPointerDown={(e) => {
                    e.preventDefault()
                    if (!appState.keys.groq) { setHomeNotice("Configure une clé Groq dans Paramètres pour dicter."); return }
                    if (dictation.state === "error") { dictation.resetError(); return }
                    if (dictation.state === "idle") {
                      void (async () => {
                        if (!chatId && tab) {
                          try { const c = await api.createChat(tab); setChats((prev) => [c, ...prev]); setChatId(c.id) } catch (err) { fail(err); return }
                        }
                        void dictation.start()
                      })()
                    }
                  }}
                  onPointerUp={(e) => { e.preventDefault(); if (dictation.state === "recording") dictation.stop() }}
                  onPointerLeave={() => { if (dictation.state === "recording") dictation.stop() }}
                  aria-label={appState.keys.groq ? "Dicter — maintiens le bouton, relâche pour transcrire" : "Dictée indisponible : configure une clé Groq dans Paramètres"}
                  type="button"
                >
                  <span className="voice-ring voice-ring-outer" aria-hidden="true" />
                  <span className="voice-ring voice-ring-inner" aria-hidden="true" />
                  <span className="voice-mic"><Icon name="microphone" size={30} /></span>
                  <span className="voice-core-label">
                    {dictation.state === "recording" ? "J’écoute…" : dictation.state === "transcribing" ? "Transcription…" : "Dicter"}
                  </span>
                </button>

                {homeNotice && <div className="home-notice" role="status">{homeNotice}</div>}


                {showStats && (
                  <div className="hub-picker-overlay" role="dialog" aria-modal="true" aria-label="Statistiques" onClick={(e) => { if (e.target === e.currentTarget) setShowStats(false) }}>
                    <div className="hub-picker">
                      <div className="hub-picker-header">
                        <div><span className="eyebrow">STATISTIQUES</span><strong className="hub-picker-title">Usage de l'application</strong></div>
                        <button className="button button-icon dialog-close" onClick={() => setShowStats(false)} aria-label="Fermer" type="button"><Icon name="close" size={17} /></button>
                      </div>
                      <div className="hub-picker-list stats-grid">
                        <div className="stat-tile"><strong>{stats ? stats.totalChats : "…"}</strong><small>conversations actives</small></div>
                        <div className="stat-tile"><strong>{stats ? stats.archivedChats : "…"}</strong><small>archivées</small></div>
                        <div className="stat-tile"><strong>{stats ? stats.dictationsTotal : "…"}</strong><small>dictées ({stats ? stats.dictationsToday : "…"} aujourd'hui)</small></div>
                        {stats?.perAgent.map((e) => (
                          <div key={e.agent} className="stat-tile"><strong>{e.count}</strong><small>conversations · {agentName(e.agent)}</small></div>
                        ))}
                        {stats?.topModels.length ? (
                          <div className="stat-tile stat-wide"><strong>{stats.topModels.map((m) => `${m.model} (${m.count})`).join(" · ")}</strong><small>modèles les plus utilisés</small></div>
                        ) : null}
                      </div>
                    </div>
                  </div>
                )}

              </section>
            </div>
          </div>
        </div>

        {showConversationPicker && (
          <div className="home-modal-overlay" role="dialog" aria-modal="true" aria-label="Toutes les conversations" onClick={(e) => { if (e.target === e.currentTarget) setShowConversationPicker(false) }}>
            <div className="home-modal">
              <div className="home-modal-header">
                <div><span className="eyebrow">CONVERSATIONS</span><h2>Toutes les conversations</h2></div>
                <button className="button button-icon dialog-close" onClick={() => setShowConversationPicker(false)} aria-label="Fermer" type="button"><Icon name="close" size={17} /></button>
              </div>
              <div className="home-modal-list">
                {allConversations.map((chat) => (
                  <button key={chat.id} className="home-modal-item" onClick={() => openConversation(chat)} type="button">
                    <span className="home-recent-icon"><HubIcon kind="notes" /></span>
                    <span className="home-recent-copy"><strong>{chat.title || "Conversation"}</strong><small>{chat.model || agentName(chat.agent || tab)}{chat.updated ? ` · ${new Date(chat.updated).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}` : ""}</small></span>
                    <span className="home-recent-arrow"><Icon name="chevron-right" size={18} /></span>
                  </button>
                ))}
                {!allConversations.length && <div className="home-modal-empty">Aucune conversation active pour cet agent.</div>}
              </div>
            </div>
          </div>
        )}
      </section>
    )
  }

  const renderMessages = () => (
    <div className="messages block-card" key="messages" onMouseUp={onMessagesMouseUp}>
      {!chatId && (
        <div className="empty-state">
          <div className="empty-symbol"><Icon name="sparkle" size={24} /></div>
          <h2>Prêt à commencer</h2>
          <p>Sélectionne une conversation ou crée-en une nouvelle.</p>
        </div>
      )}
      {messages.map((m, i) => (
        <MessageBubble
          key={m.id}
          m={m}
          isLastUser={m.role === "user" && i === lastUserIdx}
          busy={live.busy}
          onEdit={editLastUserMessage}
          labelOf={labelOf}
          showToolActivity={appearance.showToolActivity}
        />
      ))}
      {live.order.map((id) =>
        live.texts[id].child ? (
          <details key={id} className="msg child live-child" open>
            <summary>sous-agent — en cours</summary>
            <div className="message-text"><Markdown text={live.texts[id].text} /></div>
          </details>
        ) : (
          <div key={id} className="msg assistant live-message">
            <div className="message-text"><Markdown text={live.texts[id].text} /></div>
          </div>
        ),
      )}
      {appearance.showToolActivity && Object.entries(live.tools).length > 0 && (
        <div className="tool-activity">
          {Object.entries(live.tools).map(([id, t]) => (
            <span key={id} className={`chip ${t.status}`}>
              {t.child ? "Sous-agent · " : ""}{t.name}{t.status === "running" ? "…" : ""}
            </span>
          ))}
        </div>
      )}
      {live.busy && <div className="working"><span className="pulse" /> L’agent travaille…</div>}
      {live.error && <p className="err error-card">{live.error}</p>}
      {error && <p className="err error-card">{error}</p>}
    </div>
  )

  const renderNotices = () => (
    notices.length > 0 ? (
      <details className="notices block-card" key="notices">
        <summary>Événements de routage <span>{notices.length}</span></summary>
        <div className="notice-list">
          {notices.map((n) => <p key={n.id}>{n.text}</p>)}
        </div>
      </details>
    ) : null
  )

  const renderModel = () => (
    <div className="modelbar block-card" key="model">
      <div>
        <span className="eyebrow">MODÈLE ACTIF</span>
        <strong>{labelOf(currentModel)}</strong>
      </div>
      <span className="model-assignment">{currentModel === "Freebuff / Codebuff SDK" ? "Backend Freebuff · SDK Codebuff" : currentModel ? `Priorité agent · ${agentName(tab)}` : "Résolution du modèle…"}</span>
    </div>
  )

  const renderComposer = () => (
    <div className="composer-wrap block-card" key="composer">
      <div className="composer">
        <textarea
          ref={textareaRef}
          value={dictationMeta.showRaw && dictationMeta.cleaned ? dictationMeta.rawText : input}
          placeholder={dictation.state === "recording" ? "J’écoute…" : "Écris à l’agent… (ou maintiens le micro)"}
          disabled={!chatId}
          onChange={(e) => {
            // Toute édition manuelle repart du texte affiché et désactive la bascule brut/éclairci.
            setInput(dictationMeta.showRaw && dictationMeta.cleaned ? dictationMeta.rawText : e.target.value)
            if (dictationMeta.cleaned || dictationMeta.rawText) setDictationMeta((m) => ({ ...m, showRaw: false, rawText: "", cleanedText: "" }))
            signalActivity() // mute l'annonceur : on ne parle pas par-dessus la frappe
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (!e.shiftKey || e.ctrlKey || e.metaKey)) {
              e.preventDefault()
              void send()
            }
          }}
        />
        <div className="composer-footer">
          <div className="composer-footer-left">
            {appState.keys.groq && (
              <button
                className={`button button-icon dictation-button ${dictation.state === "recording" ? "dictation-recording" : "secondary"}`}
                type="button"
                disabled={dictation.state === "transcribing"}
                onPointerDown={(e) => { e.preventDefault(); if (dictation.state === "error") dictation.resetError(); else if (dictation.state === "idle") void dictation.start() }}
                onPointerUp={(e) => { e.preventDefault(); if (dictation.state === "recording") dictation.stop() }}
                onPointerLeave={() => { if (dictation.state === "recording") dictation.stop() }}
                aria-label={dictation.state === "recording" ? "Relâcher pour transcrire" : "Dicter (maintenir, ou Ctrl+Maj+V)"}
                title="Dicter (maintenir le clic, ou Ctrl+Maj+V). Le texte arrive dans le composeur : relis-le avant d’envoyer."
              >
                <Icon name="microphone" size={16} />
              </button>
            )}
            {appState.keys.codebuff && (() => {
              const activeFreebuff = effectiveBackend({ hasCodebuffKey: true, pref: appearance.freebuffAsEngine, manual: freebuffOverride }) === "freebuff"
              return (
                <button
                  className={`button ${activeFreebuff ? "primary" : "secondary"}`}
                  type="button"
                  onClick={() => setFreebuffOverride((value) => nextManualChoice(value))}
                  title="Freebuff (SDK Codebuff) : peut consommer des crédits. Clic : forcer → désactiver → automatique. Par défaut, Freebuff est le moteur de tous les agents."
                >
                  {activeFreebuff ? "Freebuff actif" : "Freebuff"}
                </button>
              )
            })()}
            <span className="composer-hint">
              {dictation.state === "recording" ? "J’écoute… relâche pour transcrire (Échap pour annuler)."
                : dictation.state === "transcribing" ? "Transcription…"
                : dictationMeta.cleaned && !dictationMeta.showRaw && input ? "Texte dicté éclairci — clique pour voir le brut."
                : dictationMeta.warning ? `Dictée non reformée : ${dictationMeta.warning}`
                : effectiveBackend({ hasCodebuffKey: !!appState.keys.codebuff, pref: appearance.freebuffAsEngine, manual: freebuffOverride }) === "freebuff" ? "Backend Freebuff / Codebuff SDK." : "Envoyez votre message à l’agent."}
            </span>
            {dictationMeta.cleaned && input && (
              <button
                className={`button ghost dictation-toggle ${dictationMeta.showRaw ? "showing-raw" : ""}`}
                type="button"
                onClick={() => setDictationMeta((m) => ({ ...m, showRaw: !m.showRaw }))}
                title={dictationMeta.showRaw ? "Revenir au texte éclairci" : "Voir la transcription brute"}
              >
                {dictationMeta.showRaw ? "brut affiché" : "✓ éclairci"}
              </button>
            )}
          </div>
          {live.busy ? (
            <button className="button danger" onClick={() => chatId && api.interrupt(chatId).catch(fail)}>Arrêter <kbd>Échap</kbd></button>
          ) : (
            <button className="button primary" onClick={send} disabled={!chatId || !input.trim()}>Envoyer</button>
          )}
        </div>
      </div>
    </div>
  )

  const blocks = new Map<string, () => ReactNode>([
    ["messages", renderMessages],
    ["notices", renderNotices],
    ["model", renderModel],
    ["composer", renderComposer],
  ])

  tabRef.current = tab
  showArchivedRef.current = showArchived
  showHomeRef.current = showHome
  chatsRef.current = chats

  const ask = live.asks[0]
  const showNoKeyBanner = appState.status === "ready" && !Object.values(appState.keys).some(Boolean)
  const appClass = [
    "app",
    appearance.sidebarPosition === "right" ? "sidebar-right" : "sidebar-left",
    appearance.showSidebar ? "sidebar-visible" : "sidebar-hidden",
    appearance.density === "compact" ? "density-compact" : "density-comfortable",
  ].join(" ")

  return (
    <div className={appClass}>
      <div className={`window-chrome ${showHome ? "window-chrome-home" : ""}`}>
        <div className="window-bar-left">
          <div className="window-status" aria-label={appState.status === "ready" ? "En ligne" : "État de l’application"}>
            <span className={`status-dot ${appState.status}`} />
            <span>{appState.status === "ready" ? "En ligne" : appState.status === "starting" ? "Démarrage" : "Erreur"}</span>
          </div>
          <button
            className="window-tab"
            onClick={() => { setSettingsSection("appearance"); setShowSettings(true) }}
            aria-label="Ouvrir les paramètres d’apparence"
          >
            <span className="window-tab-icon"><Icon name="settings" size={14} /></span>
            <span>Paramètres</span>
          </button>
          {!showHome && (
            <button className="window-tab" onClick={goHome} aria-label="Retour à l’accueil">
              <span className="window-tab-icon"><Icon name="arrow-left" size={14} /></span>
              <span>Accueil</span>
            </button>
          )}
        </div>
        {/* Contrôles locaux dessinés en SVG dans l’esprit des icônes Fluent UI de Microsoft (Windows 11). */}
        <div className="window-controls">
          <button className="window-control" onClick={() => window.opencode.minimizeWindow()} aria-label="Réduire"><Icon name="minimize" size={16} /></button>
          <button className="window-control" onClick={() => window.opencode.toggleMaximize()} aria-label="Agrandir"><Icon name="maximize" size={16} /></button>
          <button className="window-control close" onClick={() => window.opencode.closeWindow()} aria-label="Fermer"><Icon name="close" size={16} /></button>
        </div>
      </div>

      {!showHome && appState.status !== "ready" && (
        <div className="status-banner">
          <span className="status-dot warning" />
          {appState.status === "starting" ? "Démarrage d’Aven…" : <><b>Aven n’a pas démarré.</b> {appState.error}</>}
        </div>
      )}
      {showNoKeyBanner && !showHome && (
        <div className="status-banner subtle"><span className="status-dot" /> Aucun fournisseur avec clé API n’est configuré. Les modèles sans clé restent disponibles.</div>
      )}

      {showHome ? (
        <main className="home-main">{renderHome()}</main>
      ) : showAgentsPage ? (
        <main className="agents-main">
          <section className="agents-page" aria-label="Gestion des agents">
            <header className="agents-page-header">
              <div>
                <span className="eyebrow">AGENTS</span>
                <h1>Vos agents</h1>
                <p>Choisissez un agent, consultez son rôle ou ouvrez directement une conversation.</p>
              </div>
              <button className="button ghost" onClick={() => { setShowAgentsPage(false); setShowHome(true) }} type="button">
                <Icon name="arrow-left" size={15} />Accueil
              </button>
            </header>
            <div className="agents-grid">
              {agentsLoading ? (
                <div className="agents-empty">
                  <div className="empty-symbol"><Icon name="agent" size={24} /></div>
                  <h2>Chargement des agents…</h2>
                  <p>Aven récupère les agents disponibles dans l’espace de travail actif.</p>
                </div>
              ) : agentsError ? (
                <div className="agents-empty agents-empty-error">
                  <div className="empty-symbol"><Icon name="agent" size={24} /></div>
                  <h2>Impossible de charger les agents</h2>
                  <p>{agentsError}</p>
                  <button className="button primary" type="button" onClick={() => { setAgentsLoading(true); setAgentsError(undefined); api.agents().then((a) => { setAgents(a); setTab((cur) => cur || a[0]?.id || "") }).catch((e) => setAgentsError(e instanceof Error ? e.message : String(e))).finally(() => setAgentsLoading(false)) }}>Réessayer</button>
                </div>
              ) : orderedAgents.length ? orderedAgents.map((a) => (
                <article key={a.id} className={`agent-card ${a.id === tab ? "active" : ""} ${a.id === "projet" ? "agent-card-orchestrator" : ""}`}>
                  <div className="agent-card-icon"><Icon name={a.id === "projet" ? "sparkle" : "agent"} size={24} /></div>
                  <div className="agent-card-body">
                    <span className="agent-card-id">{a.id}{a.id === "projet" && <em className="orchestrator-badge">orchestrateur</em>}</span>
                    {renamingAgent === a.id ? (
                      <input
                        className="rename-input"
                        autoFocus
                        value={agentValue}
                        maxLength={30}
                        placeholder={a.defaultName ?? a.id}
                        onFocus={(e) => e.target.select()}
                        onChange={(e) => setAgentValue(e.target.value)}
                        onBlur={() => void commitAgentRename(a.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void commitAgentRename(a.id)
                          if (e.key === "Escape") {
                            e.stopPropagation()
                            renameCancelled.current = true
                            setRenamingAgent(null)
                          }
                        }}
                      />
                    ) : (
                      <h2>{a.name}</h2>
                    )}
                    <p>{a.description || "Agent spécialisé Aven."}</p>
                  </div>
                  {/* v9.0.0 : conversations de cet agent, ouvertes avec bascule automatique. */}
                  {(() => {
                    const group = groupChatsByAgent(chats, [a.id])[0]
                    if (!group?.chats.length) return null
                    return (
                      <div className="agent-card-chats">
                        {group.chats.slice(0, 4).map((c) => (
                          <button key={c.id} className="chat-main" onClick={() => openConversationFromSidebar(c)} type="button" title="Ouvrir cette conversation">
                            <span className="chat-title">{c.title}</span>
                            <span className="chat-meta">{c.updated ? new Date(c.updated).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) : ""}</span>
                          </button>
                        ))}
                      </div>
                    )
                  })()}
                  <div className="agent-card-actions">
                    <button className="button secondary" onClick={() => selectAgent(a.id)} type="button">
                      Ouvrir
                    </button>
                    <button
                      className="button ghost"
                      onClick={() => {
                        renameCancelled.current = false
                        setAgentValue(a.name)
                        setRenamingAgent(a.id)
                      }}
                      type="button"
                    >
                      <Icon name="pencil" size={14} />Renommer
                    </button>
                  </div>
                </article>
              )) : (
                <div className="agents-empty">
                  <div className="empty-symbol"><Icon name="agent" size={24} /></div>
                  <h2>Aucun agent disponible</h2>
                  <p>Vérifiez que le moteur Aven est bien démarré et que ses agents sont présents dans l’espace actif.</p>
                </div>
              )}
            </div>
          </section>
        </main>
      ) : (
        <>
          <div className="workspace-layout">
            {appearance.showSidebar && (
              <aside className="sidebar">
                <div className="sidebar-top">
                  <div className="sidebar-heading"><div><span className="eyebrow">CONVERSATIONS</span><strong>{showArchived ? "Archivées" : agentName(tab)}</strong></div><button className="button primary small" onClick={newChat} disabled={!tab}><Icon name="plus" size={16} /></button></div>
                  <div className="search-wrap"><span><Icon name="search" size={16} /></span><input ref={searchRef} className="search" placeholder="Rechercher" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
                  <button className={`archive-toggle ${showArchived ? "selected" : ""}`} onClick={() => { setShowArchived((value) => !value); setChatId(null) }}><span><Icon name="archive-list" size={15} /></span>{showArchived ? "Revenir aux actives" : "Voir les archivées"}</button>
                </div>
                <div className="chat-list">
                  {chatGroups ? chatGroups.map((group) => (
                    <div key={group.agent || "autre"} className="chat-group">
                      <div className="chat-group-header"><span>{group.agent ? agentName(group.agent) : "Autre"}</span><span className="chat-group-count">{group.chats.length}</span></div>
                      {group.chats.map((c) => (
                        <div key={c.id} className={`chat ${c.id === chatId ? "active" : ""}`}>
                          {renamingChat === c.id ? (
                            <input className="rename-input" autoFocus value={chatValue} maxLength={120} onFocus={(e) => e.target.select()} onChange={(e) => setChatValue(e.target.value)} onBlur={() => void commitChatRename(c.id)} onKeyDown={(e) => { if (e.key === "Enter") void commitChatRename(c.id); if (e.key === "Escape") { e.stopPropagation(); renameCancelled.current = true; setRenamingChat(null) } }} />
                          ) : (
                            <button className="chat-main" onClick={() => openConversationFromSidebar(c)} onDoubleClick={() => startRenameChat(c.id)} title="Ouvrir la conversation"><span className="chat-title">{c.title}</span><span className="chat-meta">{c.updated ? new Date(c.updated).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) : ""}</span></button>
                          )}
                          <div className="chat-actions"><button onClick={() => startRenameChat(c.id)} title="Renommer" aria-label="Renommer"><Icon name="pencil" size={14} /></button><button onClick={() => exportChat(c.id)} title="Exporter" aria-label="Exporter"><Icon name="export" size={14} /></button><button onClick={() => toggleArchive(c.id, !showArchived)} title={showArchived ? "Désarchiver" : "Archiver"} aria-label={showArchived ? "Désarchiver" : "Archiver"}><Icon name={showArchived ? "restore" : "archive"} size={14} /></button><button onClick={() => removeChat(c.id)} title="Supprimer" aria-label="Supprimer"><Icon name="trash" size={14} /></button></div>
                        </div>
                      ))}
                    </div>
                  )) : visibleChats.map((c) => (
                    <div key={c.id} className={`chat ${c.id === chatId ? "active" : ""}`}>
                      {renamingChat === c.id ? (
                        <input className="rename-input" autoFocus value={chatValue} maxLength={120} onFocus={(e) => e.target.select()} onChange={(e) => setChatValue(e.target.value)} onBlur={() => void commitChatRename(c.id)} onKeyDown={(e) => { if (e.key === "Enter") void commitChatRename(c.id); if (e.key === "Escape") { e.stopPropagation(); renameCancelled.current = true; setRenamingChat(null) } }} />
                      ) : (
                        <button className="chat-main" onClick={() => setChatId(c.id)} onDoubleClick={() => startRenameChat(c.id)} title="Ouvrir la conversation"><span className="chat-title">{c.title}</span><span className="chat-meta">{c.updated ? new Date(c.updated).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) : ""}</span></button>
                      )}
                      <div className="chat-actions"><button onClick={() => startRenameChat(c.id)} title="Renommer" aria-label="Renommer"><Icon name="pencil" size={14} /></button><button onClick={() => exportChat(c.id)} title="Exporter" aria-label="Exporter"><Icon name="export" size={14} /></button><button onClick={() => toggleArchive(c.id, !showArchived)} title={showArchived ? "Désarchiver" : "Archiver"} aria-label={showArchived ? "Désarchiver" : "Archiver"}><Icon name={showArchived ? "restore" : "archive"} size={14} /></button><button onClick={() => removeChat(c.id)} title="Supprimer" aria-label="Supprimer"><Icon name="trash" size={14} /></button></div>
                    </div>
                  ))}
                  {!visibleChats.length && <div className="sidebar-empty"><span><Icon name="sparkle" size={20} /></span><p>Rien à afficher ici.</p></div>}
                </div>
                <div className="sidebar-footer"><button className="button secondary full" onClick={newChat} disabled={!tab}><Icon name="plus" size={14} />Nouvelle conversation</button></div>
              </aside>
            )}
            <main className="main">
              <div className="chat-titlebar">
                <div><span className="eyebrow">SESSION</span><strong>{chats.find((c) => c.id === chatId)?.title ?? "Nouvelle conversation"}</strong></div>
                <div className="row">
                  <button className="button ghost back-home-button" onClick={() => { setShowHome(false); setShowAgentsPage(true) }} aria-label="Voir la page des agents" type="button"><Icon name="agent" size={15} />Agents</button>
                  <button className="button ghost back-home-button" onClick={() => setShowHome(true)} aria-label="Retour à l’accueil" type="button"><Icon name="arrow-left" size={15} />Accueil</button>
                </div>
              </div>
              <div className="main-scroll" ref={scrollRef} onScroll={onScroll}>{mainBlocks.map((id) => { if (id === "notices" && !appearance.showNotices) return null; if (id === "model" && !appearance.showModel) return null; if (id === "composer" && !appearance.showComposer) return null; return blocks.get(id)?.() })}</div>
              {!followBottom && (
                <button
                  className="scroll-bottom"
                  onClick={() => {
                    setFollowBottom(true)
                    const el = scrollRef.current
                    if (el) el.scrollTop = el.scrollHeight
                  }}
                >
                  <Icon name="chevron-down" size={14} />Dernier message
                </button>
              )}
            </main>
          </div>
        </>
      )}

      {form && <FormDialog key={form.id} form={form} onSubmit={answerForm} onCancel={cancelForm} />}
      {showNotes && <NotesDialog initialId={notesInitialId} onClose={closeNotesToHome} onError={fail} />}

      {selBar && (
        <div className="selbar" role="toolbar" aria-label="Actions sur la sélection" style={{ top: selBar.top, left: selBar.left }}>
          <button type="button" title="Copier la sélection" onClick={() => { void navigator.clipboard.writeText(selBar.text); setSelBar(null) }}><Icon name="copy" size={15} /></button>
          <button type="button" title="Corriger ce code (agent code)" onClick={() => applySelection("fix")}><Icon name="wrench" size={15} /></button>
          <button type="button" title="Expliquer ce code (agent recherche)" onClick={() => applySelection("explain")}><Icon name="sparkle" size={15} /></button>
          <button type="button" title="Citer dans le composeur" onClick={() => applySelection("send")}><Icon name="chevron-right" size={15} /></button>
          <button type="button" className="selbar-close" title="Fermer" onClick={() => setSelBar(null)}><Icon name="close" size={15} /></button>
        </div>
      )}

      {showSettings && (
        <SettingsDialog
          state={appState}
          appearance={appearance}
          agents={orderedAgents}
          initialSection={settingsSection}
          focusWorkspaces={settingsFocus === "workspaces"}
          onAppearanceChange={updateAppearance}
          onAppearanceReset={resetAppearance}
          onClose={() => { setShowSettings(false); setSettingsFocus(undefined) }}
          onError={fail}
          onAppStateChanged={(next) => {
            // Clé enregistrée ou espace de travail changé : le moteur a redémarré côté main.
            // On réinitialise la conversation/agent comme au démarrage, sans recharger la page.
            setAppState(next)
            if (next.workspace && next.workspace !== appState.workspace) {
              setChats([])
              setChatId(null)
              setTab("")
              preferredChatIdRef.current = null
            }
          }}
        />
      )}

      {ask && (
        <div className="overlay">
          <div className="dialog permission-dialog">
            <span className="eyebrow">AUTORISATION</span>
            <h3>L’agent demande l’autorisation</h3>
            <p className="permission-action"><b>{ask.action}</b></p>
            <pre>{ask.resources.join("\n")}</pre>
            {ask.message && <p>{ask.message}</p>}
            <div className="row end">
              <button className="button ghost" onClick={() => answer("reject")}>Refuser</button>
              <button className="button secondary" onClick={() => answer("once")}>Une fois</button>
              <button className="button primary" onClick={() => answer("always")}>Toujours</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
