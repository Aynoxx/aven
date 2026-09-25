import { memo } from "react"
import RichMarkdown from "./RichMarkdown"
import type { Msg } from "./types"

type Props = {
  m: Msg
  isLastUser: boolean
  busy: boolean
  onEdit: () => void
  labelOf: (ref?: string) => string
  showToolActivity?: boolean
}

function MessageBubbleImpl({ m, isLastUser, busy, onEdit, labelOf, showToolActivity = true }: Props) {
  const body = (
    <>
      {showToolActivity && m.tools?.map((t) => (
        <span key={t.id} className={`chip ${t.status}`} title={t.output ?? undefined}>
          {t.name}
        </span>
      ))}
      {m.text && <div className="message-text"><RichMarkdown text={m.text} /></div>}
      {m.model && <span className="modelbadge">{labelOf(m.model)}</span>}
      {m.error && <p className="err">{m.error}</p>}
      {m.role === "user" && isLastUser && !busy && (
        <button className="message-edit" onClick={onEdit} title="Modifier et renvoyer">
          Modifier
        </button>
      )}
    </>
  )

  if (m.child) {
    return (
      <details className="msg assistant child">
        <summary>
          {m.agent ?? "sous-agent"} — {m.role === "user" ? "message" : "réponse"}
        </summary>
        <div>{body}</div>
      </details>
    )
  }
  return <div className={`msg ${m.role}`}>{body}</div>
}

// Ne se re-rend que si CE message ou les props qui le concernent changent — pas à chaque delta
// de streaming d'un autre message. `labelOf` doit être stable (useCallback côté App.tsx) pour que
// ce mémo serve à quelque chose.
export default memo(MessageBubbleImpl)
