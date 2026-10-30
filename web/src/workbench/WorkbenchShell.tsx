import { useEffect, useLayoutEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { api } from "../api"
import { Icon } from "../icons"
import FormDialog from "../FormDialog"
import SettingsDialog from "../SettingsDialog"
import NotesView from "../NotesView"
import FilesView from "../FilesView"
import FreebuffAgentPage from "../FreebuffAgentPage"
import TasksPage from "../pages/TasksPage"
import ConversationPage from "../pages/ConversationPage"
import type { AvenApp } from "../app/use-aven-app"
import type { AppAction } from "../types"
import { useVoiceAgent } from "../voice-agent/use-voice-agent"
// v11.4.0 : le titre de la note dictée vient du contenu, pas d'un horodatage.
import { noteTitleFromDraft } from "../voice-agent/note"
import { TASK_MODES_UI, engineStatusLabel } from "../app/constants"
import { planFor } from "./actions"
import { nextTabFocus } from "./tabs"
import CommandBar from "./CommandBar"
import HomeStage from "./HomeStage"
import NavigationConstellation, { type NavDestination } from "./NavigationConstellation"
import WireframeAgent from "../agent/WireframeAgent"

// v12.0.0 : coquille du Poste « agent d'abord ». Le contrôleur porte l'état ; la
// coquille rend un en-tête unique (marque, section, agent compact, contrôles), la
// scène, l'inspecteur en tiroir, la barre de commande et la constellation. Aucun
// rail permanent : la navigation est une action temporaire, pas un meuble.

// L'ordre est STABLE et fait autorité : icône, titre, surbrillance et aria-current
// viennent tous d'ici. Les libellés sont ceux de l'interface, jamais des identifiants.
const DESTINATIONS: NavDestination[] = [
  // v11.0.2 : une conversation porte une bulle, la délégation une ramification ;
  // `agent` ne désigne plus qu'un agent et `sparkle` que la marque d'Aven.
  { kind: "conversation", label: "Conversations", icon: "chat" },
  { kind: "notes", label: "Notes", icon: "file" },
  { kind: "files", label: "Fichiers", icon: "folder" },
  { kind: "terminal", label: "Terminal", icon: "terminal" },
  { kind: "orchestration", label: "Orchestration", icon: "branch" },
]

// Aujourd'hui reste une destination explicite — atteinte par la marque, jamais par
// la poignée de navigation (le brief distingue les deux).
const HOME_DESTINATION = { kind: "home", label: "Aujourd’hui", icon: "grid" } as const

// Diamètre du canvas de l'agent : constant, pour que le repli soit une TRANSFORMATION
// du même dessin (CSS scale), pas un second rendu approximatif.
const AGENT_CANVAS = 340

function tabLabel(app: AvenApp, kind: string, chatId?: string): string {
  if (kind === "conversation") {
    return app.chats.find((c) => c.id === chatId)?.title || "Nouvelle conversation"
  }
  switch (kind) {
    case "home": return "Aujourd’hui"
    case "notes": return "Notes"
    case "files": return "Fichiers"
    case "terminal": return "Terminal"
    case "orchestration": return "Orchestration"
    case "settings": return "Réglages"
    default: return kind
  }
}

export default function WorkbenchShell({ app }: { app: AvenApp }) {
  const {
    activeInstrument,
    answer,
    answerForm,
    appState,
    appearance,
    applySelection,
    cancelForm,
    captureRequested,
    closePage,
    // v11.3.0 : la croix de chaque onglet revient — sans elle, une souris ne pouvait
    // plus fermer quoi que ce soit (Ctrl+W seulement).
    closeWorkbenchTab,
    error,
    fail,
    focusWorkbenchTab,
    form,
    goHome,
    homeNotice,
    inspectorOpen,
    live,
    loadedFor,
    filesInitialPath,
    openConfiguration,
    openConversationInstrument,
    openFilesView,
    setFilesInitialPath,
    openHomeConversation,
    openInstrumentTab,
    openNotesView,
    orderedAgents,
    resetAppearance,
    resetForWorkspace,
    routeAppAction,
    selBar,
    setCaptureRequested,
    setHomeNotice,
    setInspectorOpen,
    setSelBar,
    setSettingsSection,
    settingsFocus,
    startWithPrompt,
    settingsSection,
    tab,
    tabsState,
    taskMode,
    changeTaskMode,
    newChat,
    updateAppearance,
    workspaceName,
    currentModel,
    activeModelLabel,
    modelChain,
    applyModelChoice,
    agentName,
    notices,
    composeIntoChat,
    chats,
    chatId,
    chatValue,
    commitChatRename,
    renameCancelled,
    renamingChat,
    setChatValue,
    setRenamingChat,
    startRenameChat,
  } = app

  // v12.0.0 : la constellation n'est pas un état de page — elle s'ouvre et se
  // referme sans changer la destination courante.
  const [navOpen, setNavOpen] = useState(false)
  // v12.6.0 : la barre de commande n'est plus JAMAIS permanente — ni sur l'accueil,
  // ni dans un espace de travail. Elle était une bande de 56 px qui mangeait le
  // bas du Poste en permanence pour un usage occasionnel. Elle se demande par
  // Ctrl+K et se referme à Échap : une palette, pas un meuble.
  const [commandOpen, setCommandOpen] = useState(false)
  const [leaving, setLeaving] = useState<NavDestination["kind"] | null>(null)
  const [agentPlacement, setAgentPlacement] = useState<{ x: number; y: number; scale: number } | null>(null)
  const [reducedMotion, setReducedMotion] = useState(false)
  // v11.1.0 : l'agent vocal vit dans la coquille — il écoute tant que l'app est
  // prête et que le micro n'est pas coupé. La navigation passe par le routeur
  // unique des commandes vocales (même contrat que la dictée historique).
  const voice = useVoiceAgent({
    enabled: appState.status === "ready" && !appState.needsWorkspace,
    onAction: (action) => routeAppAction(action as AppAction),
    // v11.4.0 : ce rappel n'est atteint qu'après un « oui » explicite (le hook
    // décide). Le Poste crée la note dans l'espace actif PUIS l'affiche : l'écrit
    // doit être visible, pas seulement annoncé à la voix.
    onCreateNote: async (draft) => {
      const note = await api.noteQuickCapture(noteTitleFromDraft(draft), draft)
      openNotesView(note.id)
      return note.title
    },
    // v11.15.0 : une note proposée par l'agent et confirmée s'ouvre comme une
    // note dictée — l'écrit doit être visible, pas seulement annoncé.
    onNoteCreated: (noteId) => openNotesView(noteId),
  })
  const ask = live.asks[0]
  const showNoKeyBanner = appState.status === "ready" && !Object.values(appState.keys).some(Boolean)
  const lastAssistant = [...app.messages].reverse().find((m) => m.role === "assistant" && m.text.trim())
  const activeKind = activeInstrument.kind
  const isHome = activeKind === "home"
  const activeSection = DESTINATIONS.find((d) => d.kind === activeKind) ?? DESTINATIONS[0]
  const conversationTabs = tabsState.tabs.filter((t) => t.kind === "conversation")
  // Le bandeau d'onglets ne liste QUE des conversations : la scène ne peut être
  // un `tabpanel` que lorsque l'un de ces onglets est réellement affiché.
  const stageIsTab = conversationTabs.length > 1 && activeKind === "conversation"

  // v12.6.0 : un changement de destination referme la palette — elle ne survit
  // pas à la navigation (le Poste ne laisse jamais un panneau ouvert derrière).
  useEffect(() => {
    setCommandOpen(false)
  }, [activeKind])

  // Ctrl+K ouvre la palette PARTOUT, AVANT que le contrôleur ne cherche son input
  // (elle n'existe pas encore dans le DOM à cet instant). Capture + stop pour que
  // les deux gestionnaires ne se disputent pas la même frappe.
  useEffect(() => {
    if (commandOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "k") return
      event.preventDefault()
      event.stopPropagation()
      setCommandOpen(true)
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [commandOpen])

  // Le focus attend le rendu : l'input vient d'être monté par le même tour.
  useEffect(() => {
    if (!commandOpen) return
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>(".wb-command-input")?.focus())
  }, [commandOpen])

  // Le repli de l'agent est une MESURE, pas une constante : l'ancre de l'état
  // courant (accueil ou en-tête) donne le rectangle réel. Une seule instance de
  // canvas se déplace entre les deux.
  useLayoutEffect(() => {
    const measure = () => {
      const anchor = document.getElementById(isHome ? "agent-home-anchor" : "agent-toolbar-anchor")
      if (!anchor) return
      const rect = anchor.getBoundingClientRect()
      if (!rect.width || !rect.height) return
      const scale = Math.min(1.25, Math.max(0.05, rect.width / AGENT_CANVAS))
      setAgentPlacement({
        x: Math.round(rect.left + rect.width / 2 - (AGENT_CANVAS * scale) / 2),
        y: Math.round(rect.top + rect.height / 2 - (AGENT_CANVAS * scale) / 2),
        scale: Number(scale.toFixed(3)),
      })
    }
    const frame = requestAnimationFrame(measure)
    window.addEventListener("resize", measure)
    return () => { cancelAnimationFrame(frame); window.removeEventListener("resize", measure) }
  }, [isHome, inspectorOpen])

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)")
    const apply = () => setReducedMotion(query.matches)
    apply()
    query.addEventListener("change", apply)
    return () => query.removeEventListener("change", apply)
  }, [])

  // v12.0.0 : Échap ferme la constellation AVANT tout autre effet du Poste. C'est un
  // panneau de navigation : il ne doit jamais rester ouvert derrière une action, et
  // il ne doit pas non plus refermer l'instrument courant — la capture et l'arrêt de
  // propagation empêchent le contrôleur de traiter le même Échap.
  useEffect(() => {
    if (!navOpen) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return
      event.preventDefault()
      event.stopPropagation()
      setNavOpen(false)
      setLeaving(null)
      requestAnimationFrame(() => document.querySelector<HTMLButtonElement>(".wb-nav-trigger")?.focus())
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [navOpen])

  const goToDestination = (kind: NavDestination["kind"]) => {
    if (kind === "conversation") openConversationInstrument()
    else openInstrumentTab(kind)
  }

  // Un cercle choisi devient le point focal, les autres s'écartent : la scène
  // monte tout de suite, les cercles finissent de sortir (~300 ms) et l'arc
  // disparaît ENTIÈREMENT ensuite. Aucun cercle ne survit dans l'espace de travail.
  const selectDestination = (kind: NavDestination["kind"]) => {
    if (!navOpen) { goToDestination(kind); return }
    setLeaving(kind)
    goToDestination(kind)
    window.setTimeout(() => { setNavOpen(false); setLeaving(null) }, 300)
  }

  const citeLast = async () => {
    if (!lastAssistant) return
    const plan = planFor("cite", { kind: "message", body: lastAssistant.text, title: lastAssistant.agent || "Réponse" })
    if (!plan || plan.mode !== "note") return
    try {
      const note = await api.noteQuickCapture("", plan.text)
      openNotesView(note.id)
    } catch (e) { fail(e) }
  }

  const inspectorTitle = activeKind === "conversation" ? "SESSION" : activeKind === "settings" ? "SECTIONS" : "CONTEXTE"
  const activeChat = chats.find((c) => c.id === chatId)

  // v11.0.0 : le tablist se pilote aux flèches horizontales (ARIA), le focus suit
  // l'onglet sélectionné — même contrat que les listes verticales du Poste.
  const onTabsKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    const index = tabsState.tabs.findIndex((t) => t.id === tabsState.activeId)
    const next = nextTabFocus(e.key, index, tabsState.tabs.length)
    if (next === null) return
    e.preventDefault()
    const id = tabsState.tabs[next].id
    focusWorkbenchTab(id)
    requestAnimationFrame(() => document.getElementById(`wb-tab-${id}`)?.focus())
  }

  return (
    <div className="wb-app" data-nav={navOpen ? "open" : "closed"}>
      <header className="wb-status">
        <div className="wb-status-left">
          {/* v12.0.0 : la marque est le retour à l'accueil — une action distincte,
              jamais confondue avec la poignée de navigation. */}
          <button
            className="wb-brand"
            type="button"
            onClick={goHome}
            aria-label="Aven — revenir à l’accueil"
            title={`Aven — ${HOME_DESTINATION.label}`}
          >
            <span className="brand-mark" aria-hidden="true"><Icon name="sparkle" size={15} /></span>
            <span className="wb-brand-word">Aven</span>
          </button>
          <span className="wb-status-sep" aria-hidden="true" />
          <button
            className="wb-status-workspace"
            type="button"
            onClick={() => openConfiguration("workspaces")}
            title="Changer d’espace de travail"
            aria-label={`Espace de travail : ${workspaceName || "aucun"}. Changer`}
          >
            <Icon name="folder" size={14} />
            <span>{workspaceName || "Aucun espace"}</span>
          </button>
          {activeKind !== "home" && activeKind !== "settings" && (
            <>
              <span className="wb-status-sep" aria-hidden="true" />
              <span className="wb-section">
                <Icon name={activeSection.icon} size={16} />
                <h1 className="wb-section-title">{activeSection.label}</h1>
                {activeKind === "conversation" && app.chats.length > 0 && (
                  <span className="wb-section-count">{app.chats.length}</span>
                )}
              </span>
            </>
          )}
        </div>
        <div className="wb-status-center">
          {/* L'ancre de l'agent compact. Le canvas est ailleurs mais vient EXACTEMENT
              ici : c'est le même objet qui se replie, pas une icône qui le remplace. */}
          <span id="agent-toolbar-anchor" className="wb-agent-anchor" aria-hidden="true" />
          {/* v12.0.0 : sur l'accueil, l'état est DÉJÀ dit sous le micro (HomeStage).
              Le rendre deux fois ferait deux annonces aria-live pour la même vérité. */}
          {!isHome && (
            <span
              className="wb-agent-state"
              role="status" aria-live="polite"
              data-error={voice.error ? "true" : undefined}
              title={voice.error ?? (voice.heard ? `Entendu : « ${voice.heard} »` : voice.awake ? "Éveillé : chaque phrase t’est adressée." : undefined)}
            >
              {voice.error ?? voice.label}
            </span>
          )}
        </div>
        <div className="wb-status-right">
          {/* v11.1.0 : micro, phase et interruption restent visibles en permanence.
              Le libellé du centre porte l'état ; ce bloc porte l'ACTION. */}
          {/* v12.0.0 : sur l'accueil, le micro sous la sphère est LE contrôle
              vocal. Le dupliquer ici donnait deux boutons pour la même session ;
              l'interruption, elle, reste offerte pendant une réponse. */}
          {(!isHome || voice.phase === "speaking" || voice.phase === "thinking") && (
          <div className="wb-voice" data-phase={voice.phase}>
            {!isHome && (
              <button
                className="button ghost wb-voice-button"
                type="button"
                onClick={voice.toggleMic}
                aria-pressed={!voice.muted}
                aria-label={voice.muted ? "Activer le micro de l’agent vocal" : "Couper le micro de l’agent vocal"}
                title={voice.error ?? (voice.muted ? "Micro coupé — clique pour écouter" : voice.awake ? "Éveillé — dis « Aven, dors » pour le rendormir" : `${voice.label} — dis « Aven » pour parler`)}
              >
                <Icon name={voice.muted ? "microphone-off" : "microphone"} size={14} />
              </button>
            )}
            {(voice.phase === "speaking" || voice.phase === "thinking") && (
              <button
                className="button ghost wb-voice-stop"
                type="button"
                onClick={voice.stop}
                aria-label="Interrompre l’agent vocal"
                title="Interrompre l’agent vocal"
              >
                <Icon name="stop" size={12} />
              </button>
            )}
          </div>
          )}
          <button
            className="button ghost wb-status-toggle"
            type="button"
            onClick={() => openConfiguration(undefined, "general")}
            aria-label="Réglages"
            title="Réglages"
          >
            <Icon name="settings" size={15} />
          </button>
          <button
            className="button ghost wb-status-toggle"
            type="button"
            onClick={() => setInspectorOpen(!inspectorOpen)}
            aria-pressed={inspectorOpen}
            aria-label={inspectorOpen ? "Masquer l’inspecteur" : "Afficher l’inspecteur"}
            title={inspectorOpen ? "Masquer l’inspecteur" : "Afficher l’inspecteur"}
          >
            <Icon name="panel" size={14} />
          </button>
        </div>
      </header>

      <div className="wb-body" data-inspector={inspectorOpen ? "open" : "closed"}>
        <main className="wb-main" data-sessions={conversationTabs.length > 1 ? "true" : "false"}>
          {/* v12.0.0 : plus de barre d'onglets permanente. Ce bandeau ne vit que
              s'il y a PLUSIEURS conversations ouvertes : il liste des sessions, pas
              des destinations — la navigation primaire est la constellation. */}
          {conversationTabs.length > 1 && (
            <div className="wb-tabs" role="tablist" aria-label="Onglets du Poste" onKeyDown={onTabsKeyDown}>
              {conversationTabs.map((t) => {
                const selected = t.id === tabsState.activeId
                const label = tabLabel(app, t.kind, t.chatId)
                return (
                  <div key={t.id} className="wb-tab" data-selected={selected || undefined}>
                    <button
                      className="wb-tab-main"
                      id={`wb-tab-${t.id}`}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      aria-controls="wb-stage"
                      tabIndex={selected ? 0 : -1}
                      onClick={() => focusWorkbenchTab(t.id)}
                      title={label}
                    >
                      <span className="wb-tab-kind">CONV</span>
                      <span className="wb-tab-label">{label}</span>
                    </button>
                    <button
                      className="wb-tab-close"
                      type="button"
                      aria-label={`Fermer ${label}`}
                      title={`Fermer ${label}`}
                      tabIndex={selected ? 0 : -1}
                      onClick={() => closeWorkbenchTab(t.id)}
                    >
                      <Icon name="close" size={12} />
                    </button>
                  </div>
                )
              })}
              <span className="wb-tabs-spacer" />
              <div className="wb-tabs-tools">
                <button className="button ghost" type="button" onClick={() => void newChat()} disabled={!tab} aria-label="Nouvelle conversation" title="Nouvelle conversation (Ctrl N)">
                  <Icon name="plus" size={15} />
                </button>
              </div>
            </div>
          )}

          {/* v12.0.0 : le rôle suit ce qui est RÉELLEMENT rendu. Pointer vers
              `wb-tab-…` alors que le bandeau n'existe pas (un instrument, ou une
              seule conversation) laissait une référence ARIA morte. */}
          <div
            className="wb-stage"
            id="wb-stage"
            role={stageIsTab ? "tabpanel" : "region"}
            aria-labelledby={stageIsTab ? `wb-tab-${tabsState.activeId}` : undefined}
            aria-label={stageIsTab ? undefined : (isHome ? HOME_DESTINATION.label : activeSection.label)}
          >
            {activeKind === "home" ? (
              <HomeStage
                voice={voice}
                // v12.3.0 : « Reprendre » ne lit l'espace que lorsque le Poste est
                // prêt et qu'un espace est réellement actif.
                ready={appState.status === "ready" && !appState.needsWorkspace}
                chats={app.chats}
                // v12.7.0 : ne pas afficher un faux état vide pendant le chargement
                // de l'historique de l'espace actif.
                chatsReady={loadedFor === tab}
                delegation={TASK_MODES_UI.find((m) => m.id === taskMode)?.label ?? TASK_MODES_UI[0].label}
                onOpenConversation={openHomeConversation}
                onOpenNote={(id) => openNotesView(id)}
                onNewChat={() => { void newChat() }}
                // v12.1.0 : « Dicter une note » ouvre la capture de la vue Notes, qui
                // possède son propre enregistreur — indépendant de l'agent vocal, donc
                // disponible même micro de l'agent coupé.
                onDictateNote={() => { setCaptureRequested(true); openNotesView() }}
                // v12.3.0 : l'action passe la fonction telle quelle — une enveloppe
                // vide n'ajoutait rien et masquait le lien réel avec l'ouverture.
                onBrowseFiles={openFilesView}
                onOpenFile={(path) => openFilesView(path)}
                // v12.5.0 : la saisie d'accueil envoie réellement le premier message.
                onPrompt={(text) => { void startWithPrompt(text) }}
                notice={homeNotice}
                onDismissNotice={() => setHomeNotice(null)}
                onOpenSettings={() => { setHomeNotice(null); openConfiguration(undefined, "general") }}
              />
            ) : activeKind === "conversation" ? (
              <ConversationPage app={app} />
            ) : activeKind === "notes" ? (
              <NotesView
                autoCapture={captureRequested}
                onCaptureHandled={() => setCaptureRequested(false)}
                initialId={app.notesInitialId}
                agents={orderedAgents.map((a) => ({ id: a.id, name: a.name }))}
                currentAgent={tab}
                onCompose={(text) => void composeIntoChat(text)}
                onClose={closePage}
                onError={fail}
              />
            ) : activeKind === "files" ? (
              <FilesView
                initialPath={filesInitialPath}
                onInitialHandled={() => setFilesInitialPath(undefined)}
                agents={orderedAgents.map((a) => ({ id: a.id, name: a.name }))}
                currentAgent={tab}
                onCompose={(text) => void composeIntoChat(text)}
                onClose={closePage}
                onError={fail}
              />
            ) : activeKind === "terminal" ? (
              <FreebuffAgentPage onError={fail} onClose={closePage} />
            ) : activeKind === "orchestration" ? (
              <TasksPage app={app} />
            ) : (
              <SettingsDialog
                state={appState}
                appearance={appearance}
                agents={orderedAgents}
                section={settingsSection}
                onSectionChange={setSettingsSection}
                focusWorkspaces={settingsFocus === "workspaces"}
                onAppearanceChange={updateAppearance}
                onAppearanceReset={resetAppearance}
                onClose={closePage}
                onError={fail}
                onAppStateChanged={resetForWorkspace}
              />
            )}
          </div>
        </main>

        <aside className="wb-inspector" aria-label="Inspecteur" aria-hidden={!inspectorOpen}>
          <div className="wb-inspector-head">
            <span className="wb-inspector-title">{inspectorTitle}</span>
            <button className="button ghost" type="button" onClick={() => setInspectorOpen(false)} aria-label="Masquer l’inspecteur" title="Masquer l’inspecteur">
              <Icon name="close" size={14} />
            </button>
          </div>
          <div className="wb-inspector-body">
            {activeKind === "conversation" ? (
              <>
                <section className="wb-inspector-section">
                  <span className="wb-label">SESSION</span>
                  {chatId && renamingChat === chatId ? (
                    <input
                      className="wb-input"
                      autoFocus
                      value={chatValue}
                      maxLength={120}
                      aria-label="Titre de la conversation"
                      onFocus={(e) => e.target.select()}
                      onChange={(e) => setChatValue(e.target.value)}
                      onBlur={() => void commitChatRename(chatId)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void commitChatRename(chatId)
                        if (e.key === "Escape") { e.stopPropagation(); renameCancelled.current = true; setRenamingChat(null) }
                      }}
                    />
                  ) : (
                    <div className="wb-inspector-kv">
                      <span>Titre</span>
                      <button
                        className="wb-link"
                        type="button"
                        disabled={!chatId}
                        onClick={() => chatId && startRenameChat(chatId)}
                        title="Renommer la conversation (F2)"
                        aria-label="Renommer la conversation"
                      >
                        {activeChat?.title || "Nouvelle conversation"}
                      </button>
                    </div>
                  )}
                </section>
                <section className="wb-inspector-section">
                  <span className="wb-label">AGENT</span>
                  <div className="wb-inspector-kv"><span>Nom</span><span>{agentName(tab) || "—"}</span></div>
                  <div className="wb-inspector-kv"><span>Modèle</span><span>{activeModelLabel}</span></div>
                  <select
                    className="wb-select"
                    aria-label="Modèle de la conversation"
                    value={currentModel ?? ""}
                    onChange={(e) => applyModelChoice(e.target.value || undefined)}
                  >
                    <option value="">Auto — le routeur choisit</option>
                    {modelChain.map((m) => <option key={m.ref} value={m.ref}>{m.label}</option>)}
                  </select>
                </section>
                {tab === "projet" && (
                  <section className="wb-inspector-section">
                    <span className="wb-label">DÉLÉGATION</span>
                    <div className="tasks-mode-switch" role="group" aria-label="Mode de l’orchestrateur">
                      {TASK_MODES_UI.map((m) => (
                        <button key={m.id} className={`button ${taskMode === m.id ? "primary" : "ghost"} tasks-mode-option`} onClick={() => changeTaskMode(m.id)} type="button" title={m.hint} aria-pressed={taskMode === m.id}>
                          <Icon name={m.icon} size={14} />{m.label}
                        </button>
                      ))}
                    </div>
                  </section>
                )}
                <section className="wb-inspector-section">
                  <span className="wb-label">ÉVÉNEMENTS</span>
                  <div className="wb-notice-list">
                    {notices.slice(-5).reverse().map((n) => <p key={n.id} className="wb-notice">{n.text}</p>)}
                    {!notices.length && <p className="wb-inspector-empty">Aucun événement de routage.</p>}
                  </div>
                </section>
                {lastAssistant && (
                  <section className="wb-inspector-section">
                    <span className="wb-label">DERNIÈRE RÉPONSE</span>
                    <div className="wb-inspector-actions">
                      <button className="button secondary" type="button" onClick={() => void composeIntoChat(lastAssistant.text)} title="Prépare la réponse dans le composeur, sans l’envoyer">Transmettre</button>
                      <button className="button ghost" type="button" onClick={() => void citeLast()} title="Crée une note citant la réponse">Citer</button>
                      <button className="button ghost" type="button" onClick={() => void navigator.clipboard.writeText(lastAssistant.text)}>Copier</button>
                    </div>
                  </section>
                )}
              </>
            ) : activeKind === "settings" ? (
              <nav className="wb-inspector-tabs" aria-label="Sections des réglages">
                {([["general", "Configuration"], ["appearance", "Apparence"], ["voice", "Agent vocal"], ["usage", "Usage"]] as const).map(([id, label]) => (
                  <button key={id} className="wb-inspector-tab" type="button" aria-selected={settingsSection === id} onClick={() => setSettingsSection(id)}>{label}</button>
                ))}
              </nav>
            ) : activeKind === "notes" ? (
              <>
                <section className="wb-inspector-section">
                  <span className="wb-label">ESPACE</span>
                  <div className="wb-inspector-kv"><span>Nom</span><span>{workspaceName || "—"}</span></div>
                  <p className="wb-inspector-empty">Les liens sortants et les rétroliens d’une note restent dans la colonne de lecture.</p>
                </section>
                <section className="wb-inspector-section">
                  <span className="wb-label">ACTIONS</span>
                  <div className="wb-inspector-actions">
                    <button className="button secondary" type="button" onClick={() => { setCaptureRequested(true); openNotesView() }}>Capture rapide</button>
                  </div>
                </section>
              </>
            ) : activeKind === "files" ? (
              <section className="wb-inspector-section">
                <span className="wb-label">LECTURE</span>
                <p className="wb-inspector-empty">Explorateur en lecture seule, cloisonné à la racine de l’espace. L’aperçu reste borné et l’analyse passe par le composeur.</p>
                <div className="wb-inspector-kv"><span>Espace</span><span>{workspaceName || "—"}</span></div>
              </section>
            ) : activeKind === "terminal" ? (
              <section className="wb-inspector-section">
                <span className="wb-label">SESSION PTY</span>
                <p className="wb-inspector-empty">Session indépendante des conversations. Fermer l’onglet n’arrête pas Freebuff ; « Redémarrer la session » vit dans l’instrument.</p>
              </section>
            ) : activeKind === "orchestration" && (
              <section className="wb-inspector-section">
                <span className="wb-label">MODE</span>
                <p className="wb-inspector-empty">Le mode choisi reste actif pour les prochaines demandes adressées à l’agent principal dans cet espace.</p>
              </section>
            )}
            {activeKind === "home" && (
              <>
                <section className="wb-inspector-section">
                  <span className="wb-label">POSTE</span>
                  <div className="wb-inspector-kv"><span>Espace</span><span>{workspaceName || "—"}</span></div>
                  <div className="wb-inspector-kv"><span>État</span><span>{engineStatusLabel(appState.status)}</span></div>
                  <div className="wb-inspector-kv"><span>Moteur</span><span>{appState.version || "—"}</span></div>
                  <div className="wb-inspector-kv"><span>Dictée</span><span>{appState.keys.groq ? "prête" : "clé Groq absente"}</span></div>
                </section>
                <section className="wb-inspector-section">
                  <span className="wb-label">ACTIONS</span>
                  <div className="wb-inspector-actions">
                    <button className="button secondary" type="button" onClick={() => openConfiguration(undefined, "appearance")}>Apparence</button>
                    <button className="button ghost" type="button" onClick={() => setCaptureRequested(true)}>Capture</button>
                  </div>
                </section>
              </>
            )}
          </div>
        </aside>

        {/* v12.6.0 : rendue seulement si on la demande — aucune bande permanente. */}
        {commandOpen && <CommandBar app={app} onDismiss={() => setCommandOpen(false)} />}

        {/* v12.0.0 : la poignée et l'arc sont ancrés sur le CORPS, jamais sur la
            fenêtre, qu'un bandeau d'état décale. v12.6.0 : plus de barre sous
            elle, donc plus d'offset à compenser. */}
        <NavigationConstellation
          destinations={DESTINATIONS}
          open={navOpen}
          leaving={leaving}
          activeKind={activeKind}
          onOpen={() => setNavOpen(true)}
          onClose={() => { setNavOpen(false); setLeaving(null) }}
          onSelect={selectDestination}
        />
      </div>

      {appState.needsWorkspace && (
        <div className="overlay">
          <div className="dialog workspace-picker" role="dialog" aria-modal="true" aria-label="Choisir un espace de travail">
            <span className="eyebrow">PREMIERS PAS</span>
            <h3>Choisis ton espace de travail</h3>
            <p className="hint">Un espace correspond à un dossier de projet. Aven y conserve ses conversations, agents et priorités ; les fichiers explorés restent limités à ce dossier.</p>
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

      {appState.status !== "ready" && !appState.needsWorkspace && (
        <div className="status-banner">
          <span className="status-dot warning" />
          {appState.status === "starting" ? "Démarrage d’Aven…" : <><b>Aven n’a pas démarré.</b> {appState.error}</>}
        </div>
      )}
      {showNoKeyBanner && (
        <div className="status-banner subtle"><span className="status-dot" /> Aucun fournisseur avec clé API n’est configuré. Les modèles sans clé restent disponibles.</div>
      )}

      {/* v12.0.0 : UN canvas pour tout le Poste. Il mesure l'ancre de l'état
          courant et se transforme entre les deux — même dessin, même identité. */}
      <div
        className="aven-agent-layer"
        data-motion={reducedMotion ? "instant" : "smooth"}
        style={agentPlacement
          ? { transform: `translate(${agentPlacement.x}px, ${agentPlacement.y}px) scale(${agentPlacement.scale})`, opacity: 1 }
          : { visibility: "hidden" }}
        aria-hidden="true"
      >
        <WireframeAgent phase={voice.phase} size={AGENT_CANVAS} />
      </div>

      {form && <FormDialog key={form.id} form={form} onSubmit={answerForm} onCancel={cancelForm} />}

      {selBar && (
        <div className="selbar" role="toolbar" aria-label="Actions sur la sélection" style={{ top: selBar.top, left: selBar.left }}>
          <button type="button" title="Copier la sélection" aria-label="Copier la sélection" onClick={() => { void navigator.clipboard.writeText(selBar.text); setSelBar(null) }}><Icon name="copy" size={15} /></button>
          <button type="button" title="Corriger ce code (agent code)" aria-label="Corriger ce code avec l’agent code" onClick={() => applySelection("fix")}><Icon name="wrench" size={15} /></button>
          <button type="button" title="Expliquer ce code (agent recherche)" aria-label="Expliquer ce code avec l’agent recherche" onClick={() => applySelection("explain")}><Icon name="wand" size={15} /></button>
          <button type="button" title="Faire relire ce code (agent code-reviewer)" aria-label="Faire relire ce code avec l’agent code-reviewer" onClick={() => applySelection("review")}><Icon name="eye" size={15} /></button>
          <button type="button" title="Citer dans le composeur" aria-label="Citer la sélection dans le composeur" onClick={() => applySelection("send")}><Icon name="quote" size={15} /></button>
          <button type="button" className="selbar-close" title="Fermer" aria-label="Fermer les actions de sélection" onClick={() => setSelBar(null)}><Icon name="close" size={15} /></button>
        </div>
      )}

      {ask && (
        <div className="overlay">
          <div className="dialog permission-dialog" role="dialog" aria-modal="true" aria-label="Autorisation demandée">
            <span className="eyebrow">AUTORISATION</span>
            <h3>L’agent demande l’autorisation</h3>
            <p className="permission-action"><b>{ask.action}</b></p>
            <pre>{ask.resources.join("\n")}</pre>
            {ask.message && <p>{ask.message}</p>}
            <div className="row end">
              <button type="button" className="button ghost" onClick={() => answer("reject")}>Refuser</button>
              <button type="button" className="button secondary" onClick={() => answer("once")}>Une fois</button>
              <button type="button" className="button primary" onClick={() => answer("always")}>Toujours</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
