// Groupement des conversations par agent (v9.0.0) : sidebar et page Agents.
// Pur et testable avec Node seul (pas de React, pas de DOM).
import type { Chat } from "./types"

export type ChatGroup = { agent: string; chats: Chat[] }

/**
 * Groupe les conversations par agent :
 *  - l'agent actif (ou l'ordre d'affichage des agents) passe en premier ;
 *  - au sein d'un groupe : mise à jour décroissante ;
 *  - les conversations sans agent connu sont regroupées sous « autre » en dernier.
 */
export function groupChatsByAgent(chats: Chat[], agentIdsInOrder: string[]): ChatGroup[] {
  const known = new Map<string, Chat[]>()
  const unknown: Chat[] = []
  for (const chat of [...chats].sort((a, b) => (b.updated ?? 0) - (a.updated ?? 0))) {
    const agent = chat.agent && agentIdsInOrder.includes(chat.agent) ? chat.agent : ""
    if (!agent) unknown.push(chat)
    else if (!known.has(agent)) known.set(agent, [chat])
    else known.get(agent)!.push(chat)
  }
  const groups: ChatGroup[] = agentIdsInOrder
    .filter((id) => known.has(id))
    .map((id) => ({ agent: id, chats: known.get(id)! }))
  if (unknown.length) groups.push({ agent: "", chats: unknown })
  return groups
}
