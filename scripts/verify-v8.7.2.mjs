import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'

const root = process.cwd()
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const pkg = JSON.parse(read('package.json'))
const priorities = JSON.parse(read('model-priorities.json'))
assert.match(pkg.version, /^8\.7\.2$/)
assert.match(read('electron/providers.ts'), /probeOpenRouterKey/)
assert.match(read('electron/main.ts'), /OpenRouter désactivé pour ce démarrage/)
assert.match(read('electron/main.ts'), /p\.id !== "openrouter" \|\| openRouterUsable/)
assert.match(read('electron/router.ts'), /providerCoolUntil/)
assert.match(read('electron/router.ts'), /scope === "provider"/)
assert.match(read('electron/router.ts'), /user not found/)
assert.ok(priorities.models['google/gemini-3.7-flash'])
assert.equal(priorities.models['google/gemini-3.7-flash'].priority.code, 2)
assert.ok(fs.existsSync(path.join(root, '.opencode/plugins/aven-tool-guard.js')))
assert.match(read('.opencode/plugins/aven-tool-guard.js'), /MAX_GLOB_CALLS = 8/)
assert.match(read('.opencode/plugins/aven-tool-guard.js'), /MAX_IDENTICAL = 3/)
assert.match(read('electron/settings.ts'), /aven-tool-guard\.js/)
assert.match(read('electron/main.ts'), /model\.providerID === "openrouter" && !openRouterUsable/)
for (const f of ['code.md','analyse.md','recherche.md','code-reviewer.md']) assert.match(read(`.opencode/agents/${f}`), /glob/) 
console.log('v8.7.2 checks: OK')
