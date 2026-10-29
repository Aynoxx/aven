import assert from "node:assert/strict"
import { test } from "node:test"
import { arcLayout, arcNeighbor } from "../web/src/workbench/constellation.ts"

// v12.0.0 : la constellation est un ARC, pas une barre. Ces tests figent la
// symétrie, la hauteur centrale et le départ vers les bords.

test("arcLayout : cinq nœuds, symétriques autour du centre", () => {
  const nodes = arcLayout(5, 1200)
  assert.equal(nodes.length, 5)
  for (let i = 0; i < 5; i += 1) {
    const mirror = nodes[4 - i]
    assert.ok(Math.abs(nodes[i].x + mirror.x) < 1e-9, `nœud ${i} non symétrique`)
    assert.ok(Math.abs(nodes[i].y - mirror.y) < 1e-9, `hauteur ${i} non symétrique`)
  }
  // Le centre est le plus haut, les bords au plus bas.
  const center = nodes[2]
  assert.ok(center.y > nodes[0].y)
  assert.ok(center.y > nodes[4].y)
  assert.equal(center.x, 0)
})

test("arcLayout : les extrémités restent dans une portée raisonnable", () => {
  for (const width of [420, 760, 1024, 1920]) {
    const nodes = arcLayout(5, width)
    const span = nodes[4].x - nodes[0].x
    assert.ok(span > 0)
    // Jamais plus large que la fenêtre : sinon un cercle sort de l'écran.
    assert.ok(span <= width, `portée ${span} > largeur ${width}`)
    assert.ok(span <= 620 + 1e-9, `portée ${span} dépasse le plafond`)
  }
})

test("arcLayout : la profondeur de l'arc reste discrète", () => {
  const wide = arcLayout(5, 1400)
  const narrow = arcLayout(5, 700)
  assert.ok(wide[2].y - wide[0].y <= 40)
  assert.ok(narrow[2].y - narrow[0].y <= 28)
  assert.ok(narrow[2].y < wide[2].y, "l'arc se resserre sur une fenêtre étroite")
})

test("arcLayout : cas limites — aucun nœud, un seul nœud", () => {
  assert.deepEqual(arcLayout(0, 1200), [])
  const [only] = arcLayout(1, 1200)
  assert.equal(only.x, 0)
  assert.equal(only.exitX, 0)
  assert.ok(only.y > 0)
})

test("arcLayout : chaque nœud non central part vers un bord, jamais nulle part", () => {
  for (const nodes of [arcLayout(5, 1200), arcLayout(4, 900)]) {
    for (const node of nodes) {
      assert.ok(Number.isFinite(node.exitX))
      if (node.x !== 0) assert.ok(Math.sign(node.exitX) === Math.sign(node.x))
      assert.ok(Math.abs(node.exitX) >= 200)
    }
  }
  // Un nœud central (nombre impair) reçoit quand même une direction.
  const center = arcLayout(5, 1200)[2]
  assert.notEqual(center.exitX, 0)
})

test("arcLayout : la cascade part du centre", () => {
  const nodes = arcLayout(5, 1200)
  assert.equal(nodes[2].delay, 0)
  assert.deepEqual(nodes.map((n) => n.delay), [2, 1, 0, 1, 2])
})

test("arcNeighbor : flèches avec bouclage", () => {
  assert.equal(arcNeighbor(0, 5, 1), 1)
  assert.equal(arcNeighbor(4, 5, 1), 0)
  assert.equal(arcNeighbor(0, 5, -1), 4)
  assert.equal(arcNeighbor(2, 5, -1), 1)
  assert.equal(arcNeighbor(-1, 5, 1), 1)
  assert.equal(arcNeighbor(0, 0, 1), -1)
})
