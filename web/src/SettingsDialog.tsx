import { useEffect, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { api } from "./api"
import { Icon } from "./icons"
import InstrumentFrame from "./InstrumentFrame"
import type { Agent, AppState, AggregatedStats, FreebuffCliStatus, VoiceAgentPrefs, VoiceCloneStatus } from "./types"
import type { AppearanceConfig, BlockId } from "./appearance"
import { displayPath } from "./display-path"
// v11.1.0 : agent vocal — libellés miroir de host/voice-agent-personality.ts.
import { VOICE_PERSONALITY_OPTIONS } from "./voice-agent/personalities"
// v11.3.0 : voix neuronales (Edge) et lecture du MP3 dans la webview.
import { playVoiceSpeech } from "./voice-agent/playback"
// v11.11.0 : POCKET_CLONE_TERMS_URL — la page du modèle de clonage, citée par les
// Réglages (miroir commenté de host/pocket-tts.ts).
import { POCKET_CLONE_TERMS_URL, voiceIdOf, voiceLabel } from "./voice-agent/voices"

const SYNC_LABEL: Record<string, string> = {
  created: "créé",
  updated: "mis à jour automatiquement (tu ne l’avais pas modifié)",
  unchanged: "à jour",
  custom: "personnalisé — laissé tel quel",
}

// v9.3.0 : 3 sections — Configuration | Apparence | Usage.
// v11.0.0 : la navigation des sections vit dans l'inspecteur du Poste ; ce composant
// rend la section reçue, sans onglets internes.
// v11.1.0 : « voice » — voix Windows, personnalité et micro de l'agent vocal.
export type SettingsSection = "general" | "appearance" | "usage" | "voice"

export default function SettingsDialog(props: {
  state: AppState
  appearance: AppearanceConfig
  agents: Agent[]
  section: SettingsSection
  onSectionChange: (section: SettingsSection) => void
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
  const { state, appearance, section } = props

  useEffect(() => {
    if (!props.focusWorkspaces || section !== "general") return
    const id = requestAnimationFrame(() => document.getElementById("workspaces-section")?.scrollIntoView({ behavior: "smooth", block: "start" }))
    return () => cancelAnimationFrame(id)
    // Ne dépend volontairement que du déclencheur initial : on ne veut pas re-scroller
    // à chaque changement d'onglet une fois le panneau ouvert.
  }, [props.focusWorkspaces])
  const [inputs, setInputs] = useState<Record<string, string>>({})
  const [newWsName, setNewWsName] = useState("")
  const [busy, setBusy] = useState(false)
  const [diagnosticMsg, setDiagnosticMsg] = useState<string>()
  const [notifications, setNotifications] = useState<boolean | null>(null) // null = pas encore chargé
  useEffect(() => { api.prefs().then((p) => setNotifications(p.notifications)).catch(() => setNotifications(true)) }, [])
  // CLI Freebuff gratuit (v9.1.2) : statut chargé une fois, actions visibles.
  const [cli, setCli] = useState<FreebuffCliStatus | null>(null)
  // v9.1.4 : l'installation est visible — bouton « Installation en cours… » pendant le poll.
  const [cliInstalling, setCliInstalling] = useState(false)
  useEffect(() => { api.freebuffCliStatus().then(setCli).catch(() => setCli({ installed: false })) }, [])
  // v9.3.0 : onglet Usage — statistiques rechargées à chaque ouverture de l'onglet.
  const [stats, setStats] = useState<AggregatedStats | null>(null)
  useEffect(() => {
    if (section !== "usage") return
    api.getStats().then(setStats).catch((e) => props.onError(e))
  }, [section, props.onError])
  // v11.1.0 : agent vocal — préférences et voix Windows chargées à l'ouverture
  // de la section. Les préférences sont enregistrées par le host (prefs.json).
  const [voicePrefs, setVoicePrefs] = useState<VoiceAgentPrefs | null>(null)
  const [voiceNames, setVoiceNames] = useState<string[]>([])
  const [voicePreviewing, setVoicePreviewing] = useState(false)
  // v11.11.0 : clonage de voix — l'état vient du host (moteur présent, modèle de
  // clonage téléchargé, profil posé, jeton enregistré), jamais d'une supposition.
  const [cloneStatus, setCloneStatus] = useState<VoiceCloneStatus | null>(null)
  const [cloneBusy, setCloneBusy] = useState(false)
  const [cloneMessage, setCloneMessage] = useState("")
  const [cloneToken, setCloneToken] = useState("")
  useEffect(() => {
    if (section !== "voice") return
    api.voiceAgentPrefs().then(setVoicePrefs).catch((e) => props.onError(e))
    api.voiceAgentVoices().then(setVoiceNames).catch(() => setVoiceNames([]))
    api.voiceCloneStatus().then(setCloneStatus).catch(() => setCloneStatus(null))
  }, [section, props.onError])
  const saveVoicePrefs = async (patch: { voiceName?: string; personality?: VoiceAgentPrefs["personality"]; micMuted?: boolean }) => {
    try { setVoicePrefs(await api.setVoiceAgentPrefs(patch)) } catch (e) { props.onError(e) }
  }
  const previewVoice = async () => {
    setVoicePreviewing(true)
    try {
      // v11.3.0 : l'aperçu emprunte le même chemin que la lecture réelle. Une voix
      // neuronale rend un MP3 que la webview joue ici même.
      const speech = await api.voiceAgentPreview("Bonjour, je suis l'agent vocal d'Aven. Voici ma voix.", voicePrefs?.voiceName)
      await playVoiceSpeech(speech)
    } catch (e) { props.onError(e) } finally { setVoicePreviewing(false) }
  }
  // v11.11.0 : le clonage se fait dans l'app : elle télécharge elle-même le modèle
  // de clonage dans ses données et le moteur pose le profil. Rien n'est envoyé sur
  // Internet (le moteur est local), et le profil ne part jamais avec l'installeur.
  const cloneVoice = async () => {
    setCloneBusy(true)
    setCloneMessage("")
    try {
      const result = await api.voiceCloneFromAudio()
      // Dialogue annulé : aucune promesse à tenir, aucun message à afficher.
      if (!result) return
      setVoiceNames(await api.voiceAgentVoices().catch(() => voiceNames))
      setVoicePrefs(await api.voiceAgentPrefs().catch(() => voicePrefs))
      setCloneStatus(await api.voiceCloneStatus().catch(() => cloneStatus))
      setCloneMessage(
        result.downloaded
          ? "Voix clonée créée, après téléchargement du modèle de clonage (209 Mo, une seule fois). Elle est maintenant la voix de l'agent — « Tester la voix » pour l'entendre."
          : "Voix clonée créée. Elle est maintenant la voix de l'agent — « Tester la voix » pour l'entendre.",
      )
    } catch (e) {
      props.onError(e)
    } finally {
      setCloneBusy(false)
    }
  }
  const removeClone = async () => {
    try {
      await api.voiceCloneRemove()
      setVoiceNames(await api.voiceAgentVoices().catch(() => voiceNames))
      setVoicePrefs(await api.voiceAgentPrefs().catch(() => voicePrefs))
      setCloneStatus(await api.voiceCloneStatus().catch(() => cloneStatus))
      setCloneMessage("Voix clonée retirée : la voix intégrée du moteur reprend la main.")
    } catch (e) {
      props.onError(e)
    }
  }
  const saveCloneToken = async () => {
    try {
      const saved = await api.setVoiceCloneToken(cloneToken)
      setCloneToken("")
      setCloneStatus(await api.voiceCloneStatus().catch(() => cloneStatus))
      setCloneMessage(saved.token ? "Jeton enregistré." : "Jeton effacé.")
    } catch (e) {
      props.onError(e)
    }
  }
  const cliAction = async (action: "launch" | "login" | "install") => {
    try {
      if (action === "install") {
        setCliInstalling(true)
        try {
          // v10.3.0 : installation par le gestionnaire unique (idempotent, vérifiée).
          // La boucle de sondage locale a disparu : `ensure` ne résout qu'une fois
          // l'installation terminée ET « freebuff --version » confirmé.
          const status = await api.freebuffCliEnsure(true)
          setCli({ installed: status.installed, version: status.version, state: status.state, cliError: status.error })
        } finally {
          setCliInstalling(false)
        }
      } else {
        await api.freebuffCliLaunch(action)
      }
    } catch (e) { props.onError(e) }
  }
  const changeNotifications = async (on: boolean) => {
    setNotifications(on)
    try { await api.setNotifications(on) } catch (e) { props.onError(e) }
  }
  const copyDiagnostic = async () => {
    try {
      const text = await api.diagnostic()
      await navigator.clipboard.writeText(text)
      setDiagnosticMsg("Diagnostic copié dans le presse-papiers (sans aucune clé API).")
    } catch (e) { props.onError(e) }
  }

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
  const switchWs = async (dir: string) => {
    setBusy(true)
    // v9.1.5 : le chemin était IGNORÉ avant (seul un refresh était fait) — le bouton
    // « Utiliser » ne changeait jamais d'espace. On bascule vraiment, puis on refresh.
    try { await api.switchWorkspace(dir); await refreshAfterRestart() } catch (e) { props.onError(e) } finally { setBusy(false) }
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

  // v10.2.0 (M8) : les listes triables se pilotent au clavier (skill « mode pour chaque
  // geste ») — ↑↓ déplacent le focus d'une rangée à l'autre ; Alt+↑↓ déplacent
  // l'élément (l'équivalent clavier du glisser-déposer), le focus le suit.
  const sortableKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>, move: (fromId: string, toId: string) => void) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return
    const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(".sortable-item"))
    if (!items.length) return
    e.preventDefault()
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const current = active ? items.indexOf(active) : -1
    if (!e.altKey) {
      const next = current < 0 ? items[0] : items[Math.min(items.length - 1, Math.max(0, current + (e.key === "ArrowDown" ? 1 : -1)))]
      next.focus()
      return
    }
    if (current < 0) return
    const target = current + (e.key === "ArrowDown" ? 1 : -1)
    if (target < 0 || target >= items.length) return
    const fromId = items[current].dataset.sortId
    const toId = items[target].dataset.sortId
    if (!fromId || !toId) return
    move(fromId, toId)
    // Le réordonnancement régénère les rangées : on refocalise l'élément déplacé
    // après la double frame (rendu React peint).
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = Array.from(document.querySelectorAll<HTMLElement>(".sortable-item")).find((n) => n.dataset.sortId === fromId)
      el?.focus()
    }))
  }

  const accentChoices = [
    // v11.0.0 : l'orange signal est le défaut de la DA ; les anciens presets restent.
    ["signal", "Orange braise", "#d77a43"],
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
        <div className="segmented" role="group" aria-label="Thème de l’interface">
          {/* v10.2.2 : l'état sélectionné était purement visuel — aria-pressed le dit au lecteur d'écran. */}
          {(["light", "system", "dark"] as const).map((value) => <button key={value} type="button" className={appearance.theme === value ? "selected" : ""} aria-pressed={appearance.theme === value} onClick={() => props.onAppearanceChange({ theme: value })}>{value === "light" ? "Clair" : value === "dark" ? "Sombre" : "Système"}</button>)}
        </div>
      </section>
      <section className="settings-section">
        <div className="section-title">Accent</div>
        <div className="accent-grid">
          {accentChoices.map(([key, label, color]) => <button key={key} type="button" className={`accent-choice ${appearance.accent === key ? "selected" : ""}`} aria-pressed={appearance.accent === key} onClick={() => props.onAppearanceChange({ accent: key })}><span className="accent-dot" style={{ background: color, color }} /><span>{label}</span></button>)}
          <label className={`accent-choice accent-custom ${appearance.accent === "custom" ? "selected" : ""}`}><span className="accent-dot" style={{ background: appearance.customAccent, color: appearance.customAccent }} /><span>Personnalisée</span><input type="color" value={appearance.customAccent} onChange={(e) => props.onAppearanceChange({ accent: "custom", customAccent: e.target.value })} /></label>
        </div>
      </section>
      <section className="settings-section">
        <div className="setting-row"><span>Densité</span><select aria-label="Densité" value={appearance.density} onChange={(e) => props.onAppearanceChange({ density: e.target.value as AppearanceConfig["density"] })}><option value="comfortable">Confortable</option><option value="compact">Compacte</option></select></div>
        <div className="setting-row"><span>Position de la barre latérale</span><select aria-label="Position de la barre latérale" value={appearance.sidebarPosition} onChange={(e) => props.onAppearanceChange({ sidebarPosition: e.target.value as AppearanceConfig["sidebarPosition"] })}><option value="left">Gauche</option><option value="right">Droite</option></select></div>
        <div className="setting-row slider-row"><span>Largeur de la barre latérale <b>{appearance.sidebarWidth}px</b></span><div className="range-control"><input type="range" aria-label="Largeur de la barre latérale" min={240} max={420} step={2} value={appearance.sidebarWidth} style={{ "--range-progress": `${((appearance.sidebarWidth - 240) / 180) * 100}%` } as CSSProperties} onChange={(e) => props.onAppearanceChange({ sidebarWidth: Number(e.target.value) })} /></div></div>
        <div className="setting-row slider-row"><span>Largeur des messages <b>{appearance.messageWidth}px</b></span><div className="range-control"><input type="range" aria-label="Largeur des messages" min={560} max={1100} step={10} value={appearance.messageWidth} style={{ "--range-progress": `${((appearance.messageWidth - 560) / 540) * 100}%` } as CSSProperties} onChange={(e) => props.onAppearanceChange({ messageWidth: Number(e.target.value) })} /></div></div>
      </section>
      <section className="settings-section">
        <div className="section-title">Éléments de l’interface</div>
        {([ ["showSidebar", "Conversations"], ["showModel", "Modèle actif"], ["showNotices", "Événements modèle"], ["showToolActivity", "Activité des outils"], ["showComposer", "Éditeur de message"] ] as const).map(([key, label]) => <label key={key} className="toggle-row"><span>{label}</span><input type="checkbox" checked={appearance[key]} onChange={(e) => props.onAppearanceChange({ [key]: e.target.checked })} /></label>)}
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
        <p className="section-hint">Réorganise les éléments de la conversation par glisser-déposer, ou au clavier : ↑↓ pour naviguer, Alt+↑↓ pour déplacer.</p>
        <div className="sortable-list" role="list" aria-label="Ordre des blocs de la conversation" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown">
          {appearance.mainOrder.map((id) => {
            const labels: Record<BlockId, string> = { messages: "Messages", notices: "Événements modèle", model: "Modèle actif", composer: "Éditeur de message" }
            return <div key={id} className={`sortable-item ${draggedBlock === id ? "is-dragged" : ""}`} role="listitem" tabIndex={0} data-sort-id={id} onKeyDown={(e) => sortableKeyDown(e, (from, to) => moveBlock(from as BlockId, to as BlockId))} draggable onDragStart={(e) => { setDraggedBlock(id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", id) }} onDragEnd={() => setDraggedBlock(null)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { moveBlock(e.dataTransfer.getData("text/plain") as BlockId, id); setDraggedBlock(null) }}><span className="drag-handle"><Icon name="grip" size={16} /></span><span><b>{labels[id]}</b><small>{id}</small></span></div>
          })}
        </div>
      </section>
      <section className="settings-section">
        <div className="section-title">Ordre des agents</div>
        <p className="section-hint">Les identifiants restent inchangés : seul l’ordre d’affichage est modifié. Glisser-déposer, ou ↑↓ pour naviguer et Alt+↑↓ pour déplacer.</p>
        <div className="sortable-list" role="list" aria-label="Ordre des agents" aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown">
          {props.agents.map((agent) => <div key={agent.id} className={`sortable-item ${draggedAgent === agent.id ? "is-dragged" : ""}`} role="listitem" tabIndex={0} data-sort-id={agent.id} onKeyDown={(e) => sortableKeyDown(e, moveAgent)} draggable onDragStart={(e) => { setDraggedAgent(agent.id); e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", agent.id) }} onDragEnd={() => setDraggedAgent(null)} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { moveAgent(e.dataTransfer.getData("text/plain"), agent.id); setDraggedAgent(null) }}><span className="drag-handle"><Icon name="grip" size={16} /></span><span><b>{agent.name}</b><small>{agent.description || agent.id}</small></span></div>)}
        </div>
      </section>
      <footer className="drawer-footer"><button type="button" className="button ghost" onClick={props.onAppearanceReset}>Réinitialiser</button><button type="button" className="button primary" onClick={props.onClose}>Terminé</button></footer>
    </div>
  )

  const renderGeneral = () => (
    <div className="settings-pane">
      <section className="settings-section">
      <h4>Services IA · clés API</h4>
      <p className="hint">Les modèles texte payants sont désactivés. OpenRouter Free est optionnel et Groq sert à la dictée vocale. Les clés sont chiffrées par le système et ne quittent jamais l’application.</p>
      {state.providers.map((p) => <div key={p.id} className="field"><b>{p.label} {state.keys[p.id] && <span className="key-status"><Icon name="check" size={12} />clé enregistrée</span>}</b><span className="hint">{p.note}</span>{state.keyWarnings?.[p.id] && <span className="err">{state.keyWarnings[p.id]}</span>}{/* v11.0.1 : une seule action primaire par panneaux — deux « Enregistrer » orange
            côte à côte se neutralisaient. L'enregistrement d'une clé est local. */}
      <div className="row"><input className="settings-input" type="password" aria-label={`Clé API ${p.label}`} placeholder={state.keys[p.id] ? "Remplacer la clé…" : "Coller la clé…"} value={inputs[p.id] ?? ""} onChange={(e) => setInputs((i) => ({ ...i, [p.id]: e.target.value }))} /><button type="button" className="button secondary" disabled={!inputs[p.id]?.trim()} onClick={() => save(p.id, inputs[p.id])}>Enregistrer</button>{state.keys[p.id] && <button type="button" className="button danger" onClick={() => save(p.id, "")}>Effacer</button>}<button type="button" className="button secondary" onClick={() => api.openExternal(p.url)}>Obtenir une clé</button></div></div>)}
      <div className="settings-callout"><b>Modèles gratuits et dictée</b><span><code>OpenRouter Free</code> fournit des modèles gratuits pour les agents. <code>Groq</code> alimente la dictée vocale ; le texte transcrit arrive dans le composeur et doit être relu puis envoyé.</span></div>
      </section>
      <section className="settings-section">
      <h4>Notifications de bureau</h4>
      <p className="hint">Prévient quand un agent a besoin de toi : permission demandée, formulaire, tour terminé (s’il a duré plus de 8 s) ou échoué. Jamais quand la fenêtre est au premier plan.</p>
      <label className="toggle-row"><span>Activer les notifications</span><input type="checkbox" checked={notifications !== false} onChange={(e) => void changeNotifications(e.target.checked)} /></label>
      <div className="row"><button type="button" className="button secondary" onClick={() => void copyDiagnostic()}>Copier le diagnostic</button><span className="hint">Versions, état du moteur, agents et derniers événements — sans aucune clé API.</span>{diagnosticMsg && <span className="hint">{diagnosticMsg}</span>}</div>
      </section>
      <section className="settings-section">
      <h4>Terminal Freebuff</h4>
      <p className="hint">Le terminal Freebuff est indépendant de la conversation Aven. La carte Freebuff ouvre sa session interactive ; cette section permet de vérifier l’installation du CLI et de se connecter au service.</p>
      <div className="row">
        <span className="hint">{cli === null ? "Vérification…" : cli.installed ? <b><Icon name="check" size={12} /> CLI installé{cli.version ? ` — v${cli.version}` : ""}</b> : "CLI non installé"}</span>
        {cli?.installed && <button type="button" className="button secondary" onClick={() => void cliAction("login")}>Se connecter</button>}
        {!cli?.installed && <button type="button" className="button primary" disabled={cliInstalling} onClick={() => void cliAction("install")}>{cliInstalling ? "Installation en cours…" : "Installer le CLI (npm)"}</button>}
      </div>
      </section>
      <section className="settings-section">
      <h4>Priorité des modèles</h4>
      <p className="hint">Chaque agent utilise sa propre chaîne de modèles : Aven essaie d’abord le premier disponible, puis passe au suivant en cas d’indisponibilité temporaire.</p>
      {state.warning && <p className="err">Table de priorités : {state.warning}</p>}
      {!!state.newModels?.length && <p className="hint">Nouveaux modèles ajoutés automatiquement à ta table de priorités : {state.newModels.join(", ")}.</p>}
      {!!state.removedModels?.length && <p className="hint">Modèles payants retirés de cet espace : {state.removedModels.join(", ")}.</p>}
      {Object.entries(state.assignments ?? {}).map(([agent, chain]) => <p key={agent} className="hint"><b>{agent}</b> : {chain.length ? chain.slice(0, 5).map((m, i) => `${i + 1}. ${m.label}`).join("  →  ") + (chain.length > 5 ? `  (+${chain.length - 5})` : "") : "aucun modèle disponible"}</p>)}
      </section>
      <section className="settings-section">
      <h4>Espaces de travail</h4>
      <p className="hint">Un espace correspond à un dossier de projet. Il regroupe ses conversations, agents et priorités de modèles ; les clés API sont partagées entre tous les espaces. Les fichiers explorés et les notes suivent l’espace actif.</p>
      {(state.workspaces ?? []).map((w) => <div key={w.path} className="row"><span className="settings-workspace-line">{w.path === state.workspace ? <b className="current-workspace"><Icon name="dot" size={12} />{w.name}</b> : w.name} <span className="hint">{displayPath(w.path)}</span></span>{w.path !== state.workspace && <button type="button" className="button secondary" disabled={busy} onClick={() => switchWs(w.path)}>Utiliser</button>}<button type="button" className="button danger" disabled={busy} onClick={() => removeWs(w.path)}>Retirer de la liste</button></div>)}
      <div className="row"><input className="settings-input" aria-label="Nom du nouvel espace" placeholder="Nom du nouvel espace…" value={newWsName} onChange={(e) => setNewWsName(e.target.value)} /><button type="button" className="button primary" onClick={createWs}>Créer un nouvel espace</button><button type="button" className="button secondary" onClick={addExistingWs}>Ouvrir un dossier existant</button></div>
      {!!state.sync?.length && <><h4>Fichiers de config du dossier de travail</h4>{state.sync.map((s) => <p key={s.file} className="hint"><code>{s.file}</code> : {SYNC_LABEL[s.status] ?? s.status}</p>)}</>}
      {state.versionWarning && <p className="err">{state.versionWarning}</p>}
      <p className="hint">OpenCode {state.version ?? "?"} · CLI : {state.cli ?? "?"}<br />Dossier de travail actif : {state.workspace ?? "?"}</p>
      <div className="row"><button type="button" className="button secondary" onClick={() => api.openWorkspace()}>Ouvrir le dossier actif</button></div>
      </section>
      <div className="row"><button type="button" className="button ghost" onClick={props.onClose}>Fermer</button></div>
    </div>
  )

  // Onglet Usage (v9.3.0) : les statistiques du hub (v8.11.0) migrées en section Réglages.
  const renderUsage = () => (
    <div className="settings-pane">
      <h4>Usage de l'application</h4>
      <p className="hint">Conversations, dictées et modèles — comptés dans l'espace actif.</p>
      <div className="stats-grid">
        <div className="stat-tile"><strong>{stats ? stats.totalChats : "…"}</strong><small>conversations actives</small></div>
        <div className="stat-tile"><strong>{stats ? stats.archivedChats : "…"}</strong><small>archivées</small></div>
        <div className="stat-tile"><strong>{stats ? stats.dictationsTotal : "…"}</strong><small>dictées ({stats ? stats.dictationsToday : "…"} aujourd'hui)</small></div>
        {stats?.perAgent.map((e) => (
          <div key={e.agent} className="stat-tile"><strong>{e.count}</strong><small>conversations · {props.agents.find((a) => a.id === e.agent)?.name ?? e.agent}</small></div>
        ))}
        {stats?.topModels.length ? (
          <div className="stat-tile stat-wide"><strong>{stats.topModels.map((m) => `${m.model} (${m.count})`).join(" · ")}</strong><small>modèles les plus utilisés</small></div>
        ) : null}
      </div>
      <div className="row"><button className="button secondary" onClick={() => api.getStats().then(setStats).catch((e) => props.onError(e))} type="button">Actualiser</button></div>
    </div>
  )

  // v11.1.0 : section « Agent vocal ». Le micro visible vit dans le bandeau du
  // Poste ; ici on choisit la voix et la personnalité, et on dit clairement ce
  // qui part chez le fournisseur distant et ce que coûtent les quotas gratuits.
  const renderVoice = () => (
    <div className="settings-pane">
      <section className="settings-section">
        <h4>Agent vocal</h4>
        <p className="hint">Le micro reste à l’écoute tant qu’il n’est pas coupé. Dis « Aven » puis ta demande ; après une réponse, tu as dix secondes pour enchaîner sans répéter le mot. Le bouton micro du bandeau coupe et réactive l’écoute.</p>
        <div className="settings-callout">
          <b>Ce qui part en ligne</b>
          <span>La transcription et la réponse passent par Groq (palier gratuit) : les segments audio sont envoyés au STT distant, rien n’est conservé sur disque. La synthèse, elle, est locale (Pocket TTS ou voix Windows) : le texte de la réponse ne quitte pas la machine. Les quotas gratuits ne sont pas illimités ; en cas de dépassement, l’agent s’arrête — aucun service payant n’est utilisé.</span>
        </div>
      </section>
      <section className="settings-section">
        <h4>Voix de l’agent</h4>
        <p className="hint">La voix choisie est utilisée phrase par phrase. Le changement est enregistré immédiatement ; l’aperçu lit un court message.</p>
        <div className="setting-row">
          <span>Voix</span>
          <select aria-label="Voix de l’agent vocal" value={voiceIdOf(voicePrefs?.voiceName)} onChange={(e) => void saveVoicePrefs({ voiceName: e.target.value })}>
            <option value="">Voix par défaut</option>
            {/* v11.14.0 : toutes les voix restantes sont locales */}
            <optgroup label="Locales (hors ligne)">
              {voiceNames.map((id) => (
                <option key={id} value={id}>{voiceLabel(id)}</option>
              ))}
            </optgroup>
          </select>
        </div>
        <div className="row">
          <button type="button" className="button secondary" onClick={() => void previewVoice()} disabled={voicePreviewing}>{voicePreviewing ? "Lecture…" : "Tester la voix"}</button>
          <button type="button" className="button ghost" onClick={() => { void api.voiceAgentStop().catch((e) => props.onError(e)) }}>Arrêter la lecture</button>
          {voicePrefs && voiceNames.length === 0 && <span className="hint">Aucune voix locale détectée.</span>}
        </div>
        {/* v11.10.0 : la voix locale Pocket TTS télécharge son modèle au premier
            usage — le dire évite de prendre ces minutes pour une panne.
            v11.14.0 : le repli est la voix Windows, hors ligne, toujours annoncé. */}
        <p className="hint">Pocket TTS est un moteur local : rien ne sort de la machine. Son modèle français (209 Mo) se télécharge au premier usage, une seule fois ; si le moteur n’est pas disponible, Aven le signale et lit avec la voix Windows.</p>
        {/* v11.11.0 : la voix clonée se crée DANS l’app. Tout ce dont elle a
            besoin est installé ou téléchargé par Aven, dans ses propres données —
            y compris le modèle de clonage (209 Mo), dont l’accès est soumis à
            conditions : c’est le seul geste qui reste à faire, et le jeton
            correspondant ne quitte jamais le host. */}
        <div className="row">
          <button
            type="button"
            className="button secondary"
            onClick={() => void cloneVoice()}
            disabled={cloneBusy || cloneStatus?.engine === false}
          >
            {cloneBusy ? "Clonage en cours…" : cloneStatus?.profile ? "Remplacer la voix clonée…" : "Créer une voix à partir d’un fichier…"}
          </button>
          {cloneStatus?.profile && (
            <button type="button" className="button danger" onClick={() => void removeClone()} disabled={cloneBusy}>Retirer la voix clonée</button>
          )}
        </div>
        {cloneStatus?.engine === false && <p className="hint">Le moteur Pocket TTS n’est pas installé : le clonage passe par lui.</p>}
        {cloneBusy && (
          <p className="hint" role="status">
            {cloneStatus?.weights
              ? "Conversion de l’enregistrement…"
              : "Téléchargement du modèle de clonage (209 Mo), puis conversion : cela peut prendre plusieurs minutes."}
          </p>
        )}
        {cloneStatus && !cloneStatus.weights && !cloneBusy && (
          <>
            <div className="setting-row">
              <span>Jeton Hugging Face</span>
              <input
                className="settings-input"
                type="password"
                aria-label="Jeton Hugging Face pour le clonage de voix"
                placeholder={cloneStatus.token ? "Jeton enregistré — remplacer…" : "Coller le jeton…"}
                value={cloneToken}
                onChange={(e) => setCloneToken(e.target.value)}
              />
              <button type="button" className="button secondary" disabled={!cloneToken.trim()} onClick={() => void saveCloneToken()}>Enregistrer</button>
              <button type="button" className="button ghost" onClick={() => void api.openExternal(POCKET_CLONE_TERMS_URL)}>Ouvrir la page du modèle</button>
            </div>
            <p className="hint">Le modèle de clonage (209 Mo) est la seule pièce dont l’accès est soumis à conditions : accepte-les sur la page du modèle, crée un jeton en lecture, puis colle-le ici. Aven télécharge ensuite le modèle lui-même dans ses données — le jeton ne sert qu’une fois.</p>
          </>
        )}
        {cloneMessage && <p className="hint" role="status">{cloneMessage}</p>}
        {/* v11.10.0 : le profil vit dans les données de l’app, jamais dans l’installeur. */}
        <p className="hint">Quinze secondes de parole suffisent comme enregistrement de référence. Le clonage reste sur cette machine : le moteur travaille en local, et le profil — un dérivé de ta voix — n’est ni livré ni téléversé. « Retirer la voix clonée » l’efface.</p>
      </section>
      <section className="settings-section">
        <h4>Personnalité</h4>
        <p className="hint">Change le ton des réponses, jamais l’exécution d’une commande. Aucun bruitage n’est ajouté.</p>
        <div className="segmented" role="group" aria-label="Personnalité de l’agent vocal">
          {VOICE_PERSONALITY_OPTIONS.map((option) => (
            <button key={option.id} type="button" className={voicePrefs?.personality === option.id ? "selected" : ""} aria-pressed={voicePrefs?.personality === option.id} title={option.hint} onClick={() => void saveVoicePrefs({ personality: option.id })}>{option.label}</button>
          ))}
        </div>
      </section>
      <section className="settings-section">
        <h4>Micro</h4>
        <p className="hint">Le micro se coupe et se réactive depuis le bandeau du Poste ; son état y reste visible. Aucune autre commande ne le coupe à ta place.</p>
      </section>
    </div>
  )

  // v10.3.0 : les Réglages sont une PAGE pleine, pas un dialogue superposé — même
  // charpente que Tâches et Projet, actions déclarées ici (Fermer). Les classes
  // « unified-settings » / « unified-settings-scroll » restent (scripts de fumée).
  return (
    <InstrumentFrame
      eyebrow="RÉGLAGES"
      title="Configuration et apparence"
      description="Un seul endroit pour les clés, les espaces, l’apparence et l’usage de l’application. Les sections se choisissent dans l’inspecteur."
      bodyClassName="unified-settings"
    >
      <div className="unified-settings-scroll" role="tabpanel" aria-label={`Réglages · ${section}`}>{section === "appearance" ? renderAppearance() : section === "usage" ? renderUsage() : section === "voice" ? renderVoice() : renderGeneral()}</div>
    </InstrumentFrame>
  )
}
