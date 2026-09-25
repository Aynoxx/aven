import type { ReactNode } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import rehypeHighlight from "rehype-highlight"
import "highlight.js/styles/github-dark.css"

// Pas de rehype-raw : react-markdown échappe le HTML littéral du texte par défaut (pas d'interprétation).
// `<img src=x onerror=...>` s'affiche donc comme du texte brut, jamais comme une balise. Aucune balise
// `dangerouslySetInnerHTML` nulle part ici — c'est react-markdown qui construit les éléments React.

// rehype-highlight découpe le code en arbre de <span> colorés (plus une simple chaîne) : pour le bouton
// Copier, on doit donc redescendre récursivement jusqu'aux feuilles textuelles plutôt que lire `.children`
// en supposant que c'est déjà une chaîne.
function flattenText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return ""
  if (typeof node === "string" || typeof node === "number") return String(node)
  if (Array.isArray(node)) return node.map(flattenText).join("")
  if (typeof node === "object" && "props" in node) return flattenText((node as { props?: { children?: ReactNode } }).props?.children)
  return ""
}

function CopyBlock({ children }: { children: ReactNode }) {
  const raw = flattenText(children)
  const copy = () => {
    navigator.clipboard?.writeText(raw).catch(() => undefined)
  }
  return (
    <div className="codeblock">
      <div className="codeblock-bar">
        <span />
        <button onClick={copy} title="Copier">
          Copier
        </button>
      </div>
      <pre>{children}</pre>
    </div>
  )
}

export default function RichMarkdown({ text }: { text: string }) {
  if (!text) return null
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={{
        // Liens désactivés (inertes) : le texte s'affiche, pas de navigation ni d'IPC déclenchée
        // depuis du texte généré par un modèle. Le contenu whitelisté (pages "obtenir une clé") passe
        // par api.openExternal ailleurs dans l'app, jamais depuis ici.
        a: ({ children, href }) => (
          <span className="mdlink" title={href}>
            {children}
          </span>
        ),
        // rehype-highlight colorie déjà <pre><code class="hljs …">…</code></pre> ; on habille juste le
        // conteneur d'une barre avec bouton Copier, sans toucher au balisage interne qu'il a produit.
        pre: ({ children }) => <CopyBlock>{children}</CopyBlock>,
      }}
    >
      {text}
    </ReactMarkdown>
  )
}
