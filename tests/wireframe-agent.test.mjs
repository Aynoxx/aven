import assert from "node:assert/strict"
import { test } from "node:test"
import {
  AGENT_PHASES,
  circle,
  fibonacciSphere,
  phaseEnergy,
  pointAlpha,
  project,
  wireframe,
} from "../web/src/agent/sphere.ts"

// v12.0.0 : la géométrie de l'agent est PURE. Si elle casse, la sphère ne
// ressemble plus à Aven — le seul élément qui doit survivre au repli.

const norm = (v) => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z)

test("fibonacciSphere : tous les points sont sur la sphère unitaire", () => {
  const points = fibonacciSphere(256)
  assert.equal(points.length, 256)
  for (const p of points) assert.ok(Math.abs(norm(p) - 1) < 1e-9, `point hors sphère : ${norm(p)}`)
})

test("fibonacciSphere : déterministe, borné, sans NaN", () => {
  const a = fibonacciSphere(64)
  const b = fibonacciSphere(64)
  assert.deepEqual(a, b)
  assert.deepEqual(fibonacciSphere(0), [])
  for (const p of a) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z))
    assert.ok(p.x >= -1 && p.x <= 1 && p.y >= -1 && p.y <= 1 && p.z >= -1 && p.z <= 1)
  }
  // Symétrie : la moyenne des ordonnées est nulle sur la sphère.
  const meanY = a.reduce((sum, p) => sum + p.y, 0) / a.length
  assert.ok(Math.abs(meanY) < 1e-9)
})

test("project : face à la caméra au centre, bord droit à l'est, dos derrière", () => {
  const scale = 100
  const [front] = project([{ x: 0, y: 0, z: 1 }], 0, 0, scale)
  assert.ok(Math.abs(front.x) < 1e-9)
  assert.ok(Math.abs(front.y) < 1e-9)
  assert.ok(Math.abs(front.depth - 1) < 1e-9)
  assert.equal(front.front, true)

  const [right] = project([{ x: 1, y: 0, z: 0 }], 0, 0, scale)
  assert.equal(right.x, scale)
  assert.ok(Math.abs(right.y) < 1e-9)
  assert.equal(right.front, true)

  const [back] = project([{ x: 0, y: 0, z: -1 }], 0, 0, scale)
  assert.equal(back.front, false)
  assert.ok(Math.abs(back.depth + 1) < 1e-9)

  // Y de la sphère devient NÉGATIF à l'écran (repère CSS vers le bas).
  const [top] = project([{ x: 0, y: 1, z: 0 }], 0, 0, scale)
  assert.equal(top.y, -scale)
  assert.ok(Math.abs(top.x) < 1e-9)
})

test("project : un quart de tour amène le point de droite face à la caméra", () => {
  const [p] = project([{ x: 1, y: 0, z: 0 }], Math.PI / 2, 0, 50)
  assert.ok(Math.abs(p.depth - 1) < 1e-9)
  assert.ok(Math.abs(p.x) < 1e-9)
})

test("circle : parallèles et méridiens restent sur la sphère", () => {
  const equator = circle("parallel", 0.5, 48)
  assert.equal(equator.length, 48)
  for (const p of equator) assert.ok(Math.abs(norm(p) - 1) < 1e-9)
  // L'équateur est à y = 0.
  for (const p of equator) assert.ok(Math.abs(p.y) < 1e-9)

  const meridian = circle("meridian", 0, 48)
  for (const p of meridian) assert.ok(Math.abs(norm(p) - 1) < 1e-9)
  // Le plan du méridien d'indice 0 est z = 0.
  for (const p of meridian) assert.ok(Math.abs(p.z) < 1e-9)
})

test("wireframe : grille complète et unitaire", () => {
  const paths = wireframe(5, 7, 32)
  // (parallels - 1) parallèles + meridians méridiens.
  assert.equal(paths.length, 4 + 7)
  for (const path of paths) {
    assert.ok(path.length >= 8)
    for (const p of path) assert.ok(Math.abs(norm(p) - 1) < 1e-9)
  }
})

test("phaseEnergy : les sept phases réelles, aucune inventée", () => {
  assert.equal(AGENT_PHASES.length, 7)
  for (const phase of AGENT_PHASES) {
    const energy = phaseEnergy(phase)
    assert.ok(Number.isFinite(energy.spin) && energy.spin >= 0)
    assert.ok(energy.density > 0 && energy.density <= 1)
    assert.ok(energy.wave >= 0 && energy.wave <= 1)
    assert.ok(energy.glow >= 0 && energy.glow <= 1)
  }
  // Micro coupé : aucune onde, aucune prétention d'écoute.
  assert.equal(phaseEnergy("muted").wave, 0)
  // La parole est la phase la plus « vivante », l'écoute la plus large.
  assert.ok(phaseEnergy("speaking").wave > phaseEnergy("listening").wave)
  assert.equal(phaseEnergy("listening").density, 0.9)
})

test("pointAlpha : la face visible pèse plus que le dos, borné à [0,1]", () => {
  const front = pointAlpha(1, 1)
  const back = pointAlpha(-1, 1)
  assert.ok(front > back)
  assert.ok(front <= 1 && back >= 0)
  assert.equal(pointAlpha(1, 0), 0)
  assert.ok(pointAlpha(1, 5) <= 1)
})
