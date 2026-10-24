// v11.0.0 : cinq verbes universels du Poste — la liaison entre les features.
// Pur : aucune dépendance DOM, aucun IPC. Un plan dit ce qu'il faut FAIRE, jamais
// ce qui part tout seul : « transmettre » prépare le composeur, il n'envoie pas.

export type ObjectKind = "message" | "note" | "file" | "terminal"

export type Verb = "transmit" | "cite" | "terminal" | "pin" | "copy"

export type WorkbenchObject = {
  kind: ObjectKind
  id?: string
  title?: string
  body?: string
  path?: string
}

export type TransferPlan =
  | { mode: "compose"; text: string } // prépare le composeur, l'utilisateur relit et envoie
  | { mode: "clipboard"; text: string }
  | { mode: "note"; text: string } // prépare une nouvelle note
  | { mode: "terminal"; text: string }
  | { mode: "pin"; id: string }

export const VERB_LABELS: Record<Verb, string> = {
  transmit: "Transmettre à l’agent",
  cite: "Citer dans une note",
  terminal: "Ouvrir dans le terminal",
  pin: "Épingler",
  copy: "Copier",
}

const CAPABILITIES: Record<ObjectKind, Verb[]> = {
  message: ["transmit", "cite", "terminal", "copy"],
  note: ["transmit", "terminal", "pin", "copy"],
  file: ["transmit", "terminal", "copy"],
  terminal: ["transmit", "cite", "copy"],
}

export function verbsFor(kind: ObjectKind): Verb[] {
  return CAPABILITIES[kind]
}

function quote(body: string): string {
  return body
    .split(/\r?\n/)
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n")
}

export function planFor(verb: Verb, object: WorkbenchObject): TransferPlan | null {
  if (!verbsFor(object.kind).includes(verb)) return null
  const title = object.title?.trim() || object.path || object.id || "sans titre"
  const body = object.body?.trim() ?? ""

  switch (verb) {
    case "transmit":
      if (object.kind === "file") {
        return {
          mode: "compose",
          text: `Analyse le fichier « ${object.path ?? title} » de l'espace et explique-moi ce qu'il contient.`,
        }
      }
      return { mode: "compose", text: body ? `${body}` : title }

    case "cite":
      if (!body) return null
      return { mode: "note", text: `${quote(body)}\n\n— ${title}` }

    case "terminal":
      if (object.kind === "file") return { mode: "terminal", text: object.path ?? title }
      return { mode: "terminal", text: body || title }

    case "pin":
      if (object.kind !== "note" || !object.id) return null
      return { mode: "pin", id: object.id }

    case "copy":
      return { mode: "clipboard", text: body || title }
  }
}
