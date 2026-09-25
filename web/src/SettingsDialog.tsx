import { useEffect, useState, type CSSProperties } from "react"
import { api } from "./api"
import { Icon } from "./icons"
import type { Agent, AppState } from "./types"
import type { AppearanceConfig, BlockId } from "./appearance"

const SYNC_LABEL: Record<string, string> = {
  created: "créé",
  updated: "mis à jour automatiquement (tu ne l’avais pas modifié)",
  unchanged: "à jour",
  custom: "personnalisé — laissé tel quel",
}

type Section = "general" | "appearance"

export default function SettingsDialog(props: {
  state: AppState
  appearance: AppearanceConfig
  agents: Agent[]
  initialSection: Section
  // Vrai quand l'appelant veut atterrir directement sur la gestion des espaces de
  // travail (carte "Projets" du hub d'accueil) plutôt qu'en haut du panneau général.
  focusWorkspaces?: boolean
  onAppearanceChange: (patch: Partial<AppearanceConfig>) => void
  onAppearanceReset: () => void
  onClose: () => void
  onError: (e: unknown) => void
  // L'état a changé côté main (nouvelle clé, espace actif différent) : l'App se met à jour.
  onAppStateChanged: (state: AppState) => void
}) {
  const { state, appearance } = props
  const [section, setSection] = useState<Section>(props.initialSection)

  useEffect(() => {
    if (!props.focusWorkspaces || section !== "general") return
    const id = requestAnimationFrame(() => document.getElementById("workspaces-section")?.scrollIntoView({ behavior: "smooth", block: "start" }))
    return () => cancelAnimationFrame(id)
    // Ne dépend volontairement que du déclencheur initial : on ne veut pas re-scroller
    // à chaque changement d'onglet une fois le panneau ouvert.
  }, [props.focusWorkspaces])
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [newWsName, setNewWsName] = useState("")
  const [updateMsg, setUpdateMsg] = useState<string>()
  const [busy, setBusy] = useState(false)

  // Rafraîchissement propre après une action qui redémarre le moteur (clé enregistrée,
  // changement d'espace) : on relit l'état via IPC au lieu de window.location.reload(),
  // qui perdait tout l'état visuel (position, saisie en cours, conversation ouverte).
  // L'App parente est prévenue via props.onAppStateChanged pour vider conversation et agent.
  const refreshAfterRestart = async () => {
    const next = await api.state()
    props.onAppStateChanged(next)
  }
  const [draggedBlock, setDraggedBlock] = useState<BlockId | null>(null)
  const [draggedAgent, setDraggedAgent] = useState<string | null>(null)

  const save = async (provider: string, key: string) => {
    setBusy(true)
    try {
      const next = await api.setKey(provider, key)
      setInputs((i) => ({ ...i, [provider]: "" }))
      props.onAppStateChanged(next)
    } catch (e) {
      props.onError(e)
    } finally {
      setBusy(false)
    }
  }
  const switchWs = async (_dir: string) => {
    setBusy(true)
    try { await refreshAfterRestart() } catch (e) { props.onError(e) } finally { setBusy(false) }
  }
  const addExistingWs = async () => {
    setBusy(true)
    try { const res = await api.addExistingWorkspace(); if (res) await refreshAfterRestart() } catch (e) { props.onError(e) } finally { setBusy(false) }
  }
  const createWs = async () => {
    setBusy(true)
    try { const res = await api.createWorkspace(newWsName); if (res) { setNewWsName(""); await refreshAfterRestart() } } catch (e) { props.onError(e) } finally { setBusy(false) }
  }
  const removeWs = async (dir: string) => {
    setBusy(true)
    try { await api.removeWorkspace(dir); await refreshAfterRestart() } catch (e) { props.onError(e) } finally { setBusy(false) }
  }
  const checkUpdates = async () => { setUpdateMsg("Vérification…"); const res = await api.checkForUpdates(); setUpdateMsg(res.message) }

  const moveBlock = (fromId: BlockId, targetId: BlockId) => {
    if (!fromId || fromId === targetId) return
    const order = [...appearance.mainOrder]
    const from = order.indexOf(fromId)
    const to = order.indexOf(targetId)
    if (from < 0 || to < 0) return
    order.splice(to, 0, order.splice(from, 1)[0])
    props.onAppearanceChange({ mainOrder: order })
  }
  const moveAgent = (fromId: string, targetId: string) => {
    if (!fromId || fromId === targetId) return
    const order = [...props.agents].map((a) => a.id)
    const current = appearance.agentOrder.length ? [...appearance.agentOrder, ...order.filter((id) => !appearance.agentOrder.includes(id))] : order
    const from = current.indexOf(fromId)
    const to = current.indexOf(targetId)
    if (from < 0 || to < 0) return
    current.splice(to, 0, current.splice(from, 1)[0])
    props.onAppearanceChange({ agentOrder: current })
  }

  const accentChoices = [
    ["violet", "Violet", "#8b5cf6"],
    ["blue", "Bleu", "#3b82f6"],
    ["emerald", "Émeraude", "#10b981"],
    ["rose", "Rose", "#f43f5e"],
    ["amber", "Ambre", "#f59e0b"],
  ] as const

  const renderAppearance = () => (
    <div className="settings-pane settings-pane-appearance">
      <section className="settings-section">
        <div className="section-title">Thème</div>
        <div className="segmented">
          {(["light", "system", "dark"] as const).map((value) => <button key={value} className={appearance.theme === value ? "selected" : ""} onClick={() => props.onAppearanceChange({ theme: value })}>{value === "light" ? "Clair" : value === "dark" ? "Sombre" : "Système"}</button>)}
        </div>
      </section>
      <section className="settings-section">
        <div className="section-title">Accent</div>
        <div className="accent-grid">
          {accentChoices.map(([key, label, color]) => <button key={key} className={`accent-choice ${appearance.accent === key ? "selected" : ""}`} onClick={() => props.onAppearanceChange({ accent: key })}><span className="accent-dot" style={{ background: color, color }} /><span>{label}</span></button>)}
          <label className={`accent-choice accent-custom ${appearance.accent === "custom" ? "selected" : ""}`}><span className="accent-dot" style={{ background: appearance.customAccent, color: appearance.customAccent }} /><span>Personnalisée</span><input type="color" value={appearance.customAccent} onChange={(e) => props.onAppearanceChange({ accent: "custom", customAccent: e.target.value })} /></label>
        </div>
      </section>
      <section className="settings-section">
        <div className="setting-row"><span>Densité</span><select value={appearance.density} onChange={(e) => props.onAppearanceChange({ density: e.target.value as AppearanceConfig["density"] })}><option value="comfortable">Confortable</option><option value="compact">Compacte</option></select></div>
        <div className="setting-row"><span>Position de la barre latérale</span><select value={appearance.sidebarPosition} onChange={(e) => props.onAppearanceChange({ sidebarPosition: e.target.value as AppearanceConfig["sidebarPosition"] })}><option value="left">Gauche</option><option value="right">Droite</option></select></div>
        <div className="setting-row slider-row"><span>Largeur de la barre latérale <b>{appearance.sidebarWidth}px</b></span><div className="range-control"><input type="range" min={240} max={420} step={2} value={appearance.sidebarWidth} style={{ "--range-progress": `${((appearance.sidebarWidth - 240) / 180) * 100}%` } as CSSProperties} onChange={(e) => props.onAppearanceChange({ sidebarWidth: Number(e.target.value) })} /></div></div>
        <div className="setting-row slider-row"><span>Largeur des messages <b>{appearance.messageWidth}px</b></span><div className="range-control"><input type="range" min={560} max={1100} step={10} value={appearance.messageWidth} style={{ "--range-progress": `${((appearance.messageWidth - 560) / 540) * 100}%` } as CSSProperties} onChange={(e) => props.onAppearanceChange({ messageWidth: Number(e.target.value) })} /></div></div>
      </section>
      <section className="settings-section">
        <div className="section-title">Éléments de l’interface</div>
        {([ ["showTabs", "Barre des agents"], ["showSidebar", "Conversations"], ["showModel", "Modèle actif"], ["showNotices", "Événements modèle"], ["showToolActivity", "Activité des outils"], ["showComposer", "Éditeur de message"] ] as const).map(([key, label]) => <label key={key} className="toggle-row"><span>{label}</span><input type="checkbox" checked={appearance[key]} onChange={(e) => props.onAppearanceChange({ [key]: e.target.checked })} /></label>)}
        <label className="toggle-row"><span>Grouper les conversations par agent</span><input type="checkbox" checked={appearance.chatsGroupedByAgent} onChange={(e) => props.onAppearanceChange({ chatsGroupedByAgent: e.target.checked })} /></label>
      </section>
      <section className="settings-section">
        <div className="section-title">Annonce vocale</div>
        <p className="section-hint">Annonce à voix haute (voix Windows, hors ligne) les moments clés des agents : permission demandée, tour terminé, bascule de modèle. Jamais le contenu des réponses. La voix se coupe automatiquement quand tu tapes.</p>
        <label className="toggle-row"><span>Annoncer les événements des agents</span><input type="checkbox" checked={appearance.voiceAnnouncements} onChange={(e) => props.onAppearanceChange({ voiceAnnouncements: e.target.checked })} /></label>
        <button className="button secondary" type="button" onClick={() => { api.announcerTest("Annonce vocale activée. Les événements des agents seront annoncés.").catch((e) => props.onError(e)) }}>Tester la voix</button>
      </section>
      <section className="settings-section">
        <div className="section-title">Ordre des blocs</div>
        <p className="section-hint">Réorganise les éléments de la conversation par glisser-déposer.</p>
        <div className="sortable-list">
          {appearance.mainOrder.map((id) => {
            const labels: Record<BlockId, string> = { messages: "Messages", notices: "Événements modèle", model: "Modèle actif", composer: "Éditeur de message" }
            return <div key={id} className={`sortable-item ${draggedBlock === id ? "is-dragged" : ""}`} draggable onDragStart={(e) => { setDraggedBlock(id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", id) }} onDragEnd={() => setDraggedBlock(null)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { moveBlock(e.dataTransfer.getData("text/plain") as BlockId, id); setDraggedBlock(null) }}><span className="drag-handle"><Icon name="grip" size={16} /></span><span><b>{labels[id]}</b><small>{id}</small></span></div>
          })}
        </div>
      </section>
      <section className="settings-section">
        <div className="section-title">Ordre des agents</div>
        <p className="section-hint">Les identifiants restent inchangés : seul l’ordre d’affichage est modifié.</p>
        <div className="sortable-list">
          {props.agents.map((agent) => <div key={agent.id} className={`sortable-item ${draggedAgent === agent.id ? "is-dragged" : ""}`} draggable onDragStart={(e) => { setDraggedAgent(agent.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", agent.id) }} onDragEnd={() => setDraggedAgent(null)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { moveAgent(e.dataTransfer.getData("text/plain"), agent.id); setDraggedAgent(null) }}><span className="drag-handle"><Icon name="grip" size={16} /></span><span><b>{agent.name}</b><small>{agent.description || agent.id}</small></span></div>)}
        </div>
      </section>
      <footer className="drawer-footer"><button className="button ghost" onClick={props.onAppearanceReset}>Réinitialiser</button><button className="button primary" onClick={props.onClose}>Terminé</button></footer>
    </div>
  )

  const renderGeneral = () => (
    <div className="settings-pane">
      <h4>Clés API</h4>
      <p className="hint">Les modèles texte payants sont désactivés. OpenRouter Free est optionnel, Groq sert à la dictée vocale, et Freebuff / Codebuff peut être activé comme backend externe. Les clés sont chiffrées par le système et ne quittent jamais l’application.</p>
      {state.providers.map((p) => <div key={p.id} className="field"><b>{p.label} {state.keys[p.id] && <span className="key-status"><Icon name="check" size={12} />clé enregistrée</span>}</b><span className="hint">{p.note}</span>{state.keyWarnings?.[p.id] && <span className="err">{state.keyWarnings[p.id]}</span>}<div className="row"><input className="settings-input" type="password" placeholder={state.keys[p.id] ? "Remplacer la clé…" : "Coller la clé…"} value={inputs[p.id] ?? ""} onChange={(e) => setInputs((i) => ({ ...i, [p.id]: e.target.value }))} /><button className="button primary" disabled={!inputs[p.id]?.trim()} onClick={() => save(p.id, inputs[p.id])}>Enregistrer</button>{state.keys[p.id] && <button className="button danger" onClick={() => save(p.id, "")}>Effacer</button>}<button className="button secondary" onClick={() => api.openExternal(p.url)}>Obtenir une clé</button></div></div>)}
      <div className="settings-callout"><b>Modèles Aven gratuits uniquement</b><span><code>OpenRouter Free</code> fournit des modèles gratuits pour les agents, <code>Groq</code> alimente la dictée vocale (maintiens le bouton micro ou Ctrl+Maj+V ; le texte arrive dans le composeur, à relire avant d’envoyer), et <code>Freebuff / Codebuff SDK</code> est un backend séparé, optionnel, qui nécessite une clé Codebuff et peut consommer des crédits : il ne remplace pas le client Freebuff gratuit.</span></div>
      <label className="toggle-row"><span>Freebuff par défaut sur l’agent code</span><input type="checkbox" checked={appearance.freebuffDefaultCode} onChange={(e) => props.onAppearanceChange({ freebuffDefaultCode: e.target.checked })} /></label>
      <p className="hint">S’applique uniquement si une clé Codebuff est enregistrée et seulement à l’agent code — les autres agents restent sur les modèles gratuits. Le bouton « Freebuff » du composeur force ou désactive le backend pour la conversation en cours.</p>
      <h4>Priorité des modèles par agent</h4>
      <p className="hint">Chaque agent reçoit explicitement le premier modèle disponible de sa chaîne de priorité. Si ce modèle est temporairement indisponible, le routeur passe au suivant et la session est mise à jour.</p>
      {state.warning && <p className="err">Table de priorités : {state.warning}</p>}
      {!!state.newModels?.length && <p className="hint">Nouveaux modèles ajoutés automatiquement à ta table de priorités : {state.newModels.join(", ")}.</p>}
      {!!state.removedModels?.length && <p className="hint">Modèles payants retirés de cet espace : {state.removedModels.join(", ")}.</p>}
      {Object.entries(state.assignments ?? {}).map(([agent, chain]) => <p key={agent} className="hint"><b>{agent}</b> : {chain.length ? chain.slice(0, 5).map((m, i) => `${i + 1}. ${m.label}`).join("  →  ") + (chain.length > 5 ? `  (+${chain.length - 5})` : "") : "aucun modèle disponible"}</p>)}
      <h4 id="workspaces-section">Espaces de travail</h4>
      <p className="hint">Chaque espace a ses propres conversations, agents et priorités. Les clés API sont partagées entre tous.</p>
      {(state.workspaces ?? []).map((w) => <div key={w.path} className="row"><span style={{ flex: 1 }}>{w.path === state.workspace ? <b className="current-workspace"><Icon name="dot" size={10} />{w.name}</b> : w.name} <span className="hint">{w.path}</span></span>{w.path !== state.workspace && <button className="button secondary" disabled={busy} onClick={() => switchWs(w.path)}>Utiliser</button>}{w.path !== state.workspace && (state.workspaces?.length ?? 0) > 1 && <button className="button danger" disabled={busy} onClick={() => removeWs(w.path)}>Retirer de la liste</button>}</div>)}
      <div className="row"><input className="settings-input" placeholder="Nom du nouvel espace…" value={newWsName} onChange={(e) => setNewWsName(e.target.value)} /><button className="button primary" onClick={createWs}>Créer un nouvel espace</button><button className="button secondary" onClick={addExistingWs}>Ouvrir un dossier existant</button></div>
      {!!state.sync?.length && <><h4>Fichiers de config du dossier de travail</h4>{state.sync.map((s) => <p key={s.file} className="hint"><code>{s.file}</code> : {SYNC_LABEL[s.status] ?? s.status}</p>)}</>}
      {state.versionWarning && <p className="err">{state.versionWarning}</p>}
      <p className="hint">OpenCode {state.version ?? "?"} · CLI : {state.cli ?? "?"}<br />Dossier de travail actif : {state.workspace ?? "?"}</p>
      <div className="row"><button className="button secondary" onClick={() => api.openWorkspace()}>Ouvrir le dossier</button>{state.updatesConfigured ? <button className="button secondary" onClick={checkUpdates}>Vérifier les mises à jour</button> : <span className="hint">Mise à jour automatique non configurée (définis <code>build.publish.owner/repo</code>).</span>}{updateMsg && <span className="hint">{updateMsg}</span>}</div>
      <div className="row"><button className="button ghost" onClick={props.onClose}>Fermer</button></div>
    </div>
  )

  return <div className="overlay"><div className="dialog wide unified-settings"><header className="unified-settings-header"><div><span className="eyebrow">RÉGLAGES</span><h3>Configuration et apparence</h3><p className="hint">Un seul panneau commun pour les réglages techniques et l’apparence de l’application.</p></div><button className="button button-icon dialog-close" onClick={props.onClose} aria-label="Fermer" type="button"><Icon name="close" size={17} /></button></header><nav className="settings-tabs" aria-label="Sections des paramètres"><button className={section === "general" ? "selected" : ""} onClick={() => setSection("general")}>Configuration</button><button className={section === "appearance" ? "selected" : ""} onClick={() => setSection("appearance")}>Apparence</button></nav><div className="unified-settings-scroll">{section === "appearance" ? renderAppearance() : renderGeneral()}</div></div></div>
}
