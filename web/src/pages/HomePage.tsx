import type { FormEvent } from "react"
import { api } from "../api"
import type { Chat } from "../types"
import { Icon, type IconName } from "../icons"
import { usableModelRef } from "../model-label"
import type { AvenApp } from "../app/use-aven-app"
import { withViewTransition } from "../app/with-view-transition"
import { FREEBUFF_MISSING_NOTICE } from "../app/constants"

// v10.4.0 : le hub d'accueil est une PAGE — son arbre JSX a quitté App.tsx. Il ne
// détient aucun état : tout vient du contrôleur, les actions restent celles du shell
// (mêmes cartes, mêmes routes vocales, même morph carte → page).
function HubIcon({ kind }: { kind: string }) {
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

export default function HomePage({ app }: { app: AvenApp }) {
  const {
    agentName,
    appState,
    arrowListNav,
    chats,
    conversationsListRef,
    dictation,
    dictationPointerRef,
    freebuffCliErrorRef,
    freebuffPillState,
    homeCommand,
    homeNotice,
    homeSearchRef,
    newChat,
    openAgentsPage,
    openConfiguration,
    openFilesView,
    openFreebuffAgent,
    openNotesView,
    recentListRef,
    releaseDictation,
    routeAppAction,
    setHomeCommand,
    setHomeNotice,
    setShowAgentsPage,
    setShowConversationPicker,
    setShowHome,
    showConversationPicker,
    tab,
    workspaceName,
  } = app

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
      { key: "files", label: "Fichiers", kind: "files", hint: "Explorer l'espace", action: () => openFilesView("files") },
      { key: "notes", label: "Notes", kind: "notes", hint: "Notes Markdown par agent", action: () => openNotesView(undefined, "notes") },
    ]
    // v10.2.2 : la barre promettait « chercher » mais ne filtrait rien (elle créait
    // seulement une conversation à la validation). Elle filtre désormais les
    // conversations par titre ; Entrée garde l'action « demander à l'agent ».
    const command = homeCommand.trim()
    const needle = command.toLowerCase()
    const recent = (needle
      ? chats.filter((c) => (c.title || "Conversation").toLowerCase().includes(needle))
      : chats
    ).slice(0, needle ? 6 : 3)
    const allConversations = chats
    const online = appState.status === "ready"

    // v9.1.6 : flèches Haut/Bas dans les listes du hub (fabrique SANS hook — voir
    // le fix « Rendered fewer hooks » ci-dessus ; la sélection est le focus DOM).
    const recentNav = arrowListNav(recentListRef)
    const conversationsNav = arrowListNav(conversationsListRef)

    // v10.4.0 : la page ne fait que déclencher les actions du contrôleur (même
    // parcours qu'avant : création si besoin, puis composeur).
    const submitHomeCommand = (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault()
      void app.submitHomeCommand(command)
    }
    const openConversation = (chat: Chat) => app.openHomeConversation(chat)

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
            <input ref={homeSearchRef} value={homeCommand} onChange={(e) => setHomeCommand(e.target.value)} placeholder="Chercher une conversation, ou demander…" aria-label="Chercher une conversation ou demander à l’agent" />
            <kbd>Ctrl K</kbd>
          </form>

          <div className="home-toolbar-actions">
            <span className={`home-status ${online ? "online" : ""}`} title={online ? "Aven est prêt" : appState.status === "starting" ? "Aven démarre" : "Aven est indisponible"}>
              <span className="status-dot" />
              <span>{online ? "En ligne" : appState.status === "starting" ? "Démarrage" : "Indisponible"}</span>
            </span>
            {/* v9.3.0 : pastille d'état Freebuff — le second assistant devient visible
                d'un coup d'œil (CLI installé ? session active ?). Clic = ouvrir le terminal. */}
            <button className={`freebuff-pill ${freebuffPillState}`} onClick={() => setHomeNotice(routeAppAction("open-freebuff"))} aria-label={`Freebuff : ${freebuffPillState === "active" ? "session active" : freebuffPillState === "ready" ? "CLI installé" : freebuffPillState === "installing" ? "installation du CLI en cours" : "CLI non installé"}`} title={freebuffPillState === "active" ? "Session Freebuff active — ouvrir le terminal" : freebuffPillState === "ready" ? "CLI Freebuff installé — ouvrir le terminal" : freebuffPillState === "installing" ? "Installation du CLI Freebuff en cours (au démarrage, sans bloquer l'app)" : freebuffCliErrorRef.current || "CLI Freebuff non installé — voir comment l'installer"} type="button">
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
                  <span className="eyebrow">{needle ? "RÉSULTATS" : "RÉCENTS"}</span>
                  <strong>{needle ? `${recent.length} conversation${recent.length > 1 ? "s" : ""}` : "Reprendre rapidement"}</strong>
                </div>
                <button className="button ghost home-text-button" onClick={() => setShowConversationPicker(true)} type="button">Tout voir</button>
              </div>
              {/* v9.1.6 : flèches Haut/Bas naviguent parmi les conversations récentes.
                  v9.3.0 : badge de l'agent propriétaire — le hub montre QUI possède chaque
                  conversation (cohérent avec la page Agents et le regroupement v9.0.0). */}
              <div className="home-recent-list" ref={recentListRef} onKeyDown={recentNav.onKeyDown}>
                {recent.map((chat) => (
                  <button key={chat.id} className="home-recent-item" onClick={() => openConversation(chat)} type="button" aria-label={`${chat.title || "Conversation"} — ${agentName(chat.agent || tab)}${usableModelRef(chat.model) ? ` · ${usableModelRef(chat.model)}` : ""}`}>
                    <span className="home-recent-icon"><HubIcon kind={chat.agent === tab ? "agent" : "notes"} /></span>
                    <span className="home-recent-copy">
                      <strong>{chat.title || "Conversation"}</strong>
                      <small><em className="home-recent-agent">{agentName(chat.agent || tab)}</em>{usableModelRef(chat.model) ? ` · ${usableModelRef(chat.model)}` : ""}</small>
                    </span>
                    <span className="home-recent-arrow"><Icon name="chevron-right" size={16} /></span>
                  </button>
                ))}
                {!recent.length && (
                  <button className="home-empty-recent" onClick={() => void newChat()} disabled={!tab} type="button">
                    <span>{needle ? "Aucune conversation ne correspond — Entrée crée une conversation sur ce sujet." : "Commencez une conversation pour la retrouver ici."}</span>
                  </button>
                )}
              </div>
              <button className="button primary home-recent-new" onClick={() => void newChat()} disabled={!tab} type="button">
                <Icon name="plus" size={14} />Nouvelle conversation
              </button>
            </aside>

            <div className="home-hub-stage">
              <section className="home-hub" aria-label="Navigation principale">
                {/* v10.3.2 : quadrillage et croix retirés (revue apple-design §4 P3) —
                    les trois orbites, les deux auras et l'anneau portent la constellation. */}
                <div className="hub-aura hub-aura-1" aria-hidden="true" />
                <div className="hub-aura hub-aura-2" aria-hidden="true" />
                <div className="hub-orbit hub-orbit-outer" aria-hidden="true" />
                <div className="hub-orbit hub-orbit-inner" aria-hidden="true" />
                <div className="hub-orbit hub-orbit-core" aria-hidden="true" />

                {nav.map((item, i) => (
                  <button key={item.key} className={`hub-card hub-card-${item.key}`} style={{ "--stagger-i": i } as React.CSSProperties} onClick={item.action} aria-label={`${item.label} — ${item.hint}`} type="button">
                    <span className="hub-card-icon"><HubIcon kind={item.kind} /></span>
                    <span className="hub-card-copy"><strong>{item.label}</strong><small>{item.hint}</small></span>
                  </button>
                ))}

                {/* Bouton central : dictée push-to-talk (retour du point focal du hub).
                    Maintenir pour parler, relâcher pour transcrire → le texte atterrit dans
                    le composeur de la conversation (créée si besoin) pour validation. */}
                {/* v10.3.1 : sans clé Groq, le micro est VRAIMENT inactif (attribut
                    `disabled` + état visuel + libellé de cause) — il restait saturé et
                    cliquable en promettant une action qu'il refusait (revue §4 P2). */}
                <button
                  className={`voice-core ${dictation.state === "recording" ? "dictation-recording" : ""}${dictation.paused ? " dictation-paused" : ""}`}
                  disabled={!appState.keys.groq}
                  title={appState.keys.groq ? "Maintiens pour dicter, relâche pour transcrire" : "Dicter — configure une clé Groq dans Paramètres"}
                  onPointerDown={(e) => {
                    e.preventDefault()
                    dictationPointerRef.current = true // v10.2.0 (F6) : doigt engagé sur le push-to-talk
                    if (dictation.state === "error") { dictation.resetError(); return }
                    // v10.4.0 : le hub déclare sa PROVENANCE au micro — une commande
                    // s'exécute ici même ; la conversation n'est créée qu'à l'arrivée
                    // d'un texte (plus de conversation vide par commande dictée).
                    if (dictation.state === "idle") void dictation.start("hub")
                  }}
                  onPointerUp={(e) => { e.preventDefault(); releaseDictation() }}
                  onPointerLeave={() => { if (dictationPointerRef.current && dictation.state === "recording") dictation.pause() }} // v10.2.0 (F6) : doigt sorti = pause
                  onPointerEnter={() => { if (dictationPointerRef.current && dictation.paused) dictation.resume() }} // v10.2.0 (F6) : doigt revenu = reprise
                  aria-label={appState.keys.groq ? "Dicter — maintiens le bouton, relâche pour transcrire" : "Dictée indisponible : configure une clé Groq dans Paramètres"}
                  type="button"
                >
                  <span className="voice-ring voice-ring-outer" aria-hidden="true" />
                  <span className="voice-ring voice-ring-inner" aria-hidden="true" />
                  <span className="voice-mic"><Icon name="microphone" size={30} /></span>
                  <span className="voice-core-label">
                    {dictation.state === "recording" ? (dictation.paused ? "En pause" : "J’écoute…") : dictation.state === "transcribing" ? "Transcription…" : appState.keys.groq ? "Dicter" : "Clé Groq requise"}
                  </span>
                </button>

                {homeNotice && (
                  <div className="home-notice" role="status">
                    <span>{homeNotice}</span>
                    {homeNotice === FREEBUFF_MISSING_NOTICE && (
                      <button
                        className="button primary home-notice-action"
                        type="button"
                        onClick={() => { api.freebuffCliEnsure(true).then((s) => { if (!s.installed) setHomeNotice(s.error ?? FREEBUFF_MISSING_NOTICE) }).catch((e) => setHomeNotice(e instanceof Error ? e.message : String(e))) }}
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
                <button className="button button-icon dialog-close" onClick={() => withViewTransition(() => setShowConversationPicker(false))} aria-label="Fermer" type="button"><Icon name="close" size={17} /></button>
              </div>
              {/* v9.1.6 : flèches Haut/Bas naviguent, Entrée ouvre la conversation focusée. */}
              <div className="home-modal-list" ref={conversationsListRef} onKeyDown={conversationsNav.onKeyDown}>
                {allConversations.map((chat) => (
                  <button key={chat.id} className="home-modal-item" onClick={() => openConversation(chat)} type="button">
                    <span className="home-recent-icon"><HubIcon kind="notes" /></span>
                    <span className="home-recent-copy"><strong>{chat.title || "Conversation"}</strong><small>{usableModelRef(chat.model) || agentName(chat.agent || tab)}{chat.updated ? ` · ${new Date(chat.updated).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}` : ""}</small></span>
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
