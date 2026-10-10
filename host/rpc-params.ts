// JSON-RPC permits positional arrays and named objects. The Rust host sends
// every call with `params: Vec<Value>`, so a single object argument arrives as
// `[{...}]`; normalize it at the app-host boundary instead of reading it as
// a direct object (which silently turns workspace into ".").
export function rpcObjectParam<T extends object>(params: unknown): T {
  const value = Array.isArray(params) ? params[0] : params
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Paramètre objet JSON-RPC absent ou invalide.")
  }
  return value as T
}
