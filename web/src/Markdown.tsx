import { Fragment, type ReactNode } from "react"

// Rendu volontairement minimal (pas de librairie externe disponible hors-ligne) :
// blocs de code ```lang, code en ligne `x`, **gras**, *italique*. Le reste du texte
// garde les retours à la ligne tels quels (voir .msg { white-space: pre-wrap } en CSS).

function renderInline(text: string, keyPrefix: string, onWikilink?: (target: string) => void): ReactNode[] {
  const parts: ReactNode[] = []
  // v10.1.0 : [[lien]] de note (façon Kortex) — cliquable seulement là où la vue
  // fournit onWikilink (sinon le texte reste brut, comme avant).
  const re = /\[\[([^\[\]\n]{1,120})\]\]|`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*/g
  let last = 0
  let m: RegExpExecArray | null
  let i = 0
  while ((m = re.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index))
    if (m[1] !== undefined) {
      const target = m[1]
      parts.push(onWikilink
        ? <button key={`${keyPrefix}-${i}`} type="button" className="md-wikilink" onClick={() => onWikilink(target)} title="Ouvrir la note liée">{target}</button>
        : <span key={`${keyPrefix}-${i}`}>{`[[${target}]]`}</span>)
    } else if (m[2] !== undefined) parts.push(<code key={`${keyPrefix}-${i}`}>{m[2]}</code>)
    else if (m[3] !== undefined) parts.push(<b key={`${keyPrefix}-${i}`}>{m[3]}</b>)
    else if (m[4] !== undefined) parts.push(<i key={`${keyPrefix}-${i}`}>{m[4]}</i>)
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

export default function Markdown({ text, onWikilink }: { text: string; onWikilink?: (target: string) => void }) {
  if (!text) return null
  const segments = text.split(/```([^\n`]*)\n([\s\S]*?)```/g)
  // String.split avec un groupe capturant intercale : [texte, lang, code, texte, lang, code, ..., texte]
  const nodes: ReactNode[] = []
  for (let i = 0; i < segments.length; i += 3) {
    const plain = segments[i]
    if (plain) nodes.push(<Fragment key={`t${i}`}>{renderInline(plain, `t${i}`, onWikilink)}</Fragment>)
    const lang = segments[i + 1]
    const code = segments[i + 2]
    if (code !== undefined) nodes.push(<CodeBlock key={`c${i}`} lang={lang} code={code} />)
  }
  return <>{nodes}</>
}
