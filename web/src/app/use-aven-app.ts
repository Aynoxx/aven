import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent } from "react"
import { api } from "../api"
import { applyEvent, emptyLive, type Live } from "../stream"
import type { Agent, AppAction, AppState, Chat, Decision, FormAnswer, Msg, StreamEvent, TaskMode } from "../types"
import { useAppearance } from "../appearance"
import { useDictation } from "../voice-dictation"
import { effectiveIntent } from "../dictation-routing"
import { buildPrompt, selectionWithin } from "../selection-actions"
import { nextArrowIndex, type ArrowKey } from "../arrow-navigation"
import { groupChatsByAgent } from "../chat-groups"
import { AUTO_MODEL_LABEL, usableModelRef } from "../model-label"
import {
  activeTab as activeWorkbenchTab,
  bindChat,
  closeTab,
  focusTab,
  initialTabs,
  openConversation,
  openInstrument,
  removeChatTab,
  type InstrumentKind,
  type TabsState,
} from "../workbench/tabs"
import { HOME_NOTICE_TTL, FREEBUFF_MISSING_NOTICE, orderAgents, type Notice } from "./constants"

// v10.4.0 : le contrôleur porte tout l'état, les effets et les handlers de l'app.
// App.tsx n'est plus qu'un shell : il monte ce hook puis délègue le rendu aux pages
// (HomePage, TasksPage, ConversationPage, AppShell). Aucune logique métier ici ne
// dépend du DOM d'une page — les pages ne font que lire ce contrat.
export function useAvenApp() {
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
  const [appState, setAppState] = useState<AppState>({ status: "starting", keys: {}, providers: [] })
  // v11.1.0 : la section « voice » (agent vocal) rejoint les Réglages du Poste.
  const [settingsSection, setSettingsSection] = useState<"general" | "appearance" | "usage" | "voice">("general")
  const [notices, setNotices] = useState<Notice[]>([])
  // v11.0.0 : le Poste remplace les pages. Un état d'onglets unique décide de
  // l'instrument actif, de l'inspecteur et du retour ; plus de booléens par page.
  const [tabsState, setTabsState] = useState<TabsState>(initialTabs)
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const activeInstrument = activeWorkbenchTab(tabsState)
  const showHome = activeInstrument.kind === "home"
  const showNotes = activeInstrument.kind === "notes"
  const showFiles = activeInstrument.kind === "files"
  const showSettings = activeInstrument.kind === "settings"
  const showAgentsPage = activeInstrument.kind === "orchestration"
  const showFreebuffAgent = activeInstrument.kind === "terminal"
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
      setTabsState(initialTabs())
      setShowProjectPicker(false)
      setShowConversationPicker(false)
    }
  }, [appState.needsWorkspace])
  const [agentsLoading, setAgentsLoading] = useState(true)
  const [agentsError, setAgentsError] = useState<string>()
  const [showConversationPicker, setShowConversationPicker] = useState(false)
  // v9.1.6 (libellés v9.3.0 : « Espaces ») : gestion des espaces directement depuis le hub —
  // espaces connus, sans passer par les Réglages. Le changement redémarre le moteur
  // côté main (api.switchWorkspace), l'état remonte par le poll de app:state existant.
  const [showProjectPicker, setShowProjectPicker] = useState(false)
  const [notesInitialId, setNotesInitialId] = useState<string | undefined>()
  // v9.3.0 : explorateur de fichiers intégré (lecture seule) — remplace l'ouverture
  // externe de l'Explorateur Windows, qui reste disponible depuis la vue elle-même.
  // v11.0.0 : la pastille Freebuff vit dans le rail ; l'instrument Terminal est un
  // onglet unique (plus de page plein écran).
  // v9.3.0 : pastille d'état Freebuff du hub — "active" (session PTY vivante), "ready"
  // (CLI installé) ou "missing". Rechargée au montage et à chaque fermeture du terminal.
  const [freebuffPillState, setFreebuffPillState] = useState<"active" | "ready" | "missing" | "installing">("missing")
  const freebuffCliErrorRef = useRef("")
  // v10.3.0 : le CLI Freebuff est vérifié — et installé si absent — AU DÉMARRAGE de
  // l'app, pas à l'ouverture de la page Projet. `freebuffCliEnsure` est idempotent
  // côté host : plusieurs ouvertures de page ne peuvent pas lancer deux installations.
  useEffect(() => {
    if (appState.status !== "ready") return
    let stop = false
    const off = api.onEvent((ev) => {
      if (ev.type !== "freebuff.cli.state") return
      const d = ev.data as { state?: string; installed?: boolean; error?: string }
      if (stop) return
      freebuffCliErrorRef.current = d.error ?? ""
      setFreebuffPillState(d.installed ? "ready" : d.state === "installing" ? "installing" : "missing")
    })
    api.freebuffCliEnsure()
      .then((status) => {
        if (stop) return
        freebuffCliErrorRef.current = status.error ?? ""
        setFreebuffPillState(status.installed ? "ready" : "missing")
      })
      .catch(() => undefined)
    return () => { stop = true; off() }
  }, [appState.status])
  useEffect(() => {
    void (async () => {
      try {
        const [active, status] = await Promise.all([api.freebuffPtyActive(), api.freebuffCliStatus()])
        setFreebuffPillState(active ? "active" : status.installed ? "ready" : status.state === "installing" ? "installing" : "missing")
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
  // v10.2.2 : la bulle s'ancrait toujours vers le haut — en haut de la vue elle sortait
  // de la fenêtre (66 px visibles). On mesure la place réelle et on choisit le côté.
  const [modelMenuStyle, setModelMenuStyle] = useState<{ dir: "up" | "down"; maxHeight: number }>({ dir: "up", maxHeight: 300 })
  const modelButtonRef = useRef<HTMLButtonElement>(null)
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
  // v11.0.0 : un brouillon par conversation — changer d'onglet ne perd pas la saisie.
  const draftsRef = useRef<Map<string, string>>(new Map())
  const { appearance, updateAppearance, resetAppearance } = useAppearance()
  chatIdRef.current = chatId

  // Dictée vocale (v8.8.0) : routage d'intention — une commande d'application s'exécute
  // directement, une tâche pour un autre agent y bascule, et le reste atterrit dans le
  // composeur (jamais chez l'agent directement) avec son badge de reformage ; l'utilisateur
  // valide toujours avec Entrée.
  const fail = (e: unknown) => setError(e instanceof Error ? e.message : String(e))
  // v10.1.0 : mode de tâche de l'orchestrateur (persisté par espace côté host).
  const [taskMode, setTaskModeState] = useState<TaskMode>("auto")
  useEffect(() => { api.taskMode().then(setTaskModeState).catch(() => undefined) }, [])
  const changeTaskMode = (mode: TaskMode) => {
    api.setTaskMode(mode).then(setTaskModeState).catch(fail)
  }
  // v10.1.0 : capture rapide façon Kortex — raccourci global Ctrl+Shift/N (Rust)
  // restaure la fenêtre et demande l'ouverture de la capture (note dans Inbox/).
  const [captureRequested, setCaptureRequested] = useState(false)
  useEffect(() => {
    const off = api.onEvent((ev) => { if (ev.type === "quick-capture") setCaptureRequested(true) })
    return off
  }, [])
  const showHomeRef = useRef(true) // miroir de showHome pour les callbacks non recréés

  // Exécution d'une commande d'application dictée : mêmes handlers que les cartes du hub.
  // Retourne la phrase de confirmation, affichée là où l'utilisateur regarde.
  const routeAppAction = (action: AppAction): string => {
    switch (action) {
      // v10.5.0 : la commande vocale annonce la destination visible, Terminal Freebuff.
      // L'identifiant open-project reste interne pour préserver le contrat de routage.
      case "open-project":
        openFreebuffAgent()
        return "Terminal Freebuff ouvert."
      case "go-home":
        goHome()
        return "Accueil."
      case "open-notes":
        openNotesView()
        return "Notes ouvertes."
      case "open-settings":
        openConfiguration()
        return "Paramètres ouverts."
      case "open-agents":
        openAgentsPage()
        return "Orchestration ouverte."
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
        // v11.0.0 : les statistiques restent une section de Réglages.
        openConfiguration(undefined, "usage")
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
    // v10.4.0 : la PROVENANCE décide (module pur dictation-routing) — le composeur
    // transcrit toujours dans la chatbox, le hub exécute la commande demandée au
    // lieu de la renvoyer à l'agent comme du texte.
    onText: async (result, origin) => {
      if (!result.raw) return
      const cleaned = !!result.cleaned && result.cleaned !== result.raw
      const text = cleaned ? result.cleaned! : result.raw
      const intent = effectiveIntent(result.intent, origin, agents.map((a) => a.id))

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

      // v10.4.0 : la conversation n'est créée QU'ICI, quand un texte arrive vraiment —
      // l'ancien chemin créait une conversation dès l'appui sur le micro, donc chaque
      // commande du hub (« ouvre les paramètres ») laissait une conversation vide.
      let target = chatIdRef.current
      if (!target && tabRef.current) {
        try {
          const c = await api.createChat(tabRef.current)
          setChats((prev) => [c, ...prev])
          setChatId(c.id)
          target = c.id
          setTabsState((state) => openConversation(state, c.id, undefined, tabRef.current))
        } catch (e) { fail(e); return }
      } else if (target) {
        // Le texte d'une dictée rejoint TOUJOURS le composeur de la conversation active.
        setTabsState((state) => openConversation(state, target!, undefined, tabRef.current))
      }

      setInput(text)
      if (target) draftsRef.current.set(target, text)
      setDictationMeta({ cleaned, warning: result.warning, showRaw: false, rawText: result.raw, cleanedText: text })
      setShowConversationPicker(false)
      setShowProjectPicker(false)
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

  // v10.2.0 (E1) : suppression de conversation à deux clics — le premier arme
  // (4 s), le second confirme. Échap ou un autre armement désarme.
  const [deleteArmed, setDeleteArmed] = useState<string | null>(null)
  const deleteArmTimer = useRef<number | undefined>(undefined)

  // v11.0.0 : navigation du Poste. Ouvrir un instrument = ouvrir ou focus son
  // onglet ; fermer = fermer l'onglet actif. Plus de mémoire d'écran d'origine :
  // le rail et la barre d'onglets SONT la carte. Aucune View Transition de hub.
  const closePage = useCallback(() => {
    const next = closeTab(tabsState, tabsState.activeId)
    if (next === tabsState) return
    setTabsState(next)
    const tab = activeWorkbenchTab(next)
    if (tab.kind === "conversation") setChatId(tab.chatId ?? null)
  }, [tabsState])

  const openInstrumentTab = useCallback((kind: InstrumentKind) => {
    setTabsState((state) => openInstrument(state, kind))
    setShowConversationPicker(false)
    setShowProjectPicker(false)
  }, [])

  const closeWorkbenchTab = useCallback((id: string) => {
    const next = closeTab(tabsState, id)
    if (next === tabsState) return
    setTabsState(next)
    const tab = activeWorkbenchTab(next)
    if (tab.kind === "conversation") setChatId(tab.chatId ?? null)
  }, [tabsState])

  const focusWorkbenchTab = useCallback((id: string) => {
    const tab = tabsState.tabs.find((t) => t.id === id)
    if (!tab) return
    setTabsState((state) => focusTab(state, id))
    if (tab.kind === "conversation") {
      if (tab.agent && tab.agent !== tabRef.current) {
        tabRef.current = tab.agent
        setTab(tab.agent)
      }
      setChatId(tab.chatId ?? null)
    }
  }, [tabsState])

  const openNotesView = (initialId?: string) => {
    setNotesInitialId(initialId)
    openInstrumentTab("notes")
  }
  const openFilesView = () => openInstrumentTab("files")
  // v11.0.0 : le rail « Conversations » ouvre un onglet de conversation (draft) au
  // lieu de changer d'écran ; la première session chargée s'y rattache.
  const openConversationInstrument = () => {
    setTabsState((state) => openConversation(state, undefined, undefined, tabRef.current))
    setShowConversationPicker(false)
    setShowProjectPicker(false)
  }
  const openAgentsPage = () => openInstrumentTab("orchestration")
  const openFreebuffAgent = () => openInstrumentTab("terminal")
  const openConfiguration = (focus?: "workspaces", section: "general" | "appearance" | "usage" = "general") => {
    setSettingsSection(section)
    setSettingsFocus(focus)
    openInstrumentTab("settings")
  }

  // « Joindre à la conversation » / « Faire analyser » : le texte atterrit dans le
  // composeur de l'onglet actif (créée si besoin), comme la dictée — l'utilisateur valide.
  const composeIntoChat = useCallback(async (text: string) => {
    let target = chatIdRef.current
    if (!target && tabRef.current) {
      try {
        const c = await api.createChat(tabRef.current)
        setChats((prev) => [c, ...prev])
        setChatId(c.id)
        target = c.id
        setTabsState((state) => openConversation(state, c.id, undefined, tabRef.current))
      } catch (e) { fail(e); return }
    } else if (target) {
      setTabsState((state) => openConversation(state, target ?? undefined, undefined, tabRef.current))
    }
    setDictationMeta({ cleaned: false, showRaw: false, rawText: "", cleanedText: "" })
    setInput(text)
    if (target) draftsRef.current.set(target, text)
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
      // v10.3.0 : quand le terminal Freebuff a le focus, il possède le clavier.
      // Les raccourcis de l'app (Ctrl+N, Ctrl+K, F2, Ctrl+Maj+V, Échap) volaient
      // des touches au TUI — Entrée et Échap ne « faisaient » alors rien dans le
      // terminal. Le TUI reste joignable par les boutons de la page et la barre.
      const target = e.target as HTMLElement | null
      if (target?.closest?.(".bridge-term-host")) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === "n") {
        e.preventDefault()
        void newChat()
      } else if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault()
        document.querySelector<HTMLInputElement>(".wb-command-input")?.focus()
      } else if (mod && e.key.toLowerCase() === "w") {
        // v11.0.0 : fermer l'onglet actif, jamais la fenêtre (le Poste garde Aujourd'hui).
        e.preventDefault()
        closePage()
      } else if (mod && e.key === "Tab") {
        e.preventDefault()
        const list = tabsState.tabs
        const index = list.findIndex((t) => t.id === tabsState.activeId)
        const next = list[(index + (e.shiftKey ? -1 : 1) + list.length) % list.length]
        if (next) focusWorkbenchTab(next.id)
      } else if (mod && /^[1-7]$/.test(e.key)) {
        e.preventDefault()
        const kinds: InstrumentKind[] = ["home", "conversation", "notes", "files", "terminal", "orchestration", "settings"]
        const kind = kinds[Number(e.key) - 1]
        if (kind === "conversation") setTabsState((state) => openConversation(state, undefined, undefined, tabRef.current))
        else if (kind) openInstrumentTab(kind)
      } else if (e.key === "F2" && chatId && !showHome) {
        // v10.2.2 : F2 fonctionne même barre latérale masquée — le champ de renommage
        // vit aussi dans l'en-tête de la conversation (le raccourci n'est plus inerte).
        e.preventDefault()
        startRenameChat(chatId)
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "v") {
        // Push-to-talk clavier : Ctrl+Maj+V maintenue = enregistrer, relâchée = transcrire.
        // (keydown se répète tant que la touche est tenue : on n'agit qu'à la première.)
        e.preventDefault()
        if (!e.repeat && dictationRef.current.state === "idle") void dictationRef.current.start(showHome ? "workbench" : "composer")
      } else if (e.key === "Escape") {
        if (dictationRef.current.state === "recording") {
          dictationRef.current.cancel()
          return
        }
        if (deleteArmed) { setDeleteArmed(null); return } // v10.2.0 (E1) : Échap désarme la suppression
        // v10.2.2 : la barre de sélection est un popover : Échap la ferme avant tout
        // autre effet (elle restait affichée par-dessus la conversation).
        if (selBarRef.current) { setSelBar(null); return }
        if (showConversationPicker) setShowConversationPicker(false)
        else if (showProjectPicker) setShowProjectPicker(false)
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
  }, [live.busy, live.forms, chatId, showConversationPicker, showProjectPicker, showHome, tab, closePage, deleteArmed, tabsState, focusWorkbenchTab, openInstrumentTab])

  const newChat = async () => {
    if (!tab) return
    try {
      const c = await api.createChat(tab)
      setChats((prev) => [c, ...prev])
      setChatId(c.id)
      setShowConversationPicker(false)
      setShowProjectPicker(false)
      setTabsState((state) => openConversation(state, c.id, undefined, tabRef.current))
      requestAnimationFrame(() => textareaRef.current?.focus())
    } catch (e) {
      fail(e)
    }
  }

  const removeChat = async (id: string) => {
    try {
      await api.deleteChat(id)
      draftsRef.current.delete(id)
      // v11.14.1 : supprimer la conversation OUVERTE alors qu'une autre reste
      // fermait son onglet et rendait le dernier voisin (Notes, Aujourd'hui…).
      // La conversation qui reste reprend l'onglet — elle est choisie AVANT de
      // retirer le tab, sinon le Poste n'a plus rien à remettre à sa place.
      const rest = chatsRef.current.filter((c) => c.id !== id)
      const next = chatId === id ? rest[0] : undefined
      // Mise à jour fonctionnelle : une création concurrente n'est pas écrasée.
      setChats((cs) => cs.filter((c) => c.id !== id))
      if (chatId === id) setChatId(next?.id ?? null)
      setTabsState((state) => removeChatTab(state, id, next ? { chatId: next.id, agent: next.agent } : null))
    } catch (e) {
      fail(e)
    }
  }

  // v10.2.0 (E1) : première pression = armer (4 s), seconde = supprimer — on ne peut
  // plus détruire une conversation d'un seul clic.
  const armDelete = (id: string) => {
    window.clearTimeout(deleteArmTimer.current)
    if (deleteArmed === id) { setDeleteArmed(null); void removeChat(id); return }
    setDeleteArmed(id)
    deleteArmTimer.current = window.setTimeout(() => setDeleteArmed(null), 4000)
  }

  // v10.2.0 (F6) : le push-to-talk suit le doigt. Le doigt sort du bouton → pause
  // (le clip continue), le doigt revient → reprise ; le relâchement — même hors
  // bouton — transcrit. pointercancel (geste volé par le navigateur) annule le clip.
  const dictationPointerRef = useRef(false)
  const releaseDictation = () => {
    if (!dictationPointerRef.current) return
    dictationPointerRef.current = false
    if (dictationRef.current.state === "recording") dictationRef.current.stop()
  }
  const cancelDictationPointer = () => {
    if (!dictationPointerRef.current) return
    dictationPointerRef.current = false
    if (dictationRef.current.state === "recording") dictationRef.current.cancel()
  }
  useEffect(() => {
    window.addEventListener("pointerup", releaseDictation)
    window.addEventListener("pointercancel", cancelDictationPointer)
    return () => {
      window.removeEventListener("pointerup", releaseDictation)
      window.removeEventListener("pointercancel", cancelDictationPointer)
    }
  }, [])

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
    if (chatId) draftsRef.current.delete(chatId)
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
      // v10.2.2 : « null/… » persisté n'est pas un modèle — on ne l'affiche plus brut.
      const usable = usableModelRef(ref)
      if (!usable) return "Aucun modèle assigné"
      const known = Object.values(appState.assignments ?? {}).flat().find((m) => m.ref === usable)
      if (known) return known.label
      // Session héritée d'une version antérieure : le modèle n'est (plus) dans le catalogue.
      // On l'affiche tel quel (traçabilité) plutôt que de masquer une information.
      return usable
    },
    [appState.assignments],
  )
  const currentModel = chats.find((c) => c.id === chatId)?.model
  const activeModelLabel = usableModelRef(currentModel) ? labelOf(currentModel) : AUTO_MODEL_LABEL
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
      // v10.2.2 : une réponse « null/… » ne doit pas écraser le modèle affiché.
      const next = usableModelRef(updated.model)
      setChats((cs) => cs.map((c) => (c.id === updated.id ? { ...c, model: next ?? undefined } : c)))
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
  // calcul reste dans arrow-navigation.ts (pur, testé, AGENTS.md §8).
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


  // Basculer d’agent sans laisser une requête réseau tardive remplacer la conversation
  // du nouvel agent. L'onglet de conversation actif est réutilisé (draft) et se
  // rattachera à la première session chargée.
  const selectAgent = (id: string) => {
    if (!agents.some((a) => a.id === id)) return
    tabRef.current = id
    preferredChatIdRef.current = null
    setTab(id)
    setChatId(null)
    setTabsState((state) => openConversation(state, undefined, undefined, id))
    setShowConversationPicker(false)
    setShowProjectPicker(false)
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  const goHome = () => openInstrumentTab("home")

  const openHomeConversation = (chat: Chat) => {
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
    setTabsState((state) => openConversation(state, chat.id, undefined, chat.agent ?? tabRef.current))
    requestAnimationFrame(() => textareaRef.current?.focus())
  }

  // La barre de commande du Poste remplace la commande d'accueil : une recherche
  // vide n'envoie rien ; un texte prépare le composeur de la conversation ouverte.
  const submitHomeCommand = async (raw: string) => {
    const command = raw.trim()
    if (!command) return
    try {
      let target = chatId
      if (!target && tab) {
        const c = await api.createChat(tab)
        setChats((prev) => [c, ...prev])
        setChatId(c.id)
        target = c.id
      }
      if (target) setTabsState((state) => openConversation(state, target!, undefined, tabRef.current))
      setInput(command)
      if (target) draftsRef.current.set(target, command)
      setHomeCommand("")
      requestAnimationFrame(() => textareaRef.current?.focus())
    } catch (e) {
      fail(e)
    }
  }

  // v10.4.0 : Réglages peut changer d'espace — le moteur redémarre côté main et la
  // conversation, l'agent et la sélection préférée repartent de zéro, sans reload.
  const resetForWorkspace = (next: AppState) => {
    setAppState(next)
    if (next.workspace && next.workspace !== appState.workspace) {
      setChats([])
      setChatId(null)
      setTab("")
      preferredChatIdRef.current = null
    }
  }

  // v11.0.0 : la session chargée se rattache à l'onglet de conversation actif.
  useEffect(() => {
    if (!chatId) return
    setTabsState((state) => bindChat(state, chatId, tabRef.current))
  }, [chatId])

  // v11.0.0 : sauvegarde/restauration des brouillons au changement de session.
  const draftChatRef = useRef<string | null>(null)
  const draftInputRef = useRef("")
  draftInputRef.current = input
  useEffect(() => {
    const previous = draftChatRef.current
    if (previous && previous !== chatId) draftsRef.current.set(previous, draftInputRef.current)
    setInput(chatId ? draftsRef.current.get(chatId) ?? "" : "")
    draftChatRef.current = chatId
  }, [chatId])

  tabRef.current = tab
  showArchivedRef.current = showArchived
  showHomeRef.current = showHome
  chatsRef.current = chats

  // v10.4.0 : contrat exposé aux pages et au shell — liste explicite, typée par
  // inférence. Les détails internes (séquences de chargement, mises à jour de refs)
  // restent dans le hook.
  return {
    activeModelLabel,
    agentName,
    agents,
    agentsError,
    agentsLoading,
    announceRef,
    answer,
    answerForm,
    appState,
    appearance,
    applyModelChoice,
    applySelection,
    armDelete,
    arrowListNav,
    cancelDictationPointer,
    cancelForm,
    captureRequested,
    changeTaskMode,
    chatGroups,
    chatId,
    chatValue,
    chats,
    chatsRef,
    closePage,
    commitChatRename,
    composeIntoChat,
    conversationsListRef,
    currentModel,
    deleteArmed,
    dictation,
    dictationMeta,
    dictationPointerRef,
    editLastUserMessage,
    error,
    exportChat,
    fail,
    followBottom,
    form,
    freebuffCliErrorRef,
    freebuffPillState,
    goHome,
    homeCommand,
    homeNotice,
    homeSearchRef,
    input,
    labelOf,
    lastUserIdx,
    live,
    mainBlocks,
    messages,
    modelButtonRef,
    modelChain,
    modelMenuOpen,
    modelMenuStyle,
    newChat,
    notesInitialId,
    notices,
    openHomeConversation,
    submitHomeCommand,
    resetForWorkspace,
    renameCancelled,
    onMessagesMouseUp,
    onScroll,
    openAgentsPage,
    openConfiguration,
    openConversationFromSidebar,
    openFilesView,
    openFreebuffAgent,
    openNotesView,
    orderedAgents,
    recentListRef,
    releaseDictation,
    removeChat,
    renamingChat,
    resetAppearance,
    routeAppAction,
    scrollRef,
    search,
    searchRef,
    selBar,
    selectAgent,
    send,
    sendText,
    setAgents,
    setAgentsError,
    setAgentsLoading,
    setAppState,
    setCaptureRequested,
    setChatId,
    setChatValue,
    setChats,
    setDeleteArmed,
    setDictationMeta,
    setError,
    setFollowBottom,
    setHomeCommand,
    setHomeNotice,
    setInput,
    setLive,
    setMessages,
    setModelChain,
    setModelMenuOpen,
    setModelMenuStyle,
    setNotesInitialId,
    setNotices,
    setRenamingChat,
    setSearch,
    setSelBar,
    setSettingsFocus,
    setSettingsSection,
    setShowArchived,
    setShowConversationPicker,
    setShowProjectPicker,
    setTab,
    setTaskModeState,
    settingsFocus,
    settingsSection,
    showAgentsPage,
    showArchived,
    showArchivedRef,
    showConversationPicker,
    showFiles,
    showFreebuffAgent,
    showHome,
    showHomeRef,
    showNotes,
    showProjectPicker,
    showSettings,
    tabsState,
    activeInstrument,
    openInstrumentTab,
    openConversationInstrument,
    closeWorkbenchTab,
    focusWorkbenchTab,
    inspectorOpen,
    setInspectorOpen,
    signalActivity,
    startRenameChat,
    tab,
    tabRef,
    taskMode,
    textareaRef,
    toggleArchive,
    updateAppearance,
    visibleChats,
    workspaceName,
  }
}

// v10.4.0 : contrat complet, dérivé du hook (une seule source de vérité).
export type AvenApp = ReturnType<typeof useAvenApp>
