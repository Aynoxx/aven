import type { Ask, Form, StreamEvent } from "./types"

// État "en direct" d'un tour de l'agent. Fonction pure : facile à tester.
export type Live = {
  busy: boolean
  order: string[] // IDs des messages assistant, dans l'ordre d'apparition
  texts: Record<string, { text: string; child: boolean }>
  tools: Record<string, { name: string; status: "running" | "completed" | "error"; child: boolean }>
  asks: Ask[]
  forms: Form[] // questions posées par l'agent (outil `question`)
  error?: string
}

export const emptyLive: Live = { busy: false, order: [], texts: {}, tools: {}, asks: [], forms: [] }

export function applyEvent(live: Live, ev: StreamEvent): { live: Live; finished: boolean } {
  const d = ev.data
  switch (ev.type) {
    case "session.execution.started":
      if (ev.child) return { live, finished: false }
      return { live: { ...live, busy: true, error: undefined }, finished: false }

    case "session.text.delta": {
      const id = String(d.assistantMessageID)
      const prev = live.texts[id]
      return {
        live: {
          ...live,
          order: prev ? live.order : [...live.order, id],
          texts: { ...live.texts, [id]: { text: (prev?.text ?? "") + String(d.delta), child: ev.child } },
        },
        finished: false,
      }
    }

    case "session.tool.input.started":
      return {
        live: {
          ...live,
          tools: { ...live.tools, [String(d.id)]: { name: String(d.name), status: "running", child: ev.child } },
        },
        finished: false,
      }

    case "session.tool.success":
    case "session.tool.failed": {
      const id = String(d.id)
      const prev = live.tools[id] ?? { name: "outil", status: "running" as const, child: ev.child }
      const status = ev.type === "session.tool.success" ? "completed" : "error"
      return { live: { ...live, tools: { ...live.tools, [id]: { ...prev, status } } }, finished: false }
    }

    case "permission.asked":
      return {
        live: {
          ...live,
          asks: [
            ...live.asks,
            {
              id: String(d.id),
              sessionID: String(d.sessionID),
              action: String(d.action),
              resources: (d.resources as string[]) ?? [],
              message: d.message as string | undefined,
            },
          ],
        },
        finished: false,
      }

    case "permission.replied":
      return { live: { ...live, asks: live.asks.filter((a) => a.id !== d.requestID) }, finished: false }

    case "form.created": {
      const f = d.form as Form
      return { live: { ...live, forms: [...live.forms, f] }, finished: false }
    }

    case "form.replied":
    case "form.cancelled":
      return { live: { ...live, forms: live.forms.filter((f) => f.id !== d.id) }, finished: false }

    // Fin du tour : uniquement pour la session principale (un sous-agent qui finit ne termine pas le tour).
    case "session.execution.succeeded":
    case "session.execution.interrupted":
      if (ev.child) return { live, finished: false }
      return { live: { ...live, busy: false }, finished: true }

    case "session.execution.failed":
      if (ev.child) return { live, finished: false }
      return { live: { ...live, busy: false, error: d.error?.message ?? "Erreur inconnue" }, finished: true }

    default:
      return { live, finished: false }
  }
}
