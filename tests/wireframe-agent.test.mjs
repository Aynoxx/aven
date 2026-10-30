import assert from "node:assert/strict"
import { test } from "node:test"
import {
  AGENT_LIGHT,
  AGENT_PHASES,
  circle,
  fibonacciSphere,
  geodesicMesh,
  lightAt,
  lightCurve,
  phaseEnergy,
  pointAlpha,
  project,
  shadeAlpha,
  wireframe,
  withInput,
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

// v12.4.0 : la sphère est une STRUCTURE (maillage géodésique + lumière fixe),
// plus une bille à calotte. Ces trois invariants décident de son apparence :
// une géométrie sur la sphère unitaire, un maillage déterministe et fermé, et
// une lumière asymétrique qui garde l'ombre lisible.

test("geodesicMesh : sommets unitaires, triangles quadruplés par niveau", () => {
  for (const detail of [0, 1, 2, 3]) {
    const mesh = geodesicMesh(detail)
    assert.equal(mesh.triangles.length, 20 * 4 ** detail, `detail ${detail} : faces`)
    // Icosphere : V = 10·4^n + 2. La formule attrape un cache de milieux cassé.
    assert.equal(mesh.vertices.length, 10 * 4 ** detail + 2, `detail ${detail} : sommets`)
    for (const v of mesh.vertices) assert.ok(Math.abs(norm(v) - 1) < 1e-9)
    for (const triangle of mesh.triangles) {
      assert.equal(triangle.length, 3)
      for (const index of triangle) assert.ok(index >= 0 && index < mesh.vertices.length)
    }
  }
})

test("geodesicMesh : arêtes uniques et fermées sur les triangles", () => {
  const mesh = geodesicMesh(2)
  const keys = new Set(mesh.edges.map(([a, b]) => `${a}:${b}`))
  assert.equal(keys.size, mesh.edges.length, "aucune arête ne doit être dessinée deux fois")
  for (const [a, b] of mesh.edges) assert.ok(a < b, "arêtes ordonnées sommet bas → haut")
  // E = 3F/2 pour un maillage triangulaire fermé.
  assert.equal(mesh.edges.length, (mesh.triangles.length * 3) / 2)
  for (const [a, b, c] of mesh.triangles) {
    for (const [i, j] of [[a, b], [b, c], [c, a]]) {
      assert.ok(keys.has(`${Math.min(i, j)}:${Math.max(i, j)}`), `arête ${i}-${j} absente`)
    }
  }
})

test("geodesicMesh : déterministe — le jitter ne scintille pas à chaque frame", () => {
  assert.deepEqual(geodesicMesh(2), geodesicMesh(2))
  // Le jitter déforme vraiment les milieux : un maillage parfaitement régulier
  // trahirait la projection des seuls points de Fibonacci.
  const a = geodesicMesh(1, 0)
  const b = geodesicMesh(1, 0.05)
  assert.notDeepEqual(a.vertices, b.vertices)
})

test("AGENT_LIGHT : unitaire, haut-droite, devant", () => {
  assert.ok(Math.abs(norm(AGENT_LIGHT) - 1) < 1e-9)
  assert.ok(AGENT_LIGHT.x > 0 && AGENT_LIGHT.y > 0 && AGENT_LIGHT.z > 0)
  // La référence place le croissant lumineux en haut à droite, pas au centre.
  assert.ok(AGENT_LIGHT.x > AGENT_LIGHT.y)
})

test("lightAt : pleine face à 1, dos à 0, jamais négatif", () => {
  assert.ok(Math.abs(lightAt({ x: AGENT_LIGHT.x, y: AGENT_LIGHT.y, z: AGENT_LIGHT.z }) - 1) < 1e-9)
  assert.equal(lightAt({ x: -AGENT_LIGHT.x, y: -AGENT_LIGHT.y, z: -AGENT_LIGHT.z }), 0)
  assert.equal(lightAt({ x: 0, y: 0, z: 0 }), 0)
  assert.equal(lightAt({ x: 0, y: 1, z: 0 }), AGENT_LIGHT.y)
})

test("lightCurve : plateau large, ombre à 0, plein jour à 1", () => {
  assert.equal(lightCurve(0), 0)
  assert.equal(lightCurve(1), 1)
  // Une source large, pas un projecteur : à mi-lambert, on est déjà bien éclairé.
  assert.ok(lightCurve(0.6) > 0.25, "le croissant doit être large, pas un liseré")
  assert.ok(lightCurve(0.6) < lightCurve(0.9))
  const samples = [0, 0.2, 0.4, 0.6, 0.8, 1].map((dot) => lightCurve(dot))
  for (let i = 1; i < samples.length; i += 1) assert.ok(samples[i] >= samples[i - 1])
  assert.equal(lightCurve(-2), 0)
  assert.equal(lightCurve(3), 1)
})

test("shadeAlpha : ombre jamais noire, lumière à 1, courbe croissante", () => {
  assert.equal(shadeAlpha(1), 1)
  assert.ok(shadeAlpha(0) > 0, "un maillage invisible dans l'ombre n'est plus une sphère")
  assert.equal(shadeAlpha(0), 0.1)
  const samples = [0, 0.2, 0.5, 0.8, 1].map((lit) => shadeAlpha(lit))
  for (let i = 1; i < samples.length; i += 1) assert.ok(samples[i] > samples[i - 1])
  assert.ok(shadeAlpha(2) <= 1 && shadeAlpha(-3) >= 0)
})

// v12.6.0 : la sphère réagit au niveau RÉEL du micro pendant que l'utilisateur
// parle. Sans niveau, l'énergie de la phase est rendue inchangée — aucune
// animation ne doit naître du silence.

test("withInput : sans niveau, l'énergie de la phase est intacte", () => {
  for (const phase of AGENT_PHASES) {
    const energy = phaseEnergy(phase)
    assert.deepEqual(withInput(energy, 0), energy)
  }
  // Une mesure absurde ne devient pas une animation.
  assert.deepEqual(withInput(phaseEnergy("listening"), Number.NaN), phaseEnergy("listening"))
})

test("withInput : la parole amplifie le mouvement, sans sortir des bornes", () => {
  const base = phaseEnergy("capturing")
  const loud = withInput(base, 1)
  assert.ok(loud.spin > base.spin, "une voix forte accélère la rotation")
  assert.ok(loud.wave > base.wave, "une voix forte respire plus ample")
  assert.ok(loud.glow > base.glow, "une voix forte allume le limbe")
  for (const value of [loud.spin, loud.density, loud.wave, loud.glow]) assert.ok(Number.isFinite(value))
  assert.ok(loud.density <= 1 && loud.glow <= 1)
  // Monotone : deux fois plus de voix = au moins autant de mouvement.
  const half = withInput(base, 0.5)
  assert.ok(half.wave < loud.wave && half.spin < loud.spin)
  // Borné même si une mesure dérape.
  assert.deepEqual(withInput(base, 4), withInput(base, 1))
})

test("phaseEnergy : la capture est la phase la plus vivante côté utilisateur", () => {
  // Le défaut signalé : la sphère bougeait autant quand on se taisait que quand
  // on parlait. La capture doit dominer l'écoute, et battre la parole de l'agent.
  assert.ok(phaseEnergy("capturing").spin > phaseEnergy("listening").spin)
  assert.ok(phaseEnergy("capturing").spin > phaseEnergy("speaking").spin)
  assert.ok(phaseEnergy("capturing").glow > phaseEnergy("speaking").glow)
})

test("pointAlpha : la face visible pèse plus que le dos, borné à [0,1]", () => {
  const front = pointAlpha(1, 1)
  const back = pointAlpha(-1, 1)
  assert.ok(front > back)
  assert.ok(front <= 1 && back >= 0)
  assert.equal(pointAlpha(1, 0), 0)
  assert.ok(pointAlpha(1, 5) <= 1)
})
