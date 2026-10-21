import { api } from "../api"
import { Icon } from "../icons"
import FormDialog from "../FormDialog"
import SettingsDialog from "../SettingsDialog"
import NotesView from "../NotesView"
import FilesView from "../FilesView"
import FreebuffAgentPage from "../FreebuffAgentPage"
import type { AvenApp } from "./use-aven-app"
import { withViewTransition } from "./with-view-transition"
import HomePage from "../pages/HomePage"
import TasksPage from "../pages/TasksPage"
import ConversationPage from "../pages/ConversationPage"

// v10.4.0 : coquille de l'app — barre de fenêtre, bandeaux, choix d'espace, et
// aiguillage vers les pages. Aucune logique : le contrôleur décide, les pages rendent.
export default function AppShell({ app }: { app: AvenApp }) {
  const {
    answer,
    answerForm,
    appState,
    appearance,
    applySelection,
    cancelForm,
    captureRequested,
    closePage,
    composeIntoChat,
    error,
    fail,
    form,
    goHome,
    live,
    notesInitialId,
    openConfiguration,
    orderedAgents,
    resetAppearance,
    resetForWorkspace,
    selBar,
    setCaptureRequested,
    setSelBar,
    setSettingsFocus,
    setShowSettings,
    settingsFocus,
    settingsSection,
    showAgentsPage,
    showFiles,
    showFreebuffAgent,
    showHome,
    showNotes,
    showSettings,
    tab,
    updateAppearance,
  } = app

  const ask = live.asks[0]
  // v10.4.0 : une page a SON retour (« Fermer », dernier bouton de sa barre d'actions) ;
  // la barre de fenêtre ne garde donc « Accueil » que devant une conversation.
  const isPage = showNotes || showFiles || showSettings || showAgentsPage || showFreebuffAgent
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
          {/* v10.4.0 : plus de bouton « Paramètres » DANS les Réglages — la page
              affichait l'entrée de la page où l'on se trouvait déjà. */}
          {!showSettings && (
            <button
              className="window-tab"
              onClick={() => openConfiguration(undefined, "appearance")}
              aria-label="Ouvrir les paramètres d’apparence"
            >
              <span className="window-tab-icon"><Icon name="settings" size={14} /></span>
              <span>Paramètres</span>
            </button>
          )}
          {/* v10.3.0 : barre contextuelle — « Conversations » n'a de sens que devant
              une conversation ; les pages (Tâches, Projet, Notes, Fichiers, Réglages)
              portent leurs propres actions et ne montrent pas ce bouton. */}
          {!showHome && !showFreebuffAgent && !showAgentsPage && !showNotes && !showFiles && !showSettings && (
            // v10.2.2 : la gestion des conversations vivait derrière un réglage
            // d'apparence (barre masquée par défaut). Une entrée dédiée la rend
            // trouvable en un clic, sans fouiller les paramètres.
            <button className="window-tab" onClick={() => updateAppearance({ showSidebar: !appearance.showSidebar })} aria-label={appearance.showSidebar ? "Masquer la liste des conversations" : "Afficher la liste des conversations"} aria-pressed={appearance.showSidebar} title="Afficher ou masquer la liste des conversations">
              <span className="window-tab-icon"><Icon name="list" size={14} /></span>
              <span>Conversations</span>
            </button>
          )}
          {!showHome && (
            <>
              {/* Conversation uniquement : sur une page, deux boutons ramenaient au
                  même endroit (« Accueil » ici, « Fermer » dans la page). */}
              {!isPage && (
                <button className="window-tab" onClick={goHome} aria-label="Retour à l’accueil">
                  <span className="window-tab-icon"><Icon name="arrow-left" size={14} /></span>
                  <span>Accueil</span>
                </button>
              )}
            </>
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
              Un espace de travail correspond à un dossier de projet. Aven y conserve ses
              conversations, agents et priorités ; les fichiers explorés restent limités à
              ce dossier. Choisis un espace existant ou ouvre un dossier de projet existant.
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

      {/* v10.3.0 : Notes, Fichiers et Réglages sont des PAGES pleines (AGENTS.md §6).
          Quand l'une est ouverte, elle remplace la surface principale au lieu de la
          recouvrir — les blocs sont rendus plus bas et occupent tout le corps. */}
      {showNotes || showFiles || showSettings ? null : showHome ? (
        <main className="home-main"><HomePage app={app} /></main>
      ) : showFreebuffAgent ? (
        /* v9.5.0 : page pleine de l'agent Freebuff — même gabarit que la page Agents,
           PTY persistant (le boot de la session vit dans le composant). */
        <FreebuffAgentPage onError={fail} onClose={closePage} />
      ) : showAgentsPage ? (
        <TasksPage app={app} />
      ) : (
        <ConversationPage app={app} />
      )}

      {form && <FormDialog key={form.id} form={form} onSubmit={answerForm} onCancel={cancelForm} />}
      {/* v9.3.0 : vue Notes complète (rendu Markdown, édition, tags par agent, « joindre
          à la conversation ») — remplace l'ancien modal Notes de v8.x. */}
      {showNotes && (
        <NotesView
          autoCapture={captureRequested}
          onCaptureHandled={() => setCaptureRequested(false)}
          initialId={notesInitialId}
          agents={orderedAgents.map((a) => ({ id: a.id, name: a.name }))}
          currentAgent={tab}
          onCompose={(text) => void composeIntoChat(text)}
          onClose={closePage}
          onError={fail}
        />
      )}
      {/* v9.3.0 : explorateur de fichiers intégré — lecture seule, cloisonné à l'espace
          côté main (safeResolve) ; « Faire analyser par un agent » passe par le composeur. */}
      {showFiles && (
        <FilesView
          agents={orderedAgents.map((a) => ({ id: a.id, name: a.name }))}
          currentAgent={tab}
          onCompose={(text) => void composeIntoChat(text)}
          onClose={closePage}
          onError={fail}
        />
      )}


      {selBar && (
        <div className="selbar" role="toolbar" aria-label="Actions sur la sélection" style={{ top: selBar.top, left: selBar.left }}>
          <button type="button" title="Copier la sélection" aria-label="Copier la sélection" onClick={() => { void navigator.clipboard.writeText(selBar.text); setSelBar(null) }}><Icon name="copy" size={15} /></button>
          <button type="button" title="Corriger ce code (agent code)" aria-label="Corriger ce code avec l’agent code" onClick={() => applySelection("fix")}><Icon name="wrench" size={15} /></button>
          <button type="button" title="Expliquer ce code (agent recherche)" aria-label="Expliquer ce code avec l’agent recherche" onClick={() => applySelection("explain")}><Icon name="sparkle" size={15} /></button>
          <button type="button" title="Faire relire ce code (agent code-reviewer)" aria-label="Faire relire ce code avec l’agent code-reviewer" onClick={() => applySelection("review")}><Icon name="eye" size={15} /></button>
          <button type="button" title="Citer dans le composeur" aria-label="Citer la sélection dans le composeur" onClick={() => applySelection("send")}><Icon name="chevron-right" size={15} /></button>
          <button type="button" className="selbar-close" title="Fermer" aria-label="Fermer les actions de sélection" onClick={() => setSelBar(null)}><Icon name="close" size={15} /></button>
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
          onClose={() => { withViewTransition(() => setShowSettings(false)); setSettingsFocus(undefined) }} // v10.2.0 (M3) : fermeture en View Transition
          onError={fail}
          onAppStateChanged={resetForWorkspace}
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
