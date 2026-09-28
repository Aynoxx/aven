import { useCallback, useEffect, useMemo, useState } from "react"
import { api } from "./api"
import { Icon } from "./icons"
import type { Breadcrumb, FileEntry, TextFile } from "./types"

// Explorateur de fichiers intégré (v9.3.0) — lecture seule, cloisonné à la racine de
// l'espace côté main (workspace-files.ts safeResolve). Aperçu texte borné, « Ouvrir dans
// l'Explorateur », et « Faire analyser par un agent » (chemin injecté dans le composeur).
// Aucun hook dans un rendu conditionnel : tous les hooks sont au niveau du composant.

const fmtSize = (n: number) => (n < 1024 ? `${n} o` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} Kio` : `${(n / (1024 * 1024)).toFixed(1)} Mio`)

type Props = {
  agents: { id: string; name: string }[]
  onCompose: (text: string) => void
  onClose: () => void
  onError: (e: unknown) => void
}

export default function FilesView(props: Props) {
  const [relative, setRelative] = useState("")
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [crumbs, setCrumbs] = useState<Breadcrumb>([{ label: "Espace", path: "" }])
  const [preview, setPreview] = useState<TextFile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [analyzeFor, setAnalyzeFor] = useState<string | null>(null)

  const load = useCallback((rel: string) => {
    setLoading(true)
    setError(null)
    api.filesList(rel)
      .then((list) => { setEntries(list); setRelative(rel); return api.filesBreadcrumb(rel) })
      .then(setCrumbs)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load("") }, [load])

  const openDir = (path: string) => {
    setPreview(null)
    setAnalyzeFor(null)
    load(path)
  }

  const openFile = (path: string) => {
    setAnalyzeFor(null)
    api.filesRead(path)
      .then(setPreview)
      .catch((e) => { setPreview(null); setError(e instanceof Error ? e.message : String(e)) })
  }

  const upDir = useMemo(() => {
    const parts = relative.split("/").filter(Boolean)
    return parts.length ? parts.slice(0, -1).join("/") : null
  }, [relative])

  // Le nom de l'agent cliqué est affiché par le bouton ; l'énoncé envoyé au composeur
  // s'adresse à l'agent ACTIF (le composeur suit l'onglet courant — l'utilisateur valide).
  const askAgent = () => {
    const target = preview?.path ?? relative
    props.onCompose(`Analyse le fichier « ${target} » de l'espace et explique-moi ce qu'il contient.`)
    setAnalyzeFor(null)
  }

  return (
    <div className="overlay"><div className="dialog wide files-dialog">
      <header className="unified-settings-header">
        <div><span className="eyebrow">FICHIERS</span><h3>Fichiers de l'espace</h3>
          <nav className="files-crumbs" aria-label="Fil d'ariane">
            {crumbs.map((c, i) => (
              <span key={c.path || "root"} className="files-crumb">
                {i > 0 && <Icon name="chevron-right" size={12} />}
                <button className="button ghost files-crumb-button" type="button" onClick={() => openDir(c.path)}>{c.label}</button>
              </span>
            ))}
          </nav>
        </div>
        <div className="row">
          <button className="button secondary" type="button" onClick={() => api.filesOpen(relative).catch((e) => props.onError(e))} title="Ouvre ce dossier dans l'Explorateur Windows"><Icon name="folder" size={14} />Explorateur</button>
          <button className="button button-icon dialog-close" onClick={props.onClose} aria-label="Fermer" type="button"><Icon name="close" size={17} /></button>
        </div>
      </header>
      <div className="files-layout">
        <aside className="files-list-panel">
          {upDir !== null && (
            <button className="files-item files-up" onClick={() => openDir(upDir)} type="button"><span className="files-item-icon"><Icon name="arrow-left" size={15} /></span><strong>..</strong></button>
          )}
          {loading && <p className="hint">Lecture…</p>}
          {error && <p className="err">{error}</p>}
          {!loading && !error && entries.map((e) => (
            e.kind === "dir" ? (
              <button key={e.path} className="files-item" onClick={() => openDir(e.path)} type="button" title={e.name}>
                <span className="files-item-icon"><Icon name="folder" size={15} /></span>
                <strong>{e.name}</strong>
                <span className="files-item-meta" />
              </button>
            ) : (
              <button key={e.path} className={`files-item ${preview?.path === e.path ? "selected" : ""}`} onClick={() => openFile(e.path)} type="button" title={e.name}>
                <span className="files-item-icon"><Icon name="file" size={15} /></span>
                <strong>{e.name}</strong>
                <span className="files-item-meta">{fmtSize(e.size)}</span>
              </button>
            )
          ))}
          {!loading && !error && !entries.length && <p className="hint">Dossier vide.</p>}
        </aside>
        <article className="files-preview">
          {preview ? (
            <>
              <div className="notes-toolbar">
                <span className="eyebrow">APERÇU · {preview.path}</span>
                <button className="button ghost" type="button" onClick={() => setAnalyzeFor(analyzeFor === preview.path ? null : preview.path)}><Icon name="agent" size={13} />Faire analyser par un agent</button>
                <span className="hint">{fmtSize(preview.size)}{preview.truncated ? " · aperçu tronqué (512 Kio)" : ""}</span>
              </div>
              {analyzeFor === preview.path && (
                <div className="row files-analyze-row" role="group" aria-label="Préparer la demande d'analyse">
                  {props.agents.map((a) => <button key={a.id} className="button secondary" type="button" onClick={askAgent}>{a.name}</button>)}
                </div>
              )}
              <pre className="files-content">{preview.content}</pre>
            </>
          ) : (
            <div className="empty-state">
              <div className="empty-symbol"><Icon name="folder" size={24} /></div>
              <h2>Sélectionne un fichier</h2>
              <p>L'aperçu des fichiers texte de l'espace s'affichera ici (lecture seule).</p>
            </div>
          )}
        </article>
      </div>
    </div></div>
  )
}
