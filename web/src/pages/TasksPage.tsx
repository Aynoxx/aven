import InstrumentFrame from "../InstrumentFrame"
import { api } from "../api"
import { Icon } from "../icons"
import { TASK_MODES_UI } from "../app/constants"
import type { AvenApp } from "../app/use-aven-app"

// v10.5.0 : la page Orchestration explique la portée persistante du mode de délégation.
export default function TasksPage({ app }: { app: AvenApp }) {
  const {
    agents,
    agentsError,
    agentsLoading,
    changeTaskMode,
    selectAgent,
    setAgents,
    setAgentsError,
    setAgentsLoading,
    setTab,
    taskMode,
  } = app

  return (
        <InstrumentFrame
          compact
          eyebrow="ORCHESTRATION"
          title="Modes de délégation de l’agent principal"
          description="Choisis comment l’agent principal traite les prochaines demandes dans cet espace de travail."
          toolbarLabel="Actions d’orchestration"
          actions={[
            {
              key: "open",
              label: "Ouvrir l’agent principal",
              icon: "agent",
              variant: "primary",
              onClick: () => selectAgent("projet"),
              disabled: !agents.some((a) => a.id === "projet"),
              title: "Ouvre la conversation de l’agent principal avec le mode de délégation actif",
            },
          ]}
          className="agents-main"
          bodyClassName="agents-page tasks-page"
        >
            {/* v10.5.0 : l'identifiant interne « projet » n'est pas exposé comme concept produit. */}
            {/* v10.1.0 : UNE carte orchestrateur + switch de mode (Auto par défaut). */}
            <div className="tasks-principal">
              <article className={`agent-card tasks-principal-card ${agents.some((a) => a.id === "projet") ? "agent-card-orchestrator" : "tasks-card-off"}`}>
                <div className="agent-card-icon"><Icon name="agent" size={24} /></div>
                <div className="agent-card-body">
                  <span className="agent-card-id"><em className="orchestrator-badge">Agent principal · délégation</em></span>
                  <h2>Aven · agent principal</h2>
                  <p>Comprend la demande, la découpe, délègue aux spécialistes, puis synthétise leur travail. Pour utiliser directement un spécialiste, ouvre une conversation dédiée à cet agent.</p>
                  <div className="tasks-mode-switch" role="group" aria-label="Mode de l'orchestrateur">
                    {TASK_MODES_UI.map((m) => (
                      <button key={m.id} className={`button ${taskMode === m.id ? "primary" : "ghost"} tasks-mode-option`} onClick={() => changeTaskMode(m.id)} type="button" title={m.hint} aria-pressed={taskMode === m.id}>
                        <Icon name={m.icon} size={14} />{m.label}
                      </button>
                    ))}
                  </div>
                  <p className="hint tasks-mode-hint">{TASK_MODES_UI.find((m) => m.id === taskMode)?.hint} Ce choix reste actif pour les prochaines demandes adressées à l’agent principal dans cet espace ; il ne remplace pas le choix d’un agent spécialisé dans une conversation dédiée.</p>
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
        </InstrumentFrame>
  )
}
