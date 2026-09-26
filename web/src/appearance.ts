import { useEffect, useState } from "react"

export type Theme = "system" | "dark" | "light"
export type Accent = "violet" | "blue" | "emerald" | "rose" | "amber" | "custom"
export type Density = "compact" | "comfortable"
export type SidebarPosition = "left" | "right"

export type BlockId = "messages" | "notices" | "model" | "composer"

export type AppearanceConfig = {
  theme: Theme
  accent: Accent
  density: Density
  sidebarPosition: SidebarPosition
  sidebarWidth: number
  messageWidth: number
  showHeader: boolean
  showSidebar: boolean
  showModel: boolean
  showNotices: boolean
  showToolActivity: boolean
  showComposer: boolean
  mainOrder: BlockId[]
  agentOrder: string[]
  customAccent: string // couleur libre, utilisée quand accent === "custom"
  voiceAnnouncements: boolean // annonceur vocal SAPI des événements d'agent (v8.7.9)
  chatsGroupedByAgent: boolean // v9.0.0 : sidebar montrant les conversations de tous les agents, groupées
  freebuffAsEngine: boolean // v9.1.0 : Freebuff (SDK Codebuff) moteur de TOUS les agents quand la clé existe
}

export const APPEARANCE_KEY = "aven.appearance.v3"
const LEGACY_APPEARANCE_KEY = "opencodeapp.appearance.v2"

export const defaultAppearance: AppearanceConfig = {
  theme: "light",
  accent: "emerald",
  density: "comfortable",
  sidebarPosition: "left",
  sidebarWidth: 286,
  messageWidth: 860,
  showHeader: false,
  showSidebar: false,
  showModel: true,
  showNotices: true,
  showToolActivity: true,
  showComposer: true,
  mainOrder: ["messages", "notices", "model", "composer"],
  agentOrder: [],
  customAccent: "#8b5cf6",
  voiceAnnouncements: false, // annonceur vocal : désactivé par défaut (choix explicite)
  chatsGroupedByAgent: true, // v9.0.0 : conversations groupées par agent dans la sidebar
  freebuffAsEngine: true, // v9.1.0 : actif par défaut — ne s'applique que si la clé Codebuff existe
}

export const presetAccents: Record<Exclude<Accent, "custom">, { label: string; value: string }> = {
  violet: { label: "Violet", value: "#8b5cf6" },
  blue: { label: "Bleu", value: "#3b82f6" },
  emerald: { label: "Émeraude", value: "#10b981" },
  rose: { label: "Rose", value: "#f43f5e" },
  amber: { label: "Ambre", value: "#f59e0b" },
}

/** Couleur effective de l'accent, presets ou libre. */
export function accentColor(a: Pick<AppearanceConfig, "accent" | "customAccent">): string {
  return a.accent === "custom" ? a.customAccent : presetAccents[a.accent].value
}

function sanitize(input: Partial<AppearanceConfig> | null | undefined): AppearanceConfig {
  const out = { ...defaultAppearance, ...input }
  const validBlocks: BlockId[] = ["messages", "notices", "model", "composer"]
  const mainOrder = Array.isArray(input?.mainOrder)
    ? [...new Set(input.mainOrder.filter((id): id is BlockId => validBlocks.includes(id as BlockId)))]
    : []
  for (const block of validBlocks) if (!mainOrder.includes(block)) mainOrder.push(block)

  return {
    ...out,
    sidebarWidth: Math.min(420, Math.max(240, Number(out.sidebarWidth) || defaultAppearance.sidebarWidth)),
    messageWidth: Math.min(1100, Math.max(560, Number(out.messageWidth) || defaultAppearance.messageWidth)),
    mainOrder,
    agentOrder: Array.isArray(input?.agentOrder) ? [...new Set(input.agentOrder.filter((x) => typeof x === "string"))] : [],
    customAccent: /^#[0-9a-fA-F]{6}$/.test(String(out.customAccent)) ? out.customAccent : defaultAppearance.customAccent,
    voiceAnnouncements: typeof input?.voiceAnnouncements === "boolean" ? input.voiceAnnouncements : defaultAppearance.voiceAnnouncements,
    chatsGroupedByAgent: typeof input?.chatsGroupedByAgent === "boolean" ? input.chatsGroupedByAgent : defaultAppearance.chatsGroupedByAgent,
    // v9.1.0 : remplace freebuffDefaultCode (moteur de tous les agents). L'ancienne valeur
    // est reprise à la lecture pour ne pas perdre le choix de l'utilisateur.
    freebuffAsEngine: typeof input?.freebuffAsEngine === "boolean"
      ? input.freebuffAsEngine
      : typeof (input as Record<string, unknown> | undefined)?.freebuffDefaultCode === "boolean"
        ? (input as unknown as { freebuffDefaultCode: boolean }).freebuffDefaultCode
        : defaultAppearance.freebuffAsEngine,
  }
}

export function readAppearance(): AppearanceConfig {
  try {
    const current = localStorage.getItem(APPEARANCE_KEY)
    const legacy = current ? null : localStorage.getItem(LEGACY_APPEARANCE_KEY)
    const value = sanitize(current || legacy ? JSON.parse(current || legacy || "null") : null)
    if (!current && legacy) localStorage.setItem(APPEARANCE_KEY, JSON.stringify(value))
    return value
  } catch {
    return defaultAppearance
  }
}

export function saveAppearance(value: AppearanceConfig) {
  localStorage.setItem(APPEARANCE_KEY, JSON.stringify(value))
}

export function useAppearance() {
  const [appearance, setAppearance] = useState<AppearanceConfig>(() => readAppearance())

  useEffect(() => {
    saveAppearance(appearance)
    const root = document.documentElement
    const isDark = appearance.theme === "dark" ||
      (appearance.theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches)
    root.dataset.theme = isDark ? "dark" : "light"
    root.style.setProperty("--accent", accentColor(appearance))
    root.style.setProperty("--sidebar-width", `${appearance.sidebarWidth}px`)
    root.style.setProperty("--message-width", `${appearance.messageWidth}px`)
    root.style.setProperty("--density-gap", appearance.density === "compact" ? "8px" : "14px")
    root.style.setProperty("--density-pad", appearance.density === "compact" ? "10px" : "16px")
  }, [appearance])

  useEffect(() => {
    if (appearance.theme !== "system") return
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    const update = () => {
      document.documentElement.dataset.theme = media.matches ? "dark" : "light"
    }
    media.addEventListener("change", update)
    return () => media.removeEventListener("change", update)
  }, [appearance.theme])

  const update = (patch: Partial<AppearanceConfig>) => setAppearance((current) => sanitize({ ...current, ...patch }))
  const reset = () => setAppearance(defaultAppearance)

  return { appearance, updateAppearance: update, resetAppearance: reset }
}
