// Fournisseurs utilisés par Aven en mode strictement gratuit.
// Le fournisseur vocal Live (retiré en v8.7.7) n'existe plus. Groq (v8.7.8) sert
// exclusivement à la dictée vocale : transcription Whisper + passe de reformage.
export type ProviderInfo = { id: string; label: string; env: string; url: string; note: string; openCodeEnv?: boolean }

export const PROVIDERS: ProviderInfo[] = [
  { id: "openrouter", label: "OpenRouter Free", env: "OPENROUTER_API_KEY", url: "https://openrouter.ai/keys", note: "Accès au catalogue gratuit OpenRouter. Les variantes :free sont à 0 $ ; quotas du plan Free appliqués par OpenRouter." },
  { id: "codebuff", label: "Freebuff / Codebuff SDK", env: "CODEBUFF_API_KEY", url: "https://www.codebuff.com/api-keys", note: "Backend Freebuff intégré par le SDK officiel Codebuff. Optionnel : ce SDK peut consommer des crédits Codebuff ; ce n’est pas le client Freebuff gratuit ad-supported.", openCodeEnv: false },
  { id: "groq", label: "Groq (dictée vocale)", env: "GROQ_API_KEY", url: "https://console.groq.com/keys", note: "Dicter dans le composeur (bouton micro ou Ctrl+Maj+V). Transcription Whisper + reformage côté Groq ; le texte reste modifiable avant envoi. Free tier : ~2 000 transcriptions/jour.", openCodeEnv: false },
]
export type OpenRouterKeyProbe =
  | { status: "valid" }
  | { status: "invalid"; message: string }
  | { status: "unknown"; message: string }

/** Vérifie une clé OpenRouter sans envoyer de génération. */
export async function probeOpenRouterKey(key: string): Promise<OpenRouterKeyProbe> {
  const clean = key.trim()
  if (!clean) return { status: "invalid", message: "Clé OpenRouter vide." }
  try {
    const response = await fetch("https://openrouter.ai/api/v1/auth/key", {
      method: "GET",
      headers: { Authorization: `Bearer ${clean}`, Accept: "application/json" },
      signal: AbortSignal.timeout(5000),
    })
    if (response.ok) return { status: "valid" }
    let detail = ""
    try {
      const body = (await response.json()) as { error?: { message?: string }; message?: string }
      detail = String(body.error?.message ?? body.message ?? "").trim()
    } catch { /* réponse non JSON */ }
    return { status: "invalid", message: detail || `OpenRouter a refusé la clé (HTTP ${response.status}).` }
  } catch (error) {
    return { status: "unknown", message: `OpenRouter n'est pas joignable pour le test : ${error instanceof Error ? error.message : String(error)}` }
  }
}
