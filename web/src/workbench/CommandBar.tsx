import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { api } from "../api"
import { Icon, type IconName } from "../icons"
import type { AvenApp } from "../app/use-aven-app"
import type { NoteSearchHit } from "../types"
import { matchCommands, parseOmnibox, rankByQuery, type OmniboxCommand } from "./omnibox"
import { nextArrowIndex } from "../arrow-navigation"

// v11.0.0 : barre de commande permanente du Poste. Une seule saisie pour chercher
// une conversation ou une note, exécuter une commande (« > ») ou cibler une portée
// (« /notes »). Le micro de droite est le seul point d'entrée vocal global : une
// commande s'exécute, une dictée ordinaire rejoint le composeur — jamais d'envoi.

type Result = {
  key: string
  label: string
  hint?: string
  icon: IconName
  run: () => void
}

export default function CommandBar({ app }: { app: AvenApp }) {
  const {
    appState,
    chats,
    dictation,
    dictationPointerRef,
    goHome,
    newChat,
    openConfiguration,
    openConversationInstrument,
    openFilesView,
    openFreebuffAgent,
    openHomeConversation,
    openInstrumentTab,
    openNotesView,
    releaseDictation,
    setCaptureRequested,
  } = app

  const [query, setQuery] = useState("")
  const [focused, setFocused] = useState(false)
  const [notes, setNotes] = useState<NoteSearchHit[]>([])
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const parsed = parseOmnibox(query)

  useEffect(() => {
    const q = parsed.mode === "search" ? parsed.query : parsed.mode === "scope" && parsed.scope === "notes" ? parsed.query : ""
    if (!q) { setNotes([]); return }
    let stop = false
    const timer = setTimeout(() => {
      api.noteSearch(q).then((hits) => { if (!stop) setNotes(hits.slice(0, 5)) }).catch(() => { if (!stop) setNotes([]) })
    }, q.length <= 1 ? 0 : 120)
    return () => { stop = true; clearTimeout(timer) }
  }, [parsed.mode, parsed.mode === "scope" ? parsed.scope : "", parsed.mode === "search" ? parsed.query : parsed.mode === "scope" ? parsed.query : ""])

  const commands: Result[] = useMemo(() => {
    const runCommand = (command: OmniboxCommand) => {
      switch (command.id) {
        case "new-chat": void newChat(); break
        case "new-note": setCaptureRequested(true); openNotesView(); break
        case "capture": setCaptureRequested(true); openNotesView(); break
        case "open-conversations": openConversationInstrument(); break
        case "open-notes": openNotesView(); break
        case "open-files": openFilesView(); break
        case "open-terminal": openFreebuffAgent(); break
        case "open-orchestration": openInstrumentTab("orchestration"); break
        case "open-settings": openConfiguration(undefined, "general"); break
        case "open-settings-appearance": openConfiguration(undefined, "appearance"); break
        case "open-settings-usage": openConfiguration(undefined, "usage"); break
        case "go-home": goHome(); break
      }
      setQuery("")
      inputRef.current?.blur()
    }
    return matchCommands(parsed.mode === "command" ? parsed.query : "").map((command) => ({
      key: `cmd:${command.id}`,
      label: command.label,
      hint: command.hint,
      icon: "slash" as IconName,
      run: () => runCommand(command),
    }))
  }, [parsed.mode, parsed.mode === "command" ? parsed.query : "", goHome, newChat, openConfiguration, openConversationInstrument, openFilesView, openFreebuffAgent, openInstrumentTab, openNotesView, setCaptureRequested])

  const conversationHits: Result[] = useMemo(() => {
    const q = parsed.mode === "search" ? parsed.query : parsed.mode === "scope" && parsed.scope === "conversations" ? parsed.query : ""
    if (!q) return []
    return rankByQuery(chats, q, (c) => c.title || "Conversation").slice(0, 5).map((chat) => ({
      key: `chat:${chat.id}`,
      label: chat.title || "Conversation",
      hint: chat.agent || undefined,
      icon: "agent" as IconName,
      run: () => openHomeConversation(chat),
    }))
  }, [chats, parsed.mode, parsed.mode === "search" ? parsed.query : parsed.mode === "scope" ? parsed.query : "", openHomeConversation])

  const noteHits: Result[] = useMemo(() => notes.map((hit) => ({
    key: `note:${hit.id}`,
    label: hit.title || hit.id,
    hint: hit.snippet,
    icon: "file" as IconName,
    run: () => openNotesView(hit.id),
  })), [notes, openNotesView])

  const results: Result[] = useMemo(() => {
    if (parsed.mode === "command") return commands
    if (parsed.mode === "scope") {
      if (parsed.scope === "conversations") return conversationHits.length ? conversationHits : [{
        key: "open-conversations",
        label: "Ouvrir les conversations",
        hint: "instrument",
        icon: "agent",
        run: () => openConversationInstrument(),
      }]
      if (parsed.scope === "files") return [{
        key: "open-files",
        label: "Ouvrir les fichiers de l’espace",
        hint: "instrument",
        icon: "folder",
        run: () => openFilesView(),
      }]
      return noteHits
    }
    if (parsed.query) return [...conversationHits, ...noteHits]
    // Repos : quelques commandes, pas une liste infinie.
    return commands.slice(0, 6)
  }, [parsed, commands, conversationHits, noteHits, openConversationInstrument, openFilesView])

  useEffect(() => { setActive(0) }, [query, parsed.mode])

  const runResult = (result: Result | undefined) => {
    if (!result) return
    result.run()
    setQuery("")
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    // v11.0.0 : même contrat que les listes du Poste — flèches avec bouclage,
    // Home/End ; la logique reste dans le module pur arrow-navigation.ts.
    const next = nextArrowIndex(e.key, active, results.length)
    if (next !== null) {
      e.preventDefault()
      setActive(next)
    } else if (e.key === "Enter") {
      e.preventDefault()
      runResult(results[active])
    } else if (e.key === "Escape") {
      e.preventDefault()
      setQuery("")
      inputRef.current?.blur()
    }
  }

  const showResults = focused && results.length > 0

  return (
    <div className="wb-command">
      <form className="wb-command-form" role="search" onSubmit={(e) => { e.preventDefault(); runResult(results[active]) }}>
        <span className="wb-command-icon" aria-hidden="true"><Icon name="search" size={15} /></span>
        <input
          ref={inputRef}
          className="wb-command-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 120)}
          onKeyDown={onKeyDown}
          placeholder="Rechercher une conversation, une note…   > commandes   / portées"
          aria-label="Rechercher ou exécuter une commande"
          aria-expanded={showResults}
          aria-controls="wb-command-results"
          role="combobox"
          autoComplete="off"
          spellCheck={false}
        />
        <kbd className="wb-command-kbd">Ctrl K</kbd>
      </form>

      <button
        className="wb-command-mic"
        type="button"
        data-recording={dictation.state === "recording"}
        disabled={!appState.keys.groq}
        title={appState.keys.groq ? "Maintiens pour parler. Une commande pilote le Poste ; une dictée rejoint le composeur." : "Configure une clé Groq dans Réglages"}
        onPointerDown={(e) => {
          e.preventDefault()
          dictationPointerRef.current = true
          if (dictation.state === "error") dictation.resetError()
          else if (dictation.state === "idle") void dictation.start("workbench")
        }}
        onPointerUp={(e) => { e.preventDefault(); releaseDictation() }}
        onPointerLeave={() => { if (dictationPointerRef.current && dictation.state === "recording") dictation.pause() }}
        onPointerEnter={() => { if (dictationPointerRef.current && dictation.paused) dictation.resume() }}
        aria-label={appState.keys.groq ? "Parler à Aven" : "Dictée indisponible : configure une clé Groq"}
      >
        <Icon name="microphone" size={14} />
        <span className="wb-command-level" aria-hidden="true"><i /><i /><i /><i /><i /></span>
        <span>{dictation.state === "recording" ? (dictation.paused ? "Pause" : "Écoute") : dictation.state === "transcribing" ? "Transcription" : "Parler"}</span>
      </button>

      {showResults && (
        <div className="wb-command-results" id="wb-command-results" role="listbox" aria-label="Résultats de la barre de commande">
          <div className="wb-command-section">
            {parsed.mode === "command" ? "COMMANDES" : parsed.mode === "scope" ? `PORTÉE · ${parsed.scope}` : parsed.query ? "RÉSULTATS" : "COMMANDES"}
          </div>
          {results.map((result, index) => (
            <button
              key={result.key}
              className="wb-command-result"
              type="button"
              role="option"
              aria-selected={index === active}
              data-active={index === active}
              onMouseEnter={() => setActive(index)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => runResult(result)}
            >
              <span className="wb-command-result-icon"><Icon name={result.icon} size={14} /></span>
              <span>{result.label}</span>
              {result.hint ? <small>{result.hint}</small> : null}
            </button>
          ))}
          {!results.length && <div className="wb-command-empty">{parsed.query ? "Aucun résultat." : "Tape une recherche, « > » pour les commandes, « / » pour une portée."}</div>}
        </div>
      )}
    </div>
  )
}
