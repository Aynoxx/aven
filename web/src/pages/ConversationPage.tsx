import type { ReactNode } from "react"
import { api } from "../api"
import Markdown from "../Markdown"
import MessageBubble from "../MessageBubble"
import { Icon } from "../icons"
import { usableModelRef } from "../model-label"
import { TASK_MODES_UI } from "../app/constants"
import type { AvenApp } from "../app/use-aven-app"

// v10.4.0 : la conversation (barre latérale, fil, composeur, modèle, avis) est un
// module de page. Les quatre blocs restent ordonnés par l'apparence ; ils lisent le
// contrôleur, ne détiennent rien.
export default function ConversationPage({ app }: { app: AvenApp }) {
  const {
    renameCancelled,
    activeModelLabel,
    agentName,
    appState,
    appearance,
    applyModelChoice,
    armDelete,
    changeTaskMode,
    chatGroups,
    chatId,
    chatValue,
    chats,
    commitChatRename,
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
    notices,
    onMessagesMouseUp,
    onScroll,
    openConversationFromSidebar,
    releaseDictation,
    renamingChat,
    scrollRef,
    search,
    searchRef,
    send,
    setChatId,
    setChatValue,
    setDictationMeta,
    setFollowBottom,
    setInput,
    setModelMenuOpen,
    setModelMenuStyle,
    setRenamingChat,
    setSearch,
    setShowAgentsPage,
    setShowArchived,
    setShowHome,
    showArchived,
    signalActivity,
    startRenameChat,
    tab,
    taskMode,
    textareaRef,
    toggleArchive,
    visibleChats,
  } = app

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
        <strong>{activeModelLabel}</strong>
        {/* v9.4.0 : le modèle devient un choix, pas une affiche — « Auto » rend la main au routeur. */}
        <div className="model-select" onClick={(e) => e.stopPropagation()}>
          <button ref={modelButtonRef} className="button secondary model-select-button" type="button" onClick={() => {
            if (modelMenuOpen) { setModelMenuOpen(false); return }
            const rect = modelButtonRef.current?.getBoundingClientRect()
            const above = rect ? rect.top : 0
            const below = rect ? window.innerHeight - rect.bottom : 0
            const dir: "up" | "down" = above >= 220 && above > below ? "up" : "down"
            const available = (dir === "up" ? above : below) - 16
            setModelMenuStyle({ dir, maxHeight: Math.max(120, Math.min(300, available)) })
            setModelMenuOpen(true)
          }} aria-expanded={modelMenuOpen} aria-haspopup="listbox">
            <Icon name="chevron-down" size={14} />Choisir le modèle
          </button>
          {modelMenuOpen && (
            <div className={`model-select-menu ${modelMenuStyle.dir}`} role="listbox" aria-label="Modèles gratuits disponibles" style={{ maxHeight: modelMenuStyle.maxHeight }}>
              <button className="model-select-item" type="button" role="option" aria-selected={!usableModelRef(currentModel)} onClick={() => applyModelChoice(undefined)}>
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
      <span className="model-assignment">{usableModelRef(currentModel) ? "Chaîne de l’agent · " + agentName(tab) : "Le routeur choisit au prochain message"}</span>
    </div>
  )
  const renderComposer = () => (
    <div className="composer-wrap block-card" key="composer">
      <div className="composer">
        <textarea
          ref={textareaRef}
          value={dictationMeta.showRaw && dictationMeta.cleaned ? dictationMeta.rawText : input}
          placeholder={dictation.state === "recording" ? "J’écoute…" : "Écris à l’agent… (ou maintiens le micro)"}
          aria-label="Message à l’agent"
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
                className={`button button-icon dictation-button ${dictation.state === "recording" ? "dictation-recording" : "secondary"}${dictation.paused ? " dictation-paused" : ""}`}
                type="button"
                disabled={dictation.state === "transcribing"}
                onPointerDown={(e) => { e.preventDefault(); dictationPointerRef.current = true; if (dictation.state === "error") dictation.resetError(); else if (dictation.state === "idle") void dictation.start("composer") }} // v10.2.0 (F6)
                onPointerUp={(e) => { e.preventDefault(); releaseDictation() }}
                onPointerLeave={() => { if (dictationPointerRef.current && dictation.state === "recording") dictation.pause() }} // v10.2.0 (F6) : doigt sorti = pause
                onPointerEnter={() => { if (dictationPointerRef.current && dictation.paused) dictation.resume() }} // v10.2.0 (F6) : doigt revenu = reprise
                aria-label={dictation.paused ? "Reprendre la dictée — repose le doigt" : dictation.state === "recording" ? "Relâcher pour transcrire" : "Dicter (maintenir, ou Ctrl+Maj+V)"}
                title="Dicter (maintenir le clic, ou Ctrl+Maj+V). Le texte arrive dans le composeur : relis-le avant d’envoyer."
              >
                <Icon name="microphone" size={16} />
              </button>
            )}
            <span className="composer-hint">
              {dictation.paused ? "Dictée en pause — repose le doigt sur le micro pour reprendre."
                : dictation.state === "recording" ? "J’écoute… relâche pour transcrire (Échap pour annuler)."
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

  return (
          <div className="workspace-layout">
            {appearance.showSidebar && (
              <aside className="sidebar">
                <div className="sidebar-top">
                  <div className="sidebar-heading"><div><span className="eyebrow">CONVERSATIONS</span><strong>{showArchived ? "Archivées" : agentName(tab)}</strong></div><button className="button primary small" onClick={newChat} disabled={!tab} aria-label="Nouvelle conversation" title="Nouvelle conversation (Ctrl+N)"><Icon name="plus" size={16} /></button></div>
                  <div className="search-wrap"><span><Icon name="search" size={16} /></span><input ref={searchRef} className="search" placeholder="Rechercher" aria-label="Rechercher une conversation" value={search} onChange={(e) => setSearch(e.target.value)} /></div>
                  <button className={`archive-toggle ${showArchived ? "selected" : ""}`} type="button" onClick={() => { setShowArchived((value) => !value); setChatId(null) }}><span><Icon name="archive-list" size={15} /></span>{showArchived ? "Revenir aux actives" : "Voir les archivées"}</button>
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
                          <div className="chat-actions"><button onClick={() => startRenameChat(c.id)} title="Renommer" aria-label="Renommer"><Icon name="pencil" size={14} /></button><button onClick={() => exportChat(c.id)} title="Exporter" aria-label="Exporter"><Icon name="export" size={14} /></button><button onClick={() => toggleArchive(c.id, !showArchived)} title={showArchived ? "Désarchiver" : "Archiver"} aria-label={showArchived ? "Désarchiver" : "Archiver"}><Icon name={showArchived ? "restore" : "archive"} size={14} /></button><button className={deleteArmed === c.id ? "armed" : ""} onClick={() => armDelete(c.id)} title={deleteArmed === c.id ? "Confirmer la suppression définitive" : "Supprimer"} aria-label={deleteArmed === c.id ? "Confirmer la suppression définitive" : "Supprimer"}><Icon name="trash" size={14} /></button></div>
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
                      <div className="chat-actions"><button onClick={() => startRenameChat(c.id)} title="Renommer" aria-label="Renommer"><Icon name="pencil" size={14} /></button><button onClick={() => exportChat(c.id)} title="Exporter" aria-label="Exporter"><Icon name="export" size={14} /></button><button onClick={() => toggleArchive(c.id, !showArchived)} title={showArchived ? "Désarchiver" : "Archiver"} aria-label={showArchived ? "Désarchiver" : "Archiver"}><Icon name={showArchived ? "restore" : "archive"} size={14} /></button><button className={deleteArmed === c.id ? "armed" : ""} onClick={() => armDelete(c.id)} title={deleteArmed === c.id ? "Confirmer la suppression définitive" : "Supprimer"} aria-label={deleteArmed === c.id ? "Confirmer la suppression définitive" : "Supprimer"}><Icon name="trash" size={14} /></button></div>
                    </div>
                  ))}
                  {!visibleChats.length && <div className="sidebar-empty"><span><Icon name="sparkle" size={20} /></span><p>Rien à afficher ici.</p></div>}
                </div>
                <div className="sidebar-footer"><button className="button secondary full" onClick={newChat} disabled={!tab}><Icon name="plus" size={14} />Nouvelle conversation</button></div>
              </aside>
            )}
            <main className="main">
              <div className="chat-titlebar">
                <div><span className="eyebrow">SESSION · {tab === "projet" ? "Agent principal Aven" : agentName(tab)}</span>
                  {/* v10.2.2 : F2 renomme ici même quand la barre latérale est masquée. */}
                  {chatId && renamingChat === chatId && !appearance.showSidebar ? (
                    <input className="settings-input titlebar-rename" autoFocus value={chatValue} maxLength={120} aria-label="Titre de la conversation"
                      onFocus={(e) => e.target.select()} onChange={(e) => setChatValue(e.target.value)} onBlur={() => void commitChatRename(chatId)}
                      onKeyDown={(e) => { if (e.key === "Enter") void commitChatRename(chatId); if (e.key === "Escape") { e.stopPropagation(); renameCancelled.current = true; setRenamingChat(null) } }} />
                  ) : (
                    <strong>{chats.find((c) => c.id === chatId)?.title ?? "Nouvelle conversation"}</strong>
                  )}
                </div>
                <div className="row">
                  {tab === "projet" && (
                    <div className="tasks-mode-switch" role="group" aria-label="Mode de l'orchestrateur">
                      {TASK_MODES_UI.map((m) => (
                        <button key={m.id} className={`button ${taskMode === m.id ? "primary" : "ghost"} tasks-mode-option`} onClick={() => changeTaskMode(m.id)} type="button" title={m.hint} aria-pressed={taskMode === m.id}>
                          <Icon name={m.icon} size={13} />{m.label}
                        </button>
                      ))}
                    </div>
                  )}
                  <button className="button ghost back-home-button" onClick={() => { setShowHome(false); setShowAgentsPage(true) }} aria-label="Ouvrir l’orchestration" type="button"><Icon name="agent" size={15} />Orchestration</button>
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
  )
}
