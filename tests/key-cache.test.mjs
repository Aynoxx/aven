// v11.5.2 : le cache des clés n'existe que pour supprimer un coût mesuré —
// ~580 ms de PowerShell par clé, refait à chaque requête vocale. Ces tests
// protègent les deux propriétés qui comptent : charger UNE fois, et ne jamais
// servir une clé périmée après un changement.
import assert from "node:assert/strict"
import test from "node:test"
import { createKeyCache } from "../host/key-cache.ts"

test("une clé n'est déchiffrée qu'une seule fois", () => {
  let loads = 0
  const cache = createKeyCache(() => {
    loads++
    return "sk-test"
  })
  assert.equal(cache.get("groq"), "sk-test")
  assert.equal(cache.get("groq"), "sk-test")
  assert.equal(cache.get("groq"), "sk-test")
  assert.equal(loads, 1)
})

test("une clé absente reste absente sans relancer le déchiffrement", () => {
  let loads = 0
  const cache = createKeyCache(() => {
    loads++
    return undefined
  })
  assert.equal(cache.get("openrouter"), undefined)
  assert.equal(cache.get("openrouter"), undefined)
  assert.equal(loads, 1)
})

test("chaque fournisseur a sa propre entrée", () => {
  const loads = []
  const cache = createKeyCache((id) => {
    loads.push(id)
    return `${id}-key`
  })
  assert.equal(cache.get("groq"), "groq-key")
  assert.equal(cache.get("openrouter"), "openrouter-key")
  assert.deepEqual(loads, ["groq", "openrouter"])
})

test("clear(fournisseur) ne recharge que celui-là", () => {
  let loads = 0
  const cache = createKeyCache(() => {
    loads++
    return "clé"
  })
  cache.get("groq")
  cache.get("openrouter")
  cache.clear("groq")
  assert.equal(cache.get("groq"), "clé")
  assert.equal(loads, 3)
  assert.equal(cache.get("openrouter"), "clé")
  assert.equal(loads, 3)
})

test("clear() recharge tout — une clé changée n'est jamais servie périmée", () => {
  let generation = 0
  const cache = createKeyCache(() => `clé-${generation}`)
  assert.equal(cache.get("groq"), "clé-0")
  generation = 1
  cache.clear()
  assert.equal(cache.get("groq"), "clé-1")
  assert.equal(cache.get("openrouter"), "clé-1")
})

test("un échec de déchiffrement n'est pas mis en cache", () => {
  let loads = 0
  const cache = createKeyCache(() => {
    loads++
    if (loads === 1) throw new Error("DPAPI indisponible")
    return "clé"
  })
  assert.throws(() => cache.get("groq"), /DPAPI indisponible/)
  assert.equal(cache.get("groq"), "clé")
  assert.equal(loads, 2)
})
