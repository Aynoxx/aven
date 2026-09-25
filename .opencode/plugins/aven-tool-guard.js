const WINDOW_MS = 60_000
const MAX_GLOB_CALLS = 8
const MAX_IDENTICAL = 3

function stable(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`
}

export default {
  id: "aven.tool-guard",
  async setup(ctx) {
    const history = new Map()

    await ctx.tool.hook("execute.before", (event) => {
      if (String(event.tool ?? "") !== "glob") return
      const sessionID = String(event.sessionID ?? "unknown")
      const now = Date.now()
      const record = history.get(sessionID) ?? { calls: [], lastKey: "", identical: 0 }
      record.calls = record.calls.filter((time) => now - time < WINDOW_MS)
      if (record.calls.length >= MAX_GLOB_CALLS) {
        throw new Error("Aven : trop d'appels glob en une minute. Exploite les fichiers déjà trouvés et passe à read/grep ou à l'action suivante.")
      }
      const key = stable(event.input ?? {})
      record.identical = record.lastKey === key ? record.identical + 1 : 1
      record.lastKey = key
      record.calls.push(now)
      history.set(sessionID, record)
      if (record.identical >= MAX_IDENTICAL) {
        throw new Error("Aven : le même appel glob a été répété trois fois. Arrête cette recherche et exploite son résultat avec read/grep.")
      }
    })

    await ctx.tool.hook("execute.after", (event) => {
      const sessionID = String(event.sessionID ?? "unknown")
      const record = history.get(sessionID)
      if (!record) return
      if (String(event.tool ?? "") !== "glob") {
        record.identical = 0
        record.lastKey = ""
      }
      record.calls = record.calls.filter((time) => Date.now() - time < WINDOW_MS)
      if (!record.calls.length) history.delete(sessionID)
    })

    return () => history.clear()
  },
}
