import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import type { Result } from './export.ts'
const directory = process.argv[2]
if (!directory)
  throw new Error('Usage: node analysis/app-check.ts output-directory')
const read = (mode: string) =>
  JSON.parse(readFileSync(resolve(directory, mode + '.json'), 'utf8')) as Result
const base = read('extended')
const history = read('extended-state')
const entities = new Map(history.entities.map((e) => [e.id, e]))
const checks: string[] = []
const effectFile = (id: string) =>
  history.effects.find((e) => e.id === id)?.location.file ?? ''
const pathsFor = (file: string, expression: string) =>
  history.paths.filter((p) =>
    history.dependencies.some(
      (d) =>
        d.id === p.dependencyId &&
        d.expression === expression &&
        effectFile(d.effectId).endsWith(file),
    ),
  )
const origins = (file: string, expression: string) =>
  pathsFor(file, expression).map((p) => entities.get(p.source)?.expression)
assert(
  history.dependencies.some(
    (d) =>
      d.expression === 'debouncedQuery' &&
      effectFile(d.effectId).endsWith('components/Users.tsx'),
  ),
)
assert(
  pathsFor('components/Users.tsx', 'debouncedQuery').some(
    (p) =>
      p.nodes.some((id) =>
        entities.get(id)?.location.file.endsWith('hooks/useDebouncedValue.ts'),
      ) &&
      p.nodes.some((id) => entities.get(id)?.location.file.endsWith('App.tsx')),
  ),
)
checks.push(
  'debouncedQuery crosses Users, useDebouncedValue, JSX input, and App',
)
const themes = origins('App.tsx', 'theme')
assert(themes.includes("'light'"))
assert(!themes.includes('4') && !themes.includes('10'))
checks.push('theme excludes pageSize and refreshSeconds initial values')
const sizes = origins('components/Users.tsx', 'pageSize')
assert(sizes.includes('4'))
assert(!sizes.includes("'light'") && !sizes.includes('10'))
checks.push('pageSize excludes theme and refreshSeconds initial values')
const refresh = origins('components/ActivityFeed.tsx', 'refreshSeconds')
assert(refresh.includes('10'))
assert(!refresh.includes("'light'") && !refresh.includes('4'))
checks.push('refreshSeconds excludes theme and pageSize initial values')
assert(history.entities.some((e) => e.expression === 'user?.id'))
checks.push('optional property user?.id is preserved as its own entity')
assert(
  history.effects.some(
    (e) =>
      e.mode === 'empty' &&
      e.location.file.endsWith('hooks/useOnlineStatus.ts'),
  ),
)
checks.push('useOnlineStatus retains its empty-dependency Effect')
assert(base.paths.some((p) => p.stopReason === 'react-state'))
assert(
  !base.edges.some(
    (e) =>
      e.type.startsWith('state-initial') || e.type.startsWith('state-update'),
  ),
)
assert(history.edges.some((e) => e.type === 'state-initial'))
assert(history.edges.some((e) => e.type.startsWith('state-update')))
checks.push(
  'base state boundary and extended possible state history remain separate',
)
assert(!base.truncated && !history.truncated)
writeFileSync(
  resolve(directory, 'application-checks.json'),
  JSON.stringify({ checks }, null, 2) + '\n',
)
process.stdout.write(checks.length + ' application checks passed\n')
