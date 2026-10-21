import assert from "node:assert/strict"
import { test } from "node:test"
import {
  accentInks,
  blend,
  contrastRatio,
  MIN_CONTRAST,
  softSurface,
  SOFT_SHARE_DARK,
  SOFT_SHARE_LIGHT,
  LIGHT_SOFT_BACKDROP,
  DARK_SOFT_BACKDROP,
  LIGHT_SURFACE,
  DARK_SURFACE,
} from "../web/src/accent-contrast.ts"

// Contrat de la revue apple-design §4 P1 (v10.3.1) : l'accent ne sert plus d'encre
// à l'aveugle. Blanc sur Émeraude mesurait 2,54:1 ; l'accent en texte 2,32:1 sur
// --bg clair. On vérifie ici les VRAIES valeurs produites par le module, pour les
// cinq presets, sur les surfaces réelles (panneau, --bg, et surtout --accent-soft).

const PRESETS = {
  violet: "#8b5cf6",
  blue: "#3b82f6",
  emerald: "#10b981",
  rose: "#f43f5e",
  amber: "#f59e0b",
}

// --bg = accent 6 % + #fbfbfd (clair) / 14 % + #05060a (sombre), cf. App.css.
const lightBg = (accent) => blend(accent, "#fbfbfd", 0.94)
const darkBg = (accent) => blend(accent, "#05060a", 0.86)
const lightSoft = (accent) => softSurface(accent, LIGHT_SOFT_BACKDROP, SOFT_SHARE_LIGHT)
const darkSoft = (accent) => softSurface(accent, DARK_SOFT_BACKDROP, SOFT_SHARE_DARK)

test("contrastRatio : repères WCAG", () => {
  assert.equal(Math.round(contrastRatio("#000000", "#ffffff")), 21)
  assert.equal(contrastRatio("#ffffff", "#ffffff"), 1)
  // Le défaut mesuré par la revue : blanc sur l'accent Émeraude.
  const before = contrastRatio("#ffffff", "#10b981")
  assert.ok(before < 3 && before > 2.4, `blanc sur Émeraude = ${before.toFixed(2)}:1 (le défaut corrigé)`)
})

test("accentInks : l'encre posée sur le remplissage tient 4,5:1 pour les 5 presets", () => {
  for (const [name, accent] of Object.entries(PRESETS)) {
    const { fill, onFill } = accentInks(accent)
    const ratio = contrastRatio(onFill, fill)
    assert.ok(ratio >= MIN_CONTRAST, `${name} : encre sur remplissage ${ratio.toFixed(2)}:1 (≥ 4,5 exigé)`)
  }
})

test("accentInks : l'encre d'accent tient 4,5:1 sur les surfaces des DEUX thèmes", () => {
  for (const [name, accent] of Object.entries(PRESETS)) {
    const { inkLight, inkDark } = accentInks(accent)
    for (const [label, surface] of [
      ["panneau clair", LIGHT_SURFACE],
      ["--bg clair", lightBg(accent)],
      ["--accent-soft clair", lightSoft(accent)],
    ]) {
      const ratio = contrastRatio(inkLight, surface)
      assert.ok(ratio >= MIN_CONTRAST, `${name} : encre claire sur ${label} = ${ratio.toFixed(2)}:1`)
    }
    for (const [label, surface] of [
      ["panneau sombre", DARK_SURFACE],
      ["--bg sombre", darkBg(accent)],
      ["--accent-soft sombre", darkSoft(accent)],
    ]) {
      const ratio = contrastRatio(inkDark, surface)
      assert.ok(ratio >= MIN_CONTRAST, `${name} : encre sombre sur ${label} = ${ratio.toFixed(2)}:1`)
    }
  }
})

test("accentInks : le survol d'un remplissage ne perd jamais de contraste", () => {
  for (const [name, accent] of Object.entries(PRESETS)) {
    const { fill, fillHover, onFill } = accentInks(accent)
    const base = contrastRatio(onFill, fill)
    const hover = contrastRatio(onFill, fillHover)
    assert.ok(hover >= MIN_CONTRAST, `${name} : survol ${hover.toFixed(2)}:1 (≥ 4,5 exigé)`)
    assert.ok(hover >= base - 0.01, `${name} : le survol ne doit pas coûter de contraste (${base.toFixed(2)} → ${hover.toFixed(2)})`)
  }
  // Le défaut d'origine : l'ancien survol mélangeait vers le blanc (2,29:1).
  assert.ok(contrastRatio("#ffffff", blend("#10b981", "#ffffff", 0.12)) < 3, "l'ancien survol vers le blanc était bien sous le seuil")
})

test("accentInks : un accent clair garde son remplissage, seule l'encre change", () => {
  for (const name of ["emerald", "amber", "blue", "rose"]) {
    const { fill } = accentInks(PRESETS[name])
    assert.equal(fill, PRESETS[name], `${name} : la teinte de marque ne doit pas bouger`)
  }
})

test("accentInks : Violet, seul preset sans encre valide, s'assombrit pour du blanc", () => {
  const inks = accentInks(PRESETS.violet)
  assert.equal(inks.onFill, "#ffffff", "l'encre blanche reste la convention d'un remplissage accent")
  assert.notEqual(inks.fill, PRESETS.violet, "la teinte est assombrie juste assez pour le seuil")
  assert.ok(contrastRatio(inks.onFill, inks.fill) >= MIN_CONTRAST)
  // Assombri, pas repeint : la composante bleue reste dominante (violet, pas gris).
  const value = parseInt(inks.fill.slice(1), 16)
  assert.ok(((value >> 16) & 255) > 90 && ((value >> 8) & 255) < 120, `violet conservé : ${inks.fill}`)
})

test("accentInks : couleur libre invalide ou extrême — jamais d'encre invisible", () => {
  const fallback = accentInks("pas-une-couleur")
  assert.ok(contrastRatio(fallback.onFill, fallback.fill) >= MIN_CONTRAST, "retour au violet par défaut")

  for (const custom of ["#ffffff", "#000000", "#ffff00", "#1e3a8a", "#808080"]) {
    const inks = accentInks(custom)
    assert.ok(contrastRatio(inks.onFill, inks.fill) >= MIN_CONTRAST, `${custom} : encre sur remplissage`)
    const soft = softSurface(custom, LIGHT_SOFT_BACKDROP, SOFT_SHARE_LIGHT)
    assert.ok(contrastRatio(inks.inkLight, soft) >= MIN_CONTRAST, `${custom} : encre claire sur --accent-soft`)
    const dark = softSurface(custom, DARK_SOFT_BACKDROP, SOFT_SHARE_DARK)
    assert.ok(contrastRatio(inks.inkDark, dark) >= MIN_CONTRAST, `${custom} : encre sombre sur --accent-soft`)
  }
})
