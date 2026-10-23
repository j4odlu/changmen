import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const SRC = path.join(__dirname, '../src')
const exts = ['.ts', '.tsx', '.vue', '.js', '.mjs']
const skipDirs = new Set(['node_modules', '__tests__', 'dist'])

function walk(dir, files = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    if (skipDirs.has(ent.name)) continue
    const p = path.join(dir, ent.name)
    if (ent.isDirectory()) walk(p, files)
    else if (exts.some((e) => ent.name.endsWith(e)) && !/\.(?:test|spec)\.[^.]+$/.test(ent.name)) files.push(p)
  }
  return files
}

function topModule(filePath) {
  const rel = path.relative(SRC, filePath).replace(/\\/g, '/')
  const parts = rel.split('/')
  if (parts[0] === 'stores' && parts.length > 1) {
    const name = parts[1].replace(/Store\.ts$/, '').replace(/\.ts$/, '')
    return `stores/${name}`
  }
  if (parts[0] === 'components' && parts.length > 1) return `components/${parts[1]}`
  if (parts[0] === 'extensions' && parts.length > 1) return `extensions/${parts[1]}`
  if (parts[0] === 'domain' && parts.length > 1) return `domain/${parts[1]}`
  return parts[0]
}

function resolveImport(fromFile, spec) {
  if (!spec.startsWith('@/') && !spec.startsWith('./') && !spec.startsWith('../')) return null
  let target
  if (spec.startsWith('@/')) target = path.join(SRC, spec.slice(2))
  else target = path.resolve(path.dirname(fromFile), spec)
  const candidates = [target, `${target}.ts`, `${target}.tsx`, `${target}.vue`, path.join(target, 'index.ts')]
  for (const c of candidates) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c
  }
  return null
}

const files = walk(SRC)
const edges = new Map()
const moduleFiles = new Map()

for (const f of files) {
  const mod = topModule(f)
  moduleFiles.set(mod, (moduleFiles.get(mod) ?? 0) + 1)
}

const importRe =
  /(?:import|export)\s+[^'"]*?from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]/g

for (const f of files) {
  const fromMod = topModule(f)
  const content = fs.readFileSync(f, 'utf8')
  let m
  while ((m = importRe.exec(content))) {
    const spec = m[1] || m[2]
    if (!spec) continue
    const resolved = resolveImport(f, spec)
    if (!resolved) continue
    const toMod = topModule(resolved)
    if (fromMod === toMod) continue
    if (!edges.has(fromMod)) edges.set(fromMod, new Set())
    edges.get(fromMod).add(toMod)
  }
}

const inbound = new Map()
const outbound = new Map()
for (const [from, tos] of edges) {
  outbound.set(from, tos.size)
  for (const to of tos) inbound.set(to, (inbound.get(to) ?? 0) + 1)
}

console.log('=== FILE COUNT BY MODULE ===')
;[...moduleFiles.entries()]
  .sort((a, b) => b[1] - a[1])
  .forEach(([m, c]) => console.log(`${String(c).padStart(3)}  ${m}`))

console.log('\n=== HUB (inbound deps) ===')
;[...inbound.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20)
  .forEach(([m, c]) => console.log(`${String(c).padStart(3)}  ${m}`))

console.log('\n=== FAN-OUT (outbound deps) ===')
;[...outbound.entries()]
  .sort((a, b) => b[1] - a[1])
  .slice(0, 20)
  .forEach(([m, c]) => console.log(`${String(c).padStart(3)}  ${m}`))

console.log('\n=== LAYER FLOW (top-level -> top-level) ===')
const topLevel = ['api', 'runtime', 'shared', 'types', 'models', 'domain', 'stores', 'extensions', 'components', 'views', 'router', 'composables', 'utils']
for (const from of topLevel) {
  const targets = new Set()
  for (const [fm, tos] of edges) {
    if (fm === from || fm.startsWith(`${from}/`)) {
      for (const t of tos) targets.add(t.split('/')[0])
    }
  }
  if (targets.size) console.log(`${from} -> ${[...targets].sort().join(', ')}`)
}

console.log('\n=== STORES INTERNAL ===')
for (const [from, tos] of [...edges].sort((a, b) => a[0].localeCompare(b[0]))) {
  if (!from.startsWith('stores/')) continue
  const relevant = [...tos].filter(
    (t) =>
      t.startsWith('stores/') ||
      t.startsWith('extensions/') ||
      t.startsWith('domain/') ||
      ['api', 'shared', 'types', 'models', 'runtime'].includes(t) ||
      t.startsWith('runtime'),
  )
  if (relevant.length) console.log(`${from} -> ${relevant.sort().join(', ')}`)
}

console.log('\n=== EXTENSIONS ===')
for (const [from, tos] of [...edges].sort((a, b) => a[0].localeCompare(b[0]))) {
  if (!from.startsWith('extensions/')) continue
  console.log(`${from} -> ${[...tos].sort().join(', ')}`)
}

console.log('\n=== ENTRY CHAIN (from main.ts) ===')
const main = path.join(SRC, 'main.ts')
const mainTargets = new Set()
let mm
const mainContent = fs.readFileSync(main, 'utf8')
while ((mm = importRe.exec(mainContent))) {
  const spec = mm[1] || mm[2]
  const resolved = resolveImport(main, spec)
  if (resolved) mainTargets.add(topModule(resolved))
}
console.log('main -> ' + [...mainTargets].sort().join(', '))

/** 架构硬规则：违反则 `--check` 非零退出。有意保留边见 ARCHITECTURE.md「依赖基线」。 */
const ARCH_RULES = [
  {
    id: 'domain-no-stores',
    test(fromMod, toMod) {
      return fromMod.startsWith('domain/') && (toMod.startsWith('stores/') || toMod === 'stores')
    },
  },
  {
    id: 'types-no-stores-extensions',
    test(fromMod, toMod) {
      if (fromMod !== 'types') return false
      return toMod.startsWith('stores/') || toMod.startsWith('extensions/') || toMod === 'stores' || toMod === 'extensions'
    },
  },
  {
    id: 'betting-no-notify',
    test(fromMod, toMod) {
      return fromMod === 'stores/betting' && toMod === 'extensions/notify'
    },
  },
]

const violations = []
for (const [fromMod, tos] of edges) {
  for (const toMod of tos) {
    for (const rule of ARCH_RULES) {
      if (rule.test(fromMod, toMod)) {
        violations.push(`${rule.id}: ${fromMod} -> ${toMod}`)
      }
    }
  }
}

console.log('\n=== ARCH RULE VIOLATIONS ===')
if (violations.length === 0) {
  console.log('(none)')
} else {
  for (const v of violations.sort()) console.log(v)
}

const checkMode = process.argv.includes('--check')
if (checkMode && violations.length > 0) {
  process.exitCode = 1
}
