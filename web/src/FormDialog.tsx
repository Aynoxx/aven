import { useState } from "react"
import type { Form, FormAnswer, FormField } from "./types"

// Questions posées par l'agent (outil `question`) : on affiche les champs, on renvoie { clé: valeur }.
function initial(fields: FormField[]): FormAnswer {
  const a: FormAnswer = {}
  for (const f of fields) {
    if (f.default !== undefined) a[f.key] = f.default
    else if (f.type === "boolean") a[f.key] = false
    else if (f.type === "multiselect") a[f.key] = []
  }
  return a
}

export default function FormDialog(props: { form: Form; onSubmit: (a: FormAnswer) => void; onCancel: () => void }) {
  const { form } = props
  const [answer, setAnswer] = useState<FormAnswer>(() => initial(form.fields))
  const set = (key: string, v: string | number | boolean | string[]) => setAnswer((a) => ({ ...a, [key]: v }))

  const field = (f: FormField) => {
    if (f.type === "boolean")
      return (
        <label>
          <input type="checkbox" checked={answer[f.key] === true} onChange={(e) => set(f.key, e.target.checked)} /> Oui
        </label>
      )
    if (f.type === "multiselect") {
      const cur = (answer[f.key] as string[] | undefined) ?? []
      return f.options?.map((o) => (
        <label key={o.value}>
          <input
            type="checkbox"
            checked={cur.includes(o.value)}
            onChange={(e) => set(f.key, e.target.checked ? [...cur, o.value] : cur.filter((v) => v !== o.value))}
          />{" "}
          {o.label}
          {o.description && <span className="hint"> — {o.description}</span>}
        </label>
      ))
    }
    if (f.type === "number" || f.type === "integer")
      return <input type="number" value={String(answer[f.key] ?? "")} onChange={(e) => set(f.key, Number(e.target.value))} />
    if (f.type === "external") return <span className="hint">{f.url}</span>
    if (f.options?.length)
      return (
        <>
          {f.options.map((o) => (
            <label key={o.value}>
              <input type="radio" name={f.key} checked={answer[f.key] === o.value} onChange={() => set(f.key, o.value)} /> {o.label}
              {o.description && <span className="hint"> — {o.description}</span>}
            </label>
          ))}
          {f.custom && (
            <input
              type="text"
              placeholder="Autre réponse…"
              value={f.options.some((o) => o.value === answer[f.key]) ? "" : String(answer[f.key] ?? "")}
              onChange={(e) => set(f.key, e.target.value)}
            />
          )}
        </>
      )
    return <input type="text" value={String(answer[f.key] ?? "")} onChange={(e) => set(f.key, e.target.value)} />
  }

  return (
    <div className="overlay">
      <div className="dialog">
        <h3>{form.title}</h3>
        {form.fields.map((f) => (
          <div key={f.key} className="field">
            <b>{f.title ?? f.key}</b>
            {f.description && <p className="hint">{f.description}</p>}
            {field(f)}
          </div>
        ))}
        <div className="row">
          <button onClick={() => props.onSubmit(answer)}>Répondre</button>
          <button onClick={props.onCancel}>Ignorer</button>
        </div>
      </div>
    </div>
  )
}
