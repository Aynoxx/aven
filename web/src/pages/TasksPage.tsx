import PageShell from "../PageShell"
import { api } from "../api"
import { Icon } from "../icons"
import { TASK_MODES_UI } from "../app/constants"
import type { AvenApp } from "../app/use-aven-app"

// v10.4.0 : la page Tâches (orchestrateur + modes) est un module de page. Le retry
// des agents reste un handler du contrôleur ; la page ne connaît que son contrat.
export default function TasksPage({ app }: { app: AvenApp }) {
  const {
    agentName,
    agents,
    agentsError,
    agentsLoading,
    changeTaskMode,
    closePage,
    selectAgent,
    setAgents,
    setAgentsError,
    setAgentsLoading,
    setTab,
    taskMode,
  } = app

  return (
        <PageShell
          eyebrow="TÂCHES"
          title="Un agent principal, des modes par besoin"
          description="Choisis un mode : l’orchestrateur délègue aux spécialistes du domaine et synthétise."
          toolbarLabel="Actions des tâches"
          actions={[
            {
              key: "open",
              label: "Ouvrir la conversation",
              icon: "agent",
              variant: "primary",
              onClick: () => selectAgent("projet"),
              disabled: !agents.some((a) => a.id === "projet"),
              title: "Ouvre la conversation la plus récente de l’orchestrateur (une nouvelle seulement s’il n’en existe aucune), avec le mode choisi",
            },
            // v10.4.0 : une page porte SON retour — la barre de fenêtre ne double plus
            // ce bouton par « Accueil » (deux affordances pour la même sortie).
            { key: "close", label: "Fermer", icon: "close", variant: "ghost", onClick: closePage, className: "dialog-close", title: "Revenir à l'écran précédent (Échap)" },
          ]}
          className="agents-main"
          bodyClassName="agents-page tasks-page"
        >
            {/* v9.6.0 : l’orchestrateur « projet » est l’AGENT PRINCIPAL ; le mode
                « Tâche complexe » l’ouvre directement, les modes simples pointent les
                spécialistes (code / analyse / recherche). */}
            {/* v10.1.0 : UNE carte orchestrateur + switch de mode (Auto par défaut). */}
            <div className="tasks-principal">
              <article className={`agent-card tasks-principal-card ${agents.some((a) => a.id === "projet") ? "agent-card-orchestrator" : "tasks-card-off"}`}>
                <div className="agent-card-icon"><Icon name="sparkle" size={24} /></div>
                <div className="agent-card-body">
                  <span className="agent-card-id">projet <em className="orchestrator-badge">agent principal</em></span>
                  <h2>{agentName("projet")}</h2>
                  <p>Comprend la demande, la découpe, délègue aux spécialistes, puis synthétise.</p>
                  <div className="tasks-mode-switch" role="group" aria-label="Mode de l'orchestrateur">
                    {TASK_MODES_UI.map((m) => (
                      <button key={m.id} className={`button ${taskMode === m.id ? "primary" : "ghost"} tasks-mode-option`} onClick={() => changeTaskMode(m.id)} type="button" title={m.hint} aria-pressed={taskMode === m.id}>
                        <Icon name={m.icon} size={13} />{m.label}
                      </button>
                    ))}
                  </div>
                  <p className="hint tasks-mode-hint">{TASK_MODES_UI.find((m) => m.id === taskMode)?.hint}</p>
                </div>
              </article>
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
            {/* v10.2.0 (M11) : la page Tâches dit ce qu'elle contient quand elle est vide. */}
            {!agentsLoading && !agentsError && !agents.length && (
              <div className="tasks-empty">
                <strong>Aucun agent disponible.</strong> Les spécialistes apparaîtront ici dès leur installation. En attendant, ouvre une conversation avec l'agent principal : il découpe la demande, délègue aux spécialistes puis synthétise.
              </div>
            )}
        </PageShell>
  )
}
