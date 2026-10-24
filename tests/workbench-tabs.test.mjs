import assert from "node:assert/strict"
import { test } from "node:test"
import {
  bindChat,
  closeTab,
  focusTab,
  initialTabs,
  MAX_CONVERSATION_TABS,
  nextTabFocus,
  openConversation,
  openInstrument,
  removeChatTab,
} from "../web/src/workbench/tabs.ts"

test("initialTabs : Aujourd'hui est le plancher du Poste", () => {
  const state = initialTabs()
  assert.equal(state.activeId, "home")
  assert.deepEqual(state.tabs.map((t) => t.kind), ["home"])
})

test("openInstrument : un instrument unique ne s'empile pas", () => {
  let state = initialTabs()
  state = openInstrument(state, "notes")
  state = openInstrument(state, "files")
  state = openInstrument(state, "notes")
  assert.equal(state.tabs.filter((t) => t.kind === "notes").length, 1)
  assert.equal(state.activeId, "notes")
})

test("openConversation : la même conversation reprend son onglet", () => {
  let state = openInstrument(initialTabs(), "home")
  state = openConversation(state, "chat-a", "conv-a")
  state = openConversation(state, "chat-b", "conv-b")
  state = openConversation(state, "chat-a", "conv-ignore")
  assert.equal(state.tabs.filter((t) => t.kind === "conversation").length, 2)
  assert.equal(state.activeId, "conv-a")
})

test("openConversation : un onglet vide est réutilisé au lieu d'être empilé", () => {
  let state = openConversation(initialTabs(), undefined, "conv-draft")
  assert.equal(state.tabs.filter((t) => t.kind === "conversation").length, 1)
  state = openConversation(state, "chat-a", "conv-other")
  assert.equal(state.tabs.filter((t) => t.kind === "conversation").length, 1)
  assert.equal(state.tabs.find((t) => t.kind === "conversation")?.chatId, "chat-a")
})

test("openConversation : plafond de conversations, la plus ancienne inactive tombe", () => {
  let state = initialTabs()
  for (let i = 0; i < MAX_CONVERSATION_TABS; i += 1) {
    state = openConversation(state, `chat-${i}`, `conv-${i}`)
  }
  assert.equal(state.tabs.filter((t) => t.kind === "conversation").length, MAX_CONVERSATION_TABS)
  state = openConversation(state, "chat-new", "conv-new")
  assert.equal(state.tabs.filter((t) => t.kind === "conversation").length, MAX_CONVERSATION_TABS)
  assert.equal(state.tabs.some((t) => t.chatId === "chat-0"), false)
})

test("closeTab : Aujourd'hui ne se ferme pas, le voisin prend le focus", () => {
  let state = openConversation(initialTabs(), "chat-a", "conv-a")
  state = openInstrument(state, "notes")
  state = closeTab(state, "notes")
  assert.equal(state.activeId, "conv-a")

  state = closeTab(state, "home")
  assert.equal(state.tabs.some((t) => t.kind === "home"), true)

  state = closeTab(state, "conv-a")
  assert.equal(state.activeId, "home")
})

test("closeTab : fermer un onglet inactif ne change pas le focus", () => {
  let state = openConversation(initialTabs(), "chat-a", "conv-a")
  state = openConversation(state, "chat-b", "conv-b")
  state = focusTab(state, "conv-a")
  state = closeTab(state, "conv-b")
  assert.equal(state.activeId, "conv-a")
})

test("bindChat : rattache la session à l'onglet actif, sans doublon", () => {
  let state = openConversation(initialTabs(), undefined, "conv-draft")
  state = bindChat(state, "chat-a")
  assert.equal(state.tabs.find((t) => t.id === "conv-draft")?.chatId, "chat-a")

  state = openConversation(state, "chat-b", "conv-b")
  state = closeTab(state, "conv-b")
  // Un onglet existant portant déjà la session reprend le focus.
  state = bindChat({ ...state, activeId: "conv-draft" }, "chat-a")
  assert.equal(state.activeId, "conv-draft")
})

test("removeChatTab : la conversation supprimée emporte son onglet", () => {
  let state = openConversation(initialTabs(), "chat-a", "conv-a")
  state = openConversation(state, "chat-b", "conv-b")
  state = removeChatTab(state, "chat-b")
  assert.equal(state.tabs.some((t) => t.chatId === "chat-b"), false)
  assert.equal(state.activeId, "conv-a")
})

// v11.0.0 : le tablist se pilote aux flèches horizontales, avec Home/End.
test("nextTabFocus : flèches horizontales avec bouclage, Home/End", () => {
  assert.equal(nextTabFocus("ArrowRight", 0, 3), 1)
  assert.equal(nextTabFocus("ArrowRight", 2, 3), 0)
  assert.equal(nextTabFocus("ArrowLeft", 0, 3), 2)
  assert.equal(nextTabFocus("ArrowLeft", 1, 3), 0)
  assert.equal(nextTabFocus("Home", 2, 3), 0)
  assert.equal(nextTabFocus("End", 0, 3), 2)
  assert.equal(nextTabFocus("ArrowDown", 0, 3), null)
  assert.equal(nextTabFocus("ArrowRight", -1, 0), null)
})
