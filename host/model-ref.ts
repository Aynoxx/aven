// Références de modèles « fournisseur/modèle » : le modèle peut contenir des « / »
// (ex. groq/openai/gpt-oss-120b), on coupe donc toujours au PREMIER « / ».
// Un seul utilitaire partagé (avant : dupliqué entre router.ts, operations.ts et le server/ historique).

export type ModelRef = { providerID: string; id: string }

export function parseRef(ref: string): ModelRef {
  const [providerID, ...rest] = ref.split("/")
  return { providerID, id: rest.join("/") }
}

export function refOf(m?: ModelRef): string | undefined {
  return m ? `${m.providerID}/${m.id}` : undefined
}
