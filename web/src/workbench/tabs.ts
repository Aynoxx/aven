// v11.0.0 : modèle d'onglets du « Poste ». Pur : testable avec Node seul, sans Tauri.
//
// Un instrument unique (Aujourd'hui, Notes, Fichiers, Terminal, Orchestration,
// Réglages) n'a qu'un onglet ; une conversation peut en avoir plusieurs. Aujourd'hui
// est toujours le premier onglet et ne se ferme pas — c'est le retour stable du Poste.

export type InstrumentKind =
  | "home"
  | "conversation"
  | "notes"
  | "files"
  | "terminal"
  | "orchestration"
  | "settings"

export type WorkbenchTab = {
  id: string
  kind: InstrumentKind
  // Conversation uniquement. Vide = onglet de conversation sans session encore choisie.
  chatId?: string
  // Agent propriétaire de la conversation (permet de revenir sur un onglet d'un
  // autre agent sans deviner depuis la liste courante).
  agent?: string
}

export type TabsState = {
  tabs: WorkbenchTab[]
  activeId: string
}

export const MAX_CONVERSATION_TABS = 8

let conversationSeq = 0

export function nextConversationTabId(): string {
  conversationSeq += 1
  return `conv-${conversationSeq}`
}

export function initialTabs(): TabsState {
  return { tabs: [{ id: "home", kind: "home" }], activeId: "home" }
}

export function activeTab(state: TabsState): WorkbenchTab {
  return state.tabs.find((t) => t.id === state.activeId) ?? state.tabs[0]
}

function focus(state: TabsState, id: string): TabsState {
  if (!state.tabs.some((t) => t.id === id)) return state
  return { ...state, activeId: id }
}

export function focusTab(state: TabsState, id: string): TabsState {
  return focus(state, id)
}

export function openInstrument(state: TabsState, kind: InstrumentKind): TabsState {
  const existing = state.tabs.find((t) => t.kind === kind)
  if (existing) return { ...state, activeId: existing.id }
  const tab: WorkbenchTab = { id: kind, kind }
  return { tabs: [...state.tabs, tab], activeId: tab.id }
}

export function openConversation(state: TabsState, chatId?: string, id?: string, agent?: string): TabsState {
  if (chatId) {
    const existing = state.tabs.find((t) => t.kind === "conversation" && t.chatId === chatId)
    if (existing) return { ...state, activeId: existing.id }
  }
  // Un onglet de conversation vide (draft) déjà actif est réutilisé au lieu d'en empiler un.
  const empty = state.tabs.find((t) => t.kind === "conversation" && !t.chatId)
  if (empty) {
    const tabs = state.tabs.map((t) => (t.id === empty.id ? { ...t, chatId: chatId || t.chatId, agent: agent ?? t.agent } : t))
    return { tabs, activeId: empty.id }
  }
  const tab: WorkbenchTab = { id: id ?? nextConversationTabId(), kind: "conversation", chatId, agent }
  const conversations = state.tabs.filter((t) => t.kind === "conversation")
  let tabs = [...state.tabs, tab]
  if (conversations.length >= MAX_CONVERSATION_TABS) {
    // Ferme la plus ancienne conversation inactive pour borner la barre d'onglets.
    const victim = state.tabs.find((t) => t.kind === "conversation" && t.id !== state.activeId)
    if (victim) tabs = tabs.filter((t) => t.id !== victim.id)
  }
  return { tabs, activeId: tab.id }
}

export function openConversationDraft(state: TabsState): TabsState {
  return openConversation(state)
}

export function closeTab(state: TabsState, id: string): TabsState {
  const index = state.tabs.findIndex((t) => t.id === id)
  if (index < 0) return state
  const tab = state.tabs[index]
  if (tab.kind === "home") return state // Aujourd'hui est le plancher du Poste.
  const tabs = state.tabs.filter((t) => t.id !== id)
  if (state.activeId !== id) return { ...state, tabs }
  const next = tabs[Math.min(index, tabs.length - 1)] ?? tabs[0]
  return { tabs, activeId: next.id }
}

// Rattache une session à l'onglet de conversation actif. Si un autre onglet porte
// déjà cette conversation, il prend le focus et le doublon vide disparaît.
export function bindChat(state: TabsState, chatId: string, agent?: string): TabsState {
  if (!chatId) return state
  const existing = state.tabs.find((t) => t.kind === "conversation" && t.chatId === chatId)
  const active = activeTab(state)
  if (active.kind !== "conversation") return state
  if (existing && existing.id !== active.id) {
    const tabs = state.tabs.filter((t) => t.id !== active.id || active.chatId)
    return { tabs, activeId: existing.id }
  }
  const tabs = state.tabs.map((t) => (t.id === active.id ? { ...t, chatId, agent: agent ?? t.agent } : t))
  return { tabs, activeId: active.id }
}

export function clearActiveChat(state: TabsState): TabsState {
  const active = activeTab(state)
  if (active.kind !== "conversation") return state
  const tabs = state.tabs.map((t) => (t.id === active.id ? { ...t, chatId: undefined } : t))
  return { tabs, activeId: active.id }
}

// Retire l'onglet d'une conversation supprimée ; le voisin devient actif.
// v11.14.1 : ce n'était vrai que si aucune conversation ne restait. Supprimer la
// conversation OUVERTE fermait son onglet et rendait le dernier onglet voisin
// (Notes, Aujourd'hui…), alors qu'une autre conversation était toujours là.
// `next` est la conversation qui prend sa place : le MÊME onglet se rattache à
// elle, ou son onglet déjà ouvert prend le focus et l'onglet vidé disparaît.
export function removeChatTab(
  state: TabsState,
  chatId: string,
  next?: { chatId: string; agent?: string } | null,
): TabsState {
  const tab = state.tabs.find((t) => t.kind === "conversation" && t.chatId === chatId)
  if (!tab) return state
  if (state.activeId !== tab.id) return { ...state, tabs: state.tabs.filter((t) => t.id !== tab.id) }
  const nextId = next?.chatId
  if (nextId && nextId !== chatId) {
    const existing = state.tabs.find((t) => t.kind === "conversation" && t.chatId === nextId)
    if (existing && existing.id !== tab.id) {
      return { tabs: state.tabs.filter((t) => t.id !== tab.id), activeId: existing.id }
    }
    const tabs = state.tabs.map((t) => (t.id === tab.id ? { ...t, chatId: nextId, agent: next?.agent ?? t.agent } : t))
    return { tabs, activeId: tab.id }
  }
  return closeTab(state, tab.id)
}

// v11.0.0 : navigation clavier HORIZONTALE de la barre d'onglets (rôle tablist) —
// flèches avec bouclage, Home/End. Pure, donc testable sans DOM (AGENTS.md §8,
// même contrat que arrow-navigation.ts pour les listes verticales).
export function nextTabFocus(key: string, current: number, count: number): number | null {
  if (count <= 0) return null
  switch (key) {
    case "ArrowRight":
      return current < 0 || current >= count - 1 ? 0 : current + 1
    case "ArrowLeft":
      return current < 0 || current <= 0 ? count - 1 : current - 1
    case "Home":
      return 0
    case "End":
      return count - 1
    default:
      return null
  }
}
