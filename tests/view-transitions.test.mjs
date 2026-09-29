import assert from "node:assert/strict"
import { transitionNameSelector } from "../web/src/view-transitions.ts"

// Fallback gracieux : sans DOM ni API, withViewTransition exécute update() directement.
// (Ce test tourne sous Node : document est undefined — le chemin sans startViewTransition
// est emprunté, aucun throw.)
const { withViewTransition } = await import("../web/src/view-transitions.ts")
let called = 0
withViewTransition(() => { called++ })
assert.equal(called, 1, "sans API : update exécuté directement")

// Sélecteur partagé avec App.css (garde anti-drift entre JS et CSS).
assert.equal(transitionNameSelector(), "[data-vt-source]")

console.log("view-transitions: OK")
