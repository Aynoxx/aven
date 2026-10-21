// Pur : testable avec Node seul, sans dépendance desktop.
// v10.3.1 : encres d'ACCENT (revue apple-design §4 P1). L'accent servait à la fois
// de remplissage et d'ENCRE : blanc sur Émeraude = 2,54:1, accent en texte = 2,32:1
// sur `--bg` clair — illisible sur 27 déclarations. On calcule donc, par preset :
//   · `inkLight`/`inkDark` — l'accent assombri (thème clair) ou éclairci (thème
//     sombre) juste assez pour atteindre 4,5:1 sur la surface pleine du thème ;
//   · `fill`+`onFill` — la teinte réellement peinte et l'encre qui vit dessus
//     (blanc ou encre sombre, selon la luminance de l'accent), la teinte n'étant
//     retouchée QUE si aucune des deux encres n'atteint le seuil.
// Le calcul vit ici (fonction pure, testée) et `appearance.ts` ne fait que poser
// les variables — aucune couleur décidée au fond d'un handler.

export type Rgb = { r: number; g: number; b: number }

export type AccentInks = {
  /** Remplissage à peindre sous `onFill` (accent, retouché seulement si nécessaire). */
  fill: string
  /** Variante de survol : elle s'éloigne de l'encre, donc ne PERD jamais de contraste. */
  fillHover: string
  /** Encre lisible posée sur `fill`. */
  onFill: string
  /** Accent utilisable comme encre (texte/icône) sur les surfaces du thème clair. */
  inkLight: string
  /** Idem sur les surfaces du thème sombre. */
  inkDark: string
}

/** Encre sombre de référence : celle du texte principal en thème clair. */
export const DARK_INK = "#0b0d12"
export const WHITE = "#ffffff"
/** Surfaces pleines des deux thèmes (`--panel-solid` dans App.css). */
export const LIGHT_SURFACE = "#ffffff"
export const DARK_SURFACE = "#12151d"
/**
 * Surfaces sous `--accent-soft` : `--panel-soft` de chaque thème (App.css). C'est
 * cette teinte-là qui décide de l'encre — elle est plus sombre que le blanc en
 * clair, et plus claire que le panneau en sombre : le cas le plus défavorable.
 */
export const LIGHT_SOFT_BACKDROP = "#eef0f6"
export const DARK_SOFT_BACKDROP = "#171b24"
/** Seuil WCAG AA du texte courant ; les sondes vérifient 4,5:1. */
export const MIN_CONTRAST = 4.5
/** Part de l'accent dans `--accent-soft` (App.css : 12 % clair, 16 % sombre). */
export const SOFT_SHARE_LIGHT = 0.12
export const SOFT_SHARE_DARK = 0.16
/**
 * Marge interne : l'encre est calibrée sur la surface la PLUS défavorable —
 * `--accent-soft` (une teinte de l'accent lui-même), pas sur le blanc pur.
 * 5,0:1 y laisse ~5,3:1 sur `--panel-solid` et de la place pour l'arrondi.
 */
const TARGET_CONTRAST = MIN_CONTRAST + 0.5

export function parseHex(hex: string): Rgb | null {
  const match = /^#?([0-9a-fA-F]{6})$/.exec(String(hex ?? "").trim())
  if (!match) return null
  const value = parseInt(match[1], 16)
  return { r: (value >> 16) & 255, g: (value >> 8) & 255, b: value & 255 }
}

export function toHex({ r, g, b }: Rgb): string {
  const channel = (v: number) => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, "0")
  return `#${channel(r)}${channel(g)}${channel(b)}`
}

/** Mélange sRGB par canal — même résultat que `color-mix(in srgb, …)`. */
export function blend(from: string, to: string, t: number): string {
  const a = parseHex(from)
  const b = parseHex(to)
  if (!a || !b) return from
  const share = Math.min(1, Math.max(0, t))
  return toHex({
    r: a.r * (1 - share) + b.r * share,
    g: a.g * (1 - share) + b.g * share,
    b: a.b * (1 - share) + b.b * share,
  })
}

/** Surface telle que `--accent-soft` la compose : `share` d'accent sur `surface`. */
export function softSurface(accent: string, surface: string, share: number): string {
  return blend(accent, surface, 1 - share)
}

/** Luminance relative WCAG 2.1. */
export function relativeLuminance(color: string): number {
  const rgb = parseHex(color)
  if (!rgb) return 0
  const linear = [rgb.r, rgb.g, rgb.b].map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}

/** Encre qui atteint le seuil sur `surface`, en rapprochant `base` de `toward` par pas de 5 %. */
export function readableInk(base: string, toward: string, surface: string): string {
  const start = parseHex(base) ? toHex(parseHex(base)!) : DARK_INK
  if (contrastRatio(start, surface) >= TARGET_CONTRAST) return start
  for (let step = 1; step <= 19; step += 1) {
    const candidate = blend(start, toward, step * 0.05)
    if (contrastRatio(candidate, surface) >= TARGET_CONTRAST) return candidate
  }
  return toward
}

/** Meilleure encre pour `fill`, ou `null` si ni blanc ni encre sombre n'atteint le seuil. */
function inkFor(fill: string): { ink: string; ratio: number } | null {
  const options = [
    { ink: WHITE, ratio: contrastRatio(WHITE, fill) },
    { ink: DARK_INK, ratio: contrastRatio(DARK_INK, fill) },
  ].sort((a, b) => b.ratio - a.ratio)
  const best = options[0]
  return best.ratio >= TARGET_CONTRAST ? best : null
}

/**
 * Encres et remplissage d'un accent quelconque (preset ou couleur libre).
 * Un accent valide ne change jamais de teinte : seules les encres bougent —
 * sauf si l'accent est si saturé qu'aucune encre ne passe (rare, couleur libre).
 */
export function accentInks(accent: string): AccentInks {
  const base = parseHex(accent) ? toHex(parseHex(accent)!) : "#8b5cf6"
  // L'encre d'accent se pose souvent SUR une teinte de l'accent (badges, lignes
  // sélectionnées, icônes de carte) : c'est cette surface-là qui décide du seuil.
  const inkLight = readableInk(base, DARK_INK, softSurface(base, LIGHT_SOFT_BACKDROP, SOFT_SHARE_LIGHT))
  const inkDark = readableInk(base, WHITE, softSurface(base, DARK_SOFT_BACKDROP, SOFT_SHARE_DARK))

  const direct = inkFor(base)
  if (direct) return withHover(base, direct.ink, inkLight, inkDark)

  // Aucune encre ne passe sur la teinte exacte : on retouche le REMPLISSAGE, pas la
  // teinte perçue. On assombrit d'abord (l'encre blanche reste la convention d'un
  // remplissage accent — Violet est le seul preset concerné : ~10 % de noir), puis
  // on éclaircit seulement si l'assombrissement ne suffit pas (couleur libre très claire).
  for (let step = 1; step <= 20; step += 1) {
    const candidate = blend(base, "#000000", step * 0.02)
    if (contrastRatio(WHITE, candidate) >= TARGET_CONTRAST) {
      return withHover(candidate, WHITE, inkLight, inkDark)
    }
  }
  for (let step = 1; step <= 20; step += 1) {
    const candidate = blend(base, WHITE, step * 0.02)
    if (contrastRatio(DARK_INK, candidate) >= TARGET_CONTRAST) {
      return withHover(candidate, DARK_INK, inkLight, inkDark)
    }
  }
  const fallbackInk = contrastRatio(WHITE, base) >= contrastRatio(DARK_INK, base) ? WHITE : DARK_INK
  return withHover(base, fallbackInk, inkLight, inkDark)
}

/**
 * Complète la paire avec son survol. Le survol s'éloigne TOUJOURS de l'encre
 * (éclaircit sous une encre sombre, assombrit sous une encre blanche) : un survol
 * qui éclaircit un remplissage à encre blanche faisait perdre le seuil (2,29:1).
 */
function withHover(fill: string, onFill: string, inkLight: string, inkDark: string): AccentInks {
  const fillHover = onFill === WHITE ? blend(fill, "#000000", 0.08) : blend(fill, WHITE, 0.08)
  return { fill, fillHover, onFill, inkLight, inkDark }
}
