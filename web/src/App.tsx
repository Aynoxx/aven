import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { FormEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent, ReactNode } from "react"
import { api } from "./api"
import Markdown from "./Markdown"
import MessageBubble from "./MessageBubble"
import { applyEvent, emptyLive, type Live } from "./stream"
import type { Agent, AppAction, AppState, Chat, Decision, FormAnswer, Msg, StreamEvent } from "./types"
import FormDialog from "./FormDialog"
import SettingsDialog from "./SettingsDialog"
// v9.3.0 : vue Notes complète (rendu Markdown, édition, tags par agent) remplaçant le modal.
import NotesView from "./NotesView"
// v9.3.0 : explorateur de fichiers intégré (lecture seule, cloisonné à l'espace).
import FilesView from "./FilesView"
// v9.2.0 : terminal Freebuff intégré (pont PTY, protocole freebuff-bridge).
import FreebuffAgentPage from "./FreebuffAgentPage"
import { useAppearance } from "./appearance"
import { useDictation } from "./voice-dictation"
import { buildPrompt, selectionWithin } from "./selection-actions"
// v9.1.6 : navigation clavier des listes du hub — flèches Haut/Bas, Home/End.
// La logique (bouclage, index) vit dans le module pur arrow-navigation.ts, testé.
import { nextArrowIndex, type ArrowKey } from "./arrow-navigation"
import { groupChatsByAgent } from "./chat-groups"
// v9.7.0 : transitions de vue natives (View Transitions API, Chromium embarqué).
import { withViewTransition } from "./view-transitions"
import { Icon, type IconName } from "./icons"
import "./App.css"

// Durée d'affichage d'un avis du hub (v9.1.4) : le bandeau s'efface tout seul au lieu de
// recouvrir l'interface indéfiniment.
const HOME_NOTICE_TTL = 6_000
// Message exact affiché quand le CLI Freebuff est absent : le bandeau du hub reconnaît
// ce texte pour proposer le bouton « Installer » en direct.
const FREEBUFF_MISSING_NOTICE = "Le CLI Freebuff n'est pas installé : Paramètres → Freebuff CLI gratuit → « Installer le CLI (npm) »."
// v9.1.5 : si un terminal Freebuff tourne déjà, le lancement est REFUSÉ côté main
// (une seule session par compte, sinon « session taken over ») — le message d'erreur
// clair remonte tel quel dans le bandeau du hub via le catch de routeAppAction.

type Notice = { id: string; text: string }

function orderAgents(agents: Agent[], order: string[]) {
  const byId = new Map(agents.map((agent) => [agent.id, agent]))
  const ordered = order.map((id) => byId.get(id)).filter((agent): agent is Agent => Boolean(agent))
  const missing = agents.filter((agent) => !order.includes(agent.id))
  return [...ordered, ...missing]
}

// v9.4.0 : orientation rapide — chaque besoin courant pointe vers le bon assistant.
// v9.6.0 : la page Tâches = un agent principal (orchestrateur « projet ») et des modes.
// « Tâche complexe » ouvre l’orchestrateur lui-même : il délègue aux trois autres via subagents.
const MODES = [
  { id: "code", icon: "wrench", fallbackName: "Code", desc: "Écrire, corriger, exécuter du code et des commandes." },
  { id: "analyse", icon: "sparkle", fallbackName: "Analyse", desc: "Données, chiffres, statistiques, rapports." },
  { id: "recherche", icon: "search", fallbackName: "Recherche", desc: "Documentation, comparaisons, veille, explications." },
  { id: "projet", icon: "agent", fallbackName: "Tâche complexe", desc: "Orchestre code + analyse + recherche, puis synthétise." },
] as const

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

  const renameCancelled = useRef(false)
  const renameBusy = useRef(false)
  const creatingRef = useRef<Set<string>>(new Set())
  const autoFailed = useRef<Set<string>>(new Set())
  const [chatId, setChatId] = useState<string | null>(null)
  const [messages, setMessages] = useState<Msg[]>([])
  const [live, setLive] = useState<Live>(emptyLive)
  const [input, setInput] = useState("")
  const [error, setError] = useState<string>()
  const [appState, setAppState] = useState<AppState>({ status: "starting", keys: {}, providers: [], updatesConfigured: false })
  const [showSettings, setShowSettings] = useState(false)
  const [settingsSection, setSettingsSection] = useState<"general" | "appearance" | "usage">("general")
  const [notices, setNotices] = useState<Notice[]>([])
  const [showHome, setShowHome] = useState(true)
  const [homeNotice, setHomeNotice] = useState<string | null>(null)
  // v9.1.4 : le bandeau d'avis s'efface tout seul (il masquait l'interface indéfiniment).
  useEffect(() => {
    if (!homeNotice) return
    const t = setTimeout(() => setHomeNotice(null), HOME_NOTICE_TTL)
    return () => clearTimeout(t)
  }, [homeNotice])
  // v9.1.5 : plus aucun espace de travail — tous les panneaux laissent place à l'écran
  // de choix (sinon le sélecteur resterait masqué sous les Réglages ouverts).
  useEffect(() => {
    if (appState.needsWorkspace) {
      setShowSettings(false)
      setShowNotes(false)
      setShowFiles(false)
      setShowAgentsPage(false)
      setShowProjectPicker(false)
      setShowFreebuffAgent(false)
      setShowHome(true)
    }
  }, [appState.needsWorkspace])
  const [showAgentsPage, setShowAgentsPage] = useState(false)
  const [agentsLoading, setAgentsLoading] = useState(true)
  const [agentsError, setAgentsError] = useState<string>()
  const [showConversationPicker, setShowConversationPicker] = useState(false)
  // v9.1.6 (libellés v9.3.0 : « Espaces ») : gestion des espaces directement depuis le hub —
  // espaces connus, sans passer par les Réglages. Le changement redémarre le moteur
  // côté main (api.switchWorkspace), l'état remonte par le poll de app:state existant.
  const [showProjectPicker, setShowProjectPicker] = useState(false)
  const [showNotes, setShowNotes] = useState(false)
  const [notesInitialId, setNotesInitialId] = useState<string | undefined>()
  // v9.3.0 : explorateur de fichiers intégré (lecture seule) — remplace l'ouverture
  // externe de l'Explorateur Windows, qui reste disponible depuis la vue elle-même.
  const [showFiles, setShowFiles] = useState(false)
  // v9.5.0 : page pleine de l'agent Freebuff (comme la page Agents) — remplace le
  // dialogue v9.2.0 qui recouvrait l'écran courant.
  const [showFreebuffAgent, setShowFreebuffAgent] = useState(false)
  // v9.3.0 : pastille d'état Freebuff du hub — "active" (session PTY vivante), "ready"
  // (CLI installé) ou "missing". Rechargée au montage et à chaque fermeture du terminal.
  const [freebuffPillState, setFreebuffPillState] = useState<"active" | "ready" | "missing">("missing")
  useEffect(() => {
    void (async () => {
      try {
        const [active, status] = await Promise.all([api.freebuffPtyActive(), api.freebuffCliStatus()])
        setFreebuffPillState(active ? "active" : status.installed ? "ready" : "missing")
      } catch { setFreebuffPillState("missing") }
    })()
  }, [showFreebuffAgent])
  // Barre d'actions sur sélection (v8.9.0) : position viewport de la mini-barre flottante.
  const [selBar, setSelBar] = useState<{ text: string; top: number; left: number } | null>(null)
  const selBarRef = useRef(selBar)
  selBarRef.current = selBar
  // "Projets", dans le hub d'accueil, ouvre les Réglages directement sur la liste des espaces
  // de travail plutôt que de rester sur le haut du panneau général.
  const [settingsFocus, setSettingsFocus] = useState<"workspaces" | undefined>(undefined)
  // v9.4.0 : sélecteur de modèle interactif — la chaîne du routeur devient visible et
  // pilotable par conversation (« Auto » = le routeur choisit ; un choix épingle le modèle).
  const [modelChain, setModelChain] = useState<{ ref: string; label: string }[]>([])
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
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
        openNotesView()
        return "Notes ouvertes."
      case "open-settings":
        openConfiguration()
        return "Paramètres ouverts."
      case "open-agents":
        openAgentsPage()
        return "Page des agents ouverte."
      case "open-projects":
        openConfiguration("workspaces")
        return "Espaces ouverts."
      case "open-workspace":
        // v9.3.0 : la route vocale ouvre l'explorateur INTÉGRÉ (l'Explorateur Windows
        // reste accessible d'un clic dans la vue). L'écran courant est conservé : la
        // vue recouvre, comme le terminal Freebuff v9.2.1.
        openFilesView()
        return "Fichiers de l'espace ouverts."
      // v9.1.3 : Freebuff CLI, statistiques et nouvelle conversation exécutables à la voix.
      case "open-freebuff":
        // v9.2.0 : le TUI s'affiche DANS Aven via le pont PTY (session persistante) —
        // la console externe reste disponible depuis les Réglages si préférée.
        void (async () => {
          try {
            const status = await api.freebuffCliStatus()
            if (!status.installed) {
              setHomeNotice(FREEBUFF_MISSING_NOTICE)
              return
            }
            // v9.5.0 : l'agent Freebuff est une PAGE pleine (comme la page Agents) —
            // navigation exclusive, plus de dialogue recouvrant l'écran courant.
            openFreebuffAgent()
          } catch (e) {
            setHomeNotice(e instanceof Error ? e.message : String(e))
          }
        })()
        return "Freebuff…"
      case "open-stats":
        // v9.3.0 : les statistiques vivent dans les Réglages, onglet « Usage ».
        openConfiguration()
        setSettingsSection("usage")
        return "Statistiques ouvertes (Réglages → Usage)."
      case "new-chat":
        void newChat()
        return "Nouvelle conversation créée."
    }
  }
  // v9.1.3 : ref mis à jour à chaque rendu — la commande vocale appelle TOUJOURS la
  // dernière version de routeAppAction (closures fraîches : états, handlers, freebuffCli).
  const routeAppActionRef = useRef(routeAppAction)
  routeAppActionRef.current = routeAppAction
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
      // (v9.1.3) Passé par la ref : la closure de useDictation est créée une fois, la ref
      // garantit que l'action s'appuie sur les états et handlers COURANTS.
      if (intent?.intent === "app") {
        const confirmation = routeAppActionRef.current(intent.action)
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
      setShowProjectPicker(false)
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
  const applySelection = (action: "fix" | "explain" | "review" | "send") => {
    if (!selBar) return
    setDictationMeta({ cleaned: false, showRaw: false, rawText: "", cleanedText: "" })
    setInput(buildPrompt(action, selBar.text))
    if (action === "fix" && tab !== "code" && agents.some((a) => a.id === "code")) selectAgent("code")
    if (action === "explain" && tab !== "recherche" && agents.some((a) => a.id === "recherche")) selectAgent("recherche")
    // v9.4.0 : « Faire relire » passe par l'agent code, seul (avec projet) autorisé à déléguer au subagent code-reviewer.
    if (action === "review" && tab !== "code" && agents.some((a) => a.id === "code")) selectAgent("code")
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

  const closeNotesToHome = useCallback(() => {
    setShowNotes(false)
    setShowFiles(false)
    setNotesInitialId(undefined)
    setShowSettings(false)
    setShowAgentsPage(false)
    setShowConversationPicker(false)
    setShowProjectPicker(false)
    setShowHome(true)
  }, [])

  // ── Vues Notes et Fichiers (v9.3.0) ──────────────────────────────────────────
  // Ouvertures centralisées : les deux vues RECOURVENT l'écran courant (comme le
  // terminal Freebuff v9.2.1) — on ne masque plus showHome, la fermeture rend l'écran
  // d'origine. Ouverture des Notes depuis une conversation : la note créée hérite de
  // l'agent courant (pré-étiquetage).
  const openNotesView = (initialId?: string) => {
    setShowFiles(false)
    setShowSettings(false)
    setShowAgentsPage(false)
    setShowConversationPicker(false)
    setShowProjectPicker(false)
    setNotesInitialId(initialId)
    setShowNotes(true)
  }
  const openFilesView = () => {
    setShowNotes(false)
    setShowSettings(false)
    setShowAgentsPage(false)
    setShowConversationPicker(false)
    setShowProjectPicker(false)
    setShowFiles(true)
  }
  // « Joindre à la conversation » / « Faire analyser » : le texte atterrit dans le
  // composeur de l'onglet actif (créée si besoin), comme la dictée — l'utilisateur valide.
  const composeIntoChat = useCallback(async (text: string) => {
    setShowNotes(false)
    setShowFiles(false)
    setShowHome(false)
    if (!chatIdRef.current && tabRef.current) {
      try {
        const c = await api.createChat(tabRef.current)
        setChats((prev) => [c, ...prev])
        setChatId(c.id)
      } catch (e) { fail(e); return }
    }
    setDictationMeta({ cleaned: false, showRaw: false, rawText: "", cleanedText: "" })
    setInput(text)
    requestAnimationFrame(() => textareaRef.current?.focus())
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
        else if (showProjectPicker) setShowProjectPicker(false) // v9.1.6 : le modal projet suit Échap
        else if (showFreebuffAgent) { setShowAgentsPage(false); setShowSettings(false); setShowNotes(false); setShowConversationPicker(false); setShowProjectPicker(false); setShowFreebuffAgent(false); setShowHome(true) } // v9.5.0 : page agent — Échap revient à l'accueil (session maintenue)
        else if (showFiles) closeNotesToHome() // v9.3.0 : Échap ferme l'explorateur intégré
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
  }, [live.busy, live.forms, chatId, showSettings, showAgentsPage, showConversationPicker, showProjectPicker, showFreebuffAgent, showHome, showNotes, showFiles, tab, closeNotesToHome])

  const newChat = async () => {
    if (!tab) return
    try {
      const c = await api.createChat(tab)
      setChats((prev) => [c, ...prev])
      setChatId(c.id)
      setShowConversationPicker(false)
      setShowProjectPicker(false)
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
    const prompt = text.trim()
    if (!prompt) return
    setError(undefined)
    setFollowBottom(true)
    setMessages((m) => [...m, { id: `local-${Date.now()}`, role: "user", text: prompt }])
    setLiveBoth({ ...emptyLive, busy: true })
    try {
      await api.send(chatId, prompt)
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
  // v9.4.0 : la chaîne du routeur pour l'agent actif alimente le sélecteur de la modelbar.
  useEffect(() => {
    let stop = false
    if (!tab) { setModelChain([]); return }
    api.modelChain(tab).then((chain) => { if (!stop) setModelChain(chain) }).catch(() => { if (!stop) setModelChain([]) })
    return () => { stop = true }
  }, [tab, appState.status])
  // Applique « Auto » (ref absent) ou épingle un modèle ; la session renvoie son modèle effectif.
  const applyModelChoice = (ref?: string) => {
    if (!chatId) return
    setModelMenuOpen(false)
    api.setChatModel(chatId, ref).then((updated) => {
      setChats((cs) => cs.map((c) => (c.id === updated.id ? { ...c, model: updated.model ?? c.model } : c)))
    }).catch(fail)
  }
  // Ferme le menu du sélecteur au clic ailleurs.
  useEffect(() => {
    if (!modelMenuOpen) return
    const close = () => setModelMenuOpen(false)
    window.addEventListener("click", close)
    return () => window.removeEventListener("click", close)
  }, [modelMenuOpen])

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

  const agentName = (id: string) => agents.find((a) => a.id === id)?.name ?? id

  // (v9.3.0 : les statistiques ont quitté le hub pour l'onglet « Usage » des Réglages —
  // la vue du hub ne compte plus que des cartes d'action et de contenu.)

  // ── Navigation clavier des listes (v9.1.6, corrigé v9.2.0) ─────────────────────
  // FIX « Rendered fewer hooks than expected » : la première version définissait un
  // HOOK (useState/useRef/useEffect) appelé DANS renderHome(), fonction exécutée
  // CONDITIONNELLEMENT — en quittant l'accueil React voyait soudain moins de hooks
  // et l'ErrorBoundary masquait toute l'app. Les hooks ne vivent JAMAIS dans une
  // fonction de rendu. Ici : AUCUN état React — la sélection EST le focus DOM
  // (modèle ARIA : le focus suit la sélection, Entrée/Espace restent natifs) et le
  // calcul reste dans arrow-navigation.ts (pur, testé, RULES.md §8).
  const arrowListNav = (listRef: { current: HTMLDivElement | null }) => ({
    onKeyDown: (e: ReactKeyboardEvent) => {
      const key = e.key as ArrowKey
      if (key !== "ArrowDown" && key !== "ArrowUp" && key !== "Home" && key !== "End") return
      const items = listRef.current?.querySelectorAll<HTMLButtonElement>(":scope > button")
      if (!items?.length) return
      e.preventDefault() // la page ne défile pas : seules les flèches naviguent
      const current = Array.from(items).indexOf(document.activeElement as HTMLButtonElement)
      const next = nextArrowIndex(key, current, items.length)
      if (next === null) return
      items[next].focus() // le focus suit la sélection (bouclage et extrémités inclus)
    },
  })
  const recentListRef = useRef<HTMLDivElement>(null)
  const conversationsListRef = useRef<HTMLDivElement>(null)

  // Même logique que SettingsDialog.switchWs : bascule côté main puis reprise de l'état
  // frais (le moteur redémarre) en réinitialisant conversation et agent, comme au démarrage.

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
      stats: "chart", // v9.3.0 : l'onglet Usage des Réglages réutilise l'icône
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
    setShowProjectPicker(false)
    setShowSettings(false)
    setShowNotes(false)
    setShowHome(false)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  // v9.7.1 : `source` (depuis les cartes du hub) déclenche le shared element carte→page.
  const openAgentsPage = (source?: "tasks") => withViewTransition(() => {
    setShowHome(false)
    setShowSettings(false)
    setShowNotes(false)
    setShowConversationPicker(false)
    setShowProjectPicker(false)
    setShowFreebuffAgent(false)
    setShowAgentsPage(true)
  }, source)

  // v9.5.0 : la page agent Freebuff se navigue comme la page Agents — une seule vue
  // à la fois, « Accueil » dans la barre de fenêtre pour en sortir.
  const openFreebuffAgent = (source?: "project") => withViewTransition(() => {
    setShowHome(false)
    setShowSettings(false)
    setShowNotes(false)
    setShowConversationPicker(false)
    setShowProjectPicker(false)
    setShowAgentsPage(false)
    setShowFreebuffAgent(true)
  }, source)

  // v9.1.0 : retour accueil depuis la barre de fenêtre — ferme les panneaux ouverts.
  const goHome = () => withViewTransition(() => { // v9.7.1 : sans source = fondu root
    setShowAgentsPage(false)
    setShowSettings(false)
    setShowNotes(false)
    setShowConversationPicker(false)
    setShowProjectPicker(false)
    setShowFreebuffAgent(false)
    setShowHome(true)
  })

  const openConfiguration = (focus?: "workspaces") => {
    setShowAgentsPage(false)
    setShowNotes(false)
    setSettingsSection("general")
    setSettingsFocus(focus)
    setShowSettings(true)
  }


  const renderHome = () => {
    // v9.4.0 : hub reformé — 4 cartes à 90° (FAIRE : Projet, Agents · CONTENU : Fichiers,
    // Notes). Freebuff vit dans Assistants, Statistiques dans Réglages/Usage.
    const nav = [
      // v9.1.0 : « projet » est à part — carte dédiée d'orchestrateur, hors sélecteur d'agents.
      // v9.6.0 : la carte Projet OUVRE L'AGENT FREEBUFF (l'orchestrateur utilisateur devient
      // l'agent externe gratuit) — le nom « Projet » reste le repère de la porte principale.
      { key: "project", label: "Projet", kind: "project", hint: "Agent central (Freebuff)", action: () => openFreebuffAgent("project") },
      { key: "agents", label: "Tâches", kind: "agent", hint: "Spécialistes par tâche", action: () => openAgentsPage("tasks") },
      // v9.4.0 : Freebuff quitte le cercle — il vit dans la page Assistants (avec les agents), la pastille reste un raccourci.
      // v9.3.0 : Fichiers et Notes = le CONTENU de l'espace — vues intégrées (l'Explorateur
      // Windows reste disponible d'un clic dans la vue Fichiers).
      { key: "files", label: "Fichiers", kind: "files", hint: "Explorer l'espace", action: openFilesView },
      { key: "notes", label: "Notes", kind: "notes", hint: "Notes Markdown par agent", action: () => openNotesView() },
    ]
    const recent = chats.slice(0, 3)
    const allConversations = chats
    const online = appState.status === "ready"
    const command = homeCommand.trim()

    // v9.1.6 : flèches Haut/Bas dans les listes du hub (fabrique SANS hook — voir
    // le fix « Rendered fewer hooks » ci-dessus ; la sélection est le focus DOM).
    const recentNav = arrowListNav(recentListRef)
    const conversationsNav = arrowListNav(conversationsListRef)

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
        setShowProjectPicker(false)
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
      setShowProjectPicker(false)
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
              {/* v9.3.0 : le nom de l'ESPACE actif est visible en permanence. */}
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
            {/* v9.3.0 : pastille d'état Freebuff — le second assistant devient visible
                d'un coup d'œil (CLI installé ? session active ?). Clic = ouvrir le terminal. */}
            <button className={`freebuff-pill ${freebuffPillState}`} onClick={() => setHomeNotice(routeAppAction("open-freebuff"))} aria-label={`Freebuff : ${freebuffPillState === "active" ? "session active" : freebuffPillState === "ready" ? "CLI installé" : "CLI non installé"}`} title={freebuffPillState === "active" ? "Session Freebuff active — ouvrir le terminal" : freebuffPillState === "ready" ? "CLI Freebuff installé — ouvrir le terminal" : "CLI Freebuff non installé — voir comment l'installer"} type="button">
              <span className="freebuff-pill-dot" aria-hidden="true" />
              <span className="freebuff-pill-label">Freebuff</span>
            </button>
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
              {/* v9.1.6 : flèches Haut/Bas naviguent parmi les conversations récentes.
                  v9.3.0 : badge de l'agent propriétaire — le hub montre QUI possède chaque
                  conversation (cohérent avec la page Agents et le regroupement v9.0.0). */}
              <div className="home-recent-list" ref={recentListRef} onKeyDown={recentNav.onKeyDown}>
                {recent.map((chat) => (
                  <button key={chat.id} className="home-recent-item" onClick={() => openConversation(chat)} type="button">
                    <span className="home-recent-icon"><HubIcon kind={chat.agent === tab ? "agent" : "notes"} /></span>
                    <span className="home-recent-copy">
                      <strong>{chat.title || "Conversation"}</strong>
                      <small><em className="home-recent-agent">{agentName(chat.agent || tab)}</em>{chat.model ? ` · ${chat.model}` : ""}</small>
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

                {nav.map((item, i) => (
                  <button key={item.key} className={`hub-card hub-card-${item.key}`} style={{ "--stagger-i": i } as React.CSSProperties} onClick={item.action} aria-label={`${item.label} — ${item.hint}`} type="button">
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

                {homeNotice && (
                  <div className="home-notice" role="status">
                    <span>{homeNotice}</span>
                    {homeNotice === FREEBUFF_MISSING_NOTICE && (
                      <button
                        className="button primary home-notice-action"
                        type="button"
                        onClick={() => { api.freebuffCliLaunch("install").catch((e) => setHomeNotice(e instanceof Error ? e.message : String(e))) }}
                      >
                        Installer
                      </button>
                    )}
                    <button className="home-notice-close" type="button" aria-label="Fermer l'avis" onClick={() => setHomeNotice(null)}>
                      <Icon name="close" size={12} />
                    </button>
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
              {/* v9.1.6 : flèches Haut/Bas naviguent, Entrée ouvre la conversation focusée. */}
              <div className="home-modal-list" ref={conversationsListRef} onKeyDown={conversationsNav.onKeyDown}>
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

        {/* v9.6.0 : le sélecteur d'espaces du hub est retiré — la gestion des
            espaces vit dans Réglages → Configuration (et la commande vocale). */}
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
        {/* v9.4.0 : le modèle devient un choix, pas une affiche — « Auto » rend la main au routeur. */}
        <div className="model-select" onClick={(e) => e.stopPropagation()}>
          <button className="button secondary model-select-button" type="button" onClick={() => setModelMenuOpen(!modelMenuOpen)} aria-expanded={modelMenuOpen} aria-haspopup="listbox">
            <Icon name="chevron-down" size={14} />Choisir le modèle
          </button>
          {modelMenuOpen && (
            <div className="model-select-menu" role="listbox" aria-label="Modèles gratuits disponibles">
              <button className="model-select-item" type="button" role="option" onClick={() => applyModelChoice(undefined)}>
                Auto — le routeur choisit
              </button>
              {modelChain.map((m) => (
                <button key={m.ref} className="model-select-item" type="button" role="option" aria-selected={currentModel === m.ref} onClick={() => applyModelChoice(m.ref)} title={m.ref}>
                  {m.label}
                </button>
              ))}
              {!modelChain.length && <span className="hint model-select-empty">Chaîne indisponible (moteur arrêté ?)</span>}
            </div>
          )}
        </div>
      </div>
      <span className="model-assignment">{currentModel ? "Chaîne de l’agent · " + agentName(tab) : "Résolution du modèle…"}</span>
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
            <span className="composer-hint">
              {dictation.state === "recording" ? "J’écoute… relâche pour transcrire (Échap pour annuler)."
                : dictation.state === "transcribing" ? "Transcription…"
                : dictationMeta.cleaned && !dictationMeta.showRaw && input ? "Texte dicté éclairci — clique pour voir le brut."
                : dictationMeta.warning ? `Dictée non reformée : ${dictationMeta.warning}`
                : "Envoyez votre message à l’agent."}
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
{/* v10.0.0 : la barre de fermeture custom (héritée de la fenêtre Electron
    sans cadre) a disparu — Tauri affiche la barre Windows native. */}
      </div>

      {/* v9.1.6 : aucun projet par défaut — même quand des espaces sont déjà connus, rien
          ne démarre sans un choix explicite. L'écran liste les projets existants (un clic
          les active), et permet d'en créer un nouveau ou d'ouvrir un dossier existant. */}
      {appState.needsWorkspace && (
        <div className="overlay">
          <div className="dialog workspace-picker">
            <span className="eyebrow">PREMIERS PAS</span>
            <h3>Choisis ton espace de travail</h3>
            <p className="hint">
              Chaque espace a ses propres conversations, agents et réglages. Choisis un
              espace existant, crée un nouveau dossier (le sélecteur Windows le permet) ou
              ouvre un dossier existant — plus aucun espace n'est choisi à ta place.
            </p>
            {!!appState.workspaces?.length && (
              <div className="workspace-picker-list">
                {appState.workspaces.map((w) => (
                  <button key={w.path} className="workspace-picker-item" onClick={() => api.switchWorkspace(w.path).catch(fail)} type="button">
                    <span className="workspace-picker-name"><Icon name="folder" size={15} />{w.name}</span>
                    <span className="workspace-picker-path">{w.path}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="row">
              <button className="button primary" onClick={() => api.createWorkspace("").catch(fail)} type="button">Créer un nouvel espace…</button>
              <button className="button secondary" onClick={() => api.addExistingWorkspace().catch(fail)} type="button">Ouvrir un dossier existant…</button>
            </div>
            {error && <p className="err">{error}</p>}
          </div>
        </div>
      )}

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
      ) : showFreebuffAgent ? (
        /* v9.5.0 : page pleine de l'agent Freebuff — même gabarit que la page Agents,
           PTY persistant (le boot de la session vit dans le composant). */
        <FreebuffAgentPage onError={fail} />
      ) : showAgentsPage ? (
        <main className="agents-main">
          <section className="agents-page" aria-label="Tâches et agents">
            <header className="agents-page-header">
              <div>
                <span className="eyebrow">TÂCHES</span>
                <h1>Un agent principal, des modes par besoin</h1>
                <p>Choisis un mode : l’orchestrateur délègue aux spécialistes du domaine et synthétise.</p>
              </div>
              {/* v10.0.0 : pas de doublon « Accueil » ici — la barre de fenêtre
                  (window-tab global) porte déjà le retour vers l'accueil. */}
            </header>
            {/* v9.6.0 : l’orchestrateur « projet » est l’AGENT PRINCIPAL ; le mode
                « Tâche complexe » l’ouvre directement, les modes simples pointent les
                spécialistes (code / analyse / recherche). */}
            <div className="tasks-principal">
              <article className={`agent-card tasks-principal-card ${agents.some((a) => a.id === "projet") ? "agent-card-orchestrator" : "tasks-card-off"}`}>
                <div className="agent-card-icon"><Icon name="sparkle" size={24} /></div>
                <div className="agent-card-body">
                  <span className="agent-card-id">projet <em className="orchestrator-badge">agent principal</em></span>
                  <h2>{agentName("projet")}</h2>
                  <p>Comprend la demande, la découpe, délègue à code / analyse / recherche, puis synthétise.</p>
                  <div className="tasks-principal-actions">
                    <button className="button primary" onClick={() => selectAgent("projet")} disabled={!agents.some((a) => a.id === "projet")} type="button">
                      <Icon name="agent" size={14} />Ouvrir une conversation
                    </button>
                  </div>
                </div>
              </article>
            </div>
            <div className="tasks-modes">
              {MODES.map((m, i) => {
                const a = agents.find((x) => x.id === m.id)
                const group = a ? groupChatsByAgent(chats, [a.id])[0] : undefined
                const lastChat = group?.chats[0]
                return (
                  <article key={m.id} style={{ "--stagger-i": i + 1 } as React.CSSProperties} className={`tasks-mode-card ${a ? "" : "tasks-card-off"}`}>
                    <div className="agent-card-icon"><Icon name={m.icon} size={20} /></div>
                    <div className="agent-card-body">
                      <span className="agent-card-id">{m.id}</span>
                      <h2>{a?.name ?? m.fallbackName}</h2>
                      <p>{m.desc}</p>
                      {lastChat && (
                        <button className="chat-main tasks-mode-lastchat" onClick={() => openConversationFromSidebar(lastChat)} type="button" title="Ouvrir la dernière conversation de ce mode">
                          <span className="chat-title">{lastChat.title}</span>
                        </button>
                      )}
                    </div>
                    <div className="agent-card-actions">
                      <button className="button secondary" onClick={() => selectAgent(m.id)} disabled={!a} type="button">
                        Ouvrir
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
            {agentsLoading && <p className="hint">Chargement des agents…</p>}
            {agentsError && (
              <div className="agents-empty agents-empty-error">
                <div className="empty-symbol"><Icon name="agent" size={24} /></div>
                <h2>Impossible de charger les agents</h2>
                <p>{agentsError}</p>
                <button className="button primary" type="button" onClick={() => { setAgentsLoading(true); setAgentsError(undefined); api.agents().then((a) => { setAgents(a); setTab((cur) => cur || a[0]?.id || "") }).catch((e) => setAgentsError(e instanceof Error ? e.message : String(e))).finally(() => setAgentsLoading(false)) }}>Réessayer</button>
              </div>
            )}
          </section>
        </main>
      ) : (
        <>
          <div className="workspace-layout">
            {appearance.showSidebar && (
              <aside className="sidebar">
                <div className="sidebar-top">
                  <div className="sidebar-heading"><div><span className="eyebrow">CONVERSATIONS</span><strong>{showArchived ? "Archivées" : agentName(tab)}</strong></div><button className="button primary small" onClick={newChat} disabled={!tab} aria-label="Nouvelle conversation" title="Nouvelle conversation (Ctrl+N)"><Icon name="plus" size={16} /></button></div>
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
      {/* v9.3.0 : vue Notes complète (rendu Markdown, édition, tags par agent, « joindre
          à la conversation ») — remplace l'ancien modal Notes de v8.x. */}
      {showNotes && (
        <NotesView
          initialId={notesInitialId}
          agents={orderedAgents.map((a) => ({ id: a.id, name: a.name }))}
          currentAgent={tab}
          onCompose={(text) => void composeIntoChat(text)}
          onClose={closeNotesToHome}
          onError={fail}
        />
      )}
      {/* v9.3.0 : explorateur de fichiers intégré — lecture seule, cloisonné à l'espace
          côté main (safeResolve) ; « Faire analyser par un agent » passe par le composeur. */}
      {showFiles && (
        <FilesView
          agents={orderedAgents.map((a) => ({ id: a.id, name: a.name }))}
          onCompose={(text) => void composeIntoChat(text)}
          onClose={closeNotesToHome}
          onError={fail}
        />
      )}


      {selBar && (
        <div className="selbar" role="toolbar" aria-label="Actions sur la sélection" style={{ top: selBar.top, left: selBar.left }}>
          <button type="button" title="Copier la sélection" onClick={() => { void navigator.clipboard.writeText(selBar.text); setSelBar(null) }}><Icon name="copy" size={15} /></button>
          <button type="button" title="Corriger ce code (agent code)" onClick={() => applySelection("fix")}><Icon name="wrench" size={15} /></button>
          <button type="button" title="Expliquer ce code (agent recherche)" onClick={() => applySelection("explain")}><Icon name="sparkle" size={15} /></button>
          <button type="button" title="Faire relire ce code (agent code-reviewer)" onClick={() => applySelection("review")}><Icon name="eye" size={15} /></button>
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
