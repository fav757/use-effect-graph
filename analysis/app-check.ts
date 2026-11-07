import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import assert from 'node:assert/strict'
import type { Result } from './export.ts'
const directory = process.argv[2]
if (!directory) {
  throw new Error('Usage: node analysis/app-check.ts output-directory')
}
const read = (mode: string) =>
  JSON.parse(readFileSync(resolve(directory, mode + '.json'), 'utf8')) as Result
const base = read('extended')
const history = read('extended-state')
const entities = new Map(history.entities.map((entity) => [entity.id, entity]))
const checks: string[] = []
const effectFile = (id: string) =>
  history.effects.find((effect) => effect.id === id)?.location.file ?? ''
const pathsFor = (file: string, expression: string) =>
  history.paths.filter((path) =>
    history.dependencies.some(
      (dependency) =>
        dependency.id === path.dependencyId &&
        dependency.expression === expression &&
        effectFile(dependency.effectId).endsWith(file),
    ),
  )
const origins = (file: string, expression: string) =>
  pathsFor(file, expression).map(
    (path) => entities.get(path.source)?.expression,
  )
assert(
  history.dependencies.some(
    (dependency) =>
      dependency.expression === 'debouncedQuery' &&
      effectFile(dependency.effectId).endsWith('components/Users.tsx'),
  ),
)
assert(
  pathsFor('components/Users.tsx', 'debouncedQuery').some(
    (path) =>
      path.nodes.some((id) =>
        entities.get(id)?.location.file.endsWith('hooks/useDebouncedValue.ts'),
      ) &&
      path.nodes.some((id) =>
        entities.get(id)?.location.file.endsWith('App.tsx'),
      ),
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
assert(history.entities.some((entity) => entity.expression === 'user?.id'))
checks.push('optional property user?.id is preserved as its own entity')
assert(
  history.effects.some(
    (entry) =>
      entry.mode === 'empty' &&
      entry.location.file.endsWith('hooks/useOnlineStatus.ts'),
  ),
)
checks.push('useOnlineStatus retains its empty-dependency Effect')
assert(base.paths.some((path) => path.stopReason === 'react-state'))
assert(
  !base.edges.some(
    (entry) =>
      entry.type.startsWith('state-initial') ||
      entry.type.startsWith('state-update'),
  ),
)
assert(history.edges.some((edge) => edge.type === 'state-initial'))
assert(history.edges.some((edge) => edge.type.startsWith('state-update')))
checks.push(
  'base state boundary and extended possible state history remain separate',
)
assert(!base.truncated && !history.truncated)
writeFileSync(
  resolve(directory, 'application-checks.json'),
  JSON.stringify({ checks }, null, 2) + '\n',
)
process.stdout.write(checks.length + ' application checks passed\n')
