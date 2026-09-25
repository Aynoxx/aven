import { Fragment, type ReactNode } from "react"

// Rendu volontairement minimal (pas de librairie externe disponible hors-ligne) :
// blocs de code ```lang, code en ligne `x`, **gras**, *italique*. Le reste du texte
// garde les retours à la ligne tels quels (voir .msg { white-space: pre-wrap } en CSS).

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const parts: ReactNode[] = []
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    if (m[1] !== undefined) parts.push(<code key={`${keyPrefix}-${i}`}>{m[1]}</code>)
    else if (m[2] !== undefined) parts.push(<b key={`${keyPrefix}-${i}`}>{m[2]}</b>)
    else if (m[3] !== undefined) parts.push(<i key={`${keyPrefix}-${i}`}>{m[3]}</i>)
    last = re.lastIndex
    i++
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const copy = () => {
    navigator.clipboard?.writeText(code).catch(() => undefined)
  }
  return (
    <div className="codeblock">
      <div className="codeblock-bar">
        <span>{lang || "texte"}</span>
        <button onClick={copy} title="Copier">
          Copier
        </button>
      </div>
      <pre>
        <code>{code}</code>
      </pre>
    </div>
  )
}

export default function Markdown({ text }: { text: string }) {
  if (!text) return null
  const segments = text.split(/```([^\n`]*)\n([\s\S]*?)```/g)
  // String.split avec un groupe capturant intercale : [texte, lang, code, texte, lang, code, ..., texte]
  const nodes: ReactNode[] = []
  for (let i = 0; i < segments.length; i += 3) {
    const plain = segments[i]
    if (plain) nodes.push(<Fragment key={`t${i}`}>{renderInline(plain, `t${i}`)}</Fragment>)
    const lang = segments[i + 1]
    const code = segments[i + 2]
    if (code !== undefined) nodes.push(<CodeBlock key={`c${i}`} lang={lang} code={code} />)
  }
  return <>{nodes}</>
}
