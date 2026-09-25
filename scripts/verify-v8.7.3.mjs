import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'

const root = process.cwd()
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const pkg = JSON.parse(read('package.json'))
const priorities = JSON.parse(read('model-priorities.json'))
assert.equal(pkg.version, '8.7.3')
assert.ok(priorities.models['openai/gpt-6-astra'])
assert.ok(priorities.models['google/gemini-3.8-flash'])
assert.equal(priorities.models['openrouter/openrouter/free'].priority.code, 50)
assert.equal(priorities.models['openrouter/openrouter/free'].priority.analyse, 50)
assert.equal(priorities.models['openrouter/openrouter/free'].priority.recherche, 50)
assert.ok(priorities.models['openai/gpt-6-astra'].priority.code < priorities.models['openai/gpt-6-luna'].priority.code)
assert.ok(priorities.models['google/gemini-3.8-flash'].priority.recherche < priorities.models['google/gemini-3.5-flash-lite'].priority.recherche)
assert.match(read('electron/router.ts'), /providerCoolUntil/)
assert.match(read('electron/router.ts'), /scope === "provider"/)
assert.match(read('electron/router.ts'), /user not found/)
console.log('v8.7.3 priority checks: OK')
