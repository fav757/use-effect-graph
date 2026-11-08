import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import assert from 'node:assert/strict'
import { exportResult } from './export.ts'
import type { Result } from './export.ts'
import { assessPaths } from './path-oracle.ts'
import type { PathOracle } from './path-oracle.ts'
type Expectation = {
  effectCount: number
  modes?: Record<string, number>
  dependencies: {
    expression: string
    index?: number
    include?: string[]
    exclude?: string[]
  }[]
}
const [directory, expectedPath, sourceRoot] = process.argv.slice(2)

if (!expectedPath) {
  throw new Error(
    'Usage: node analysis/check.ts output-directory expected.json',
  )
}

const expectedFile = JSON.parse(readFileSync(expectedPath, 'utf8')) as Record<
  string,
  unknown
>

const expected = Object.fromEntries(
  Object.entries(expectedFile).filter(([key]) => key !== '$paths'),
) as Record<string, Expectation>

const pathReference = expectedFile.$paths

if (pathReference !== undefined && typeof pathReference !== 'string') {
  throw new Error('$paths must name a path oracle file')
}

const pathOracle =
  typeof pathReference === 'string'
    ? (JSON.parse(
        readFileSync(resolve(dirname(expectedPath), pathReference), 'utf8'),
      ) as PathOracle)
    : undefined

const load = <T>(name: string): T =>
  JSON.parse(
    readFileSync(resolve(directory, name), 'utf8').replace(/^\uFEFF/, ''),
  ) as T

type Link = { dependency: string; expression: string; source: string }

function assess(result: Result) {
  const entities = new Map(result.entities.map((entity) => [entity.id, entity]))
  const missing: Link[] = []
  const extra: Link[] = []
  const found: Link[] = []
  const inventoryErrors: string[] = []

  for (const [file, spec] of Object.entries(expected)) {
    const effects = result.effects.filter(
      (effect) => effect.location.file === file,
    )

    if (effects.length !== spec.effectCount) {
      inventoryErrors.push(
        file +
          ': expected ' +
          spec.effectCount +
          ' effects, got ' +
          effects.length,
      )
    }

    for (const [mode, count] of Object.entries(spec.modes ?? {})) {
      if (effects.filter((effect) => effect.mode === mode).length !== count) {
        inventoryErrors.push(
          file + ': expected ' + count + ' effects in mode ' + mode,
        )
      }
    }

    for (const depSpec of spec.dependencies) {
      const deps = result.dependencies.filter(
        (dependency) =>
          entities.get(dependency.entityId)?.location.file === file &&
          dependency.expression === depSpec.expression &&
          (depSpec.index === undefined || depSpec.index === dependency.index),
      )

      if (deps.length === 0) {
        inventoryErrors.push(
          file + ': missing dependency ' + depSpec.expression,
        )
        continue
      }

      for (const dep of deps) {
        const sources = new Set(
          result.paths
            .filter((path) => path.dependencyId === dep.id)
            .map((path) => entities.get(path.source)?.expression),
        )

        for (const source of depSpec.include ?? []) {
          const link = {
            dependency: dep.id,
            expression: dep.expression,
            source,
          }

          ;(sources.has(source) ? found : missing).push(link)
        }

        for (const source of depSpec.exclude ?? []) {
          if (sources.has(source)) {
            extra.push({
              dependency: dep.id,
              expression: dep.expression,
              source,
            })
          }
        }
      }
    }
  }

  return {
    found,
    missing,
    extra,
    inventoryErrors,
    boundaries: result.boundaries.length,
    truncated: result.truncated,
    scope:
      'Only handwritten positive and negative oracle assertions are scored; this is not an exhaustive precision/recall estimate.',
  }
}

const report: Record<string, ReturnType<typeof assess>> = {}
const pathChecks: Record<string, ReturnType<typeof assessPaths>> = {}

for (const mode of [
  'standard-value',
  'standard-taint',
  'extended',
  'extended-state',
]) {
  const result = load<Result>(mode + '.json')
  report[mode] = assess(result)
  if (pathOracle) pathChecks[mode] = assessPaths(result, pathOracle)
}

// Normalize the original variable graph without interpreting its syntactic edges as value flow.
const baseline = load('baseline-units.raw.json') as {
  '#select': { tuples: [string, number, string][] }
}

const enhanced = load('extended-state.json') as Result

const normalized = new Set(
  baseline['#select'].tuples.map(
    ([effect, index, source]) =>
      effect + '/dependency:' + index + '\u0000' + source,
  ),
)

const catalog = load<{ '#select': { tuples: string[][] } }>(
  'inventory.raw.json',
)['#select'].tuples.map(
  ([id, , kind, label]) =>
    enhanced.entities.find((entity) => entity.id === id) ?? {
      id,
      kind,
      label,
      expression: label,
      location: {
        file: id.split(':')[0],
        startLine: 0,
        startColumn: 0,
        endLine: 0,
        endColumn: 0,
      },
    },
)

const projected: Result = {
  ...enhanced,
  entities: catalog,
  paths: enhanced.dependencies.flatMap((dep) =>
    catalog
      .filter((entry) => normalized.has(dep.id + '\u0000' + entry.id))
      .map((entry) => ({
        id: 'baseline-projection',
        dependencyId: dep.id,
        source: entry.id,
        sourceRole: 'syntactic',
        nodes: [entry.id, dep.entityId],
        edges: [],
        contexts: [],
        stopReason: 'syntactic-projection',
        status: 'approximation',
      })),
  ),
}

report.baseline = assess(projected)
report.baseline.inventoryErrors = [
  'The baseline has no standalone Effect inventory; inventory coverage is not scored.',
]

const output = {
  schemaVersion: '2.0.0',
  unit: '(effect source position, dependency index, origin expression source position)',
  oracle: expectedPath.split(/[\\/]/).at(-1),
  results: report,
  pathChecks,
}

writeFileSync(
  resolve(directory, 'comparison.json'),
  JSON.stringify(output, null, 2) + '\n',
)

for (const [mode, score] of Object.entries(report)) {
  process.stdout.write(
    mode +
      ': found=' +
      score.found.length +
      ', missing=' +
      score.missing.length +
      ', forbidden=' +
      score.extra.length +
      '\n',
  )
}

const target = report['extended-state']

if (
  target.missing.length ||
  target.extra.length ||
  target.inventoryErrors.length ||
  target.truncated ||
  !!pathChecks['extended-state']?.errors.length
) {
  process.stderr.write(JSON.stringify(target, null, 2) + '\n')

  if (pathChecks['extended-state']?.errors.length) {
    process.stderr.write(
      JSON.stringify(pathChecks['extended-state'], null, 2) + '\n',
    )
  }

  process.exitCode = 1
}

if (pathOracle) {
  process.stdout.write(
    'Path oracle: ' +
      pathChecks['extended-state'].passed.length +
      ' passed, ' +
      pathChecks['extended-state'].errors.length +
      ' errors\n',
  )
}

// Exercise actual CodeQL fixture graphs, including negative composition guarantees.
if (!process.exitCode) {
  const base = load('extended.json') as Result
  assert(base.paths.some((path) => path.stopReason === 'react-state'))
  assert(!base.edges.some((edge) => edge.type.startsWith('state-')))
  assert(enhanced.edges.some((edge) => edge.type === 'state-initial'))
  assert(enhanced.edges.some((edge) => edge.type === 'state-update'))
  assert(enhanced.edges.some((edge) => edge.type === 'state-update-functional'))
  assert(
    enhanced.diagnostics.some((dependency) => dependency.reason === 'cycle'),
  )
  assert(
    enhanced.boundaries.some((boundary) => boundary.reason === 'unknown-call'),
  )
  assert(
    enhanced.filteredPaths.some(
      (path) => path.reason === 'mismatched-call-site',
    ),
  )

  const callbacks = enhanced.dependencies.filter(
    (dependency) => dependency.expression === 'callback',
  )

  assert(
    callbacks.every((dependency) =>
      enhanced.paths.some(
        (path) =>
          path.dependencyId === dependency.id &&
          path.stopReason === 'function-identity',
      ),
    ),
  )
  assert(
    enhanced.edges
      .filter((entry) =>
        ['closure-capture', 'hook-dependency'].includes(entry.type),
      )
      .every((entry) => !entry.composable),
  )

  const limited = exportResult(
    load('inventory.raw.json'),
    load('extended-state.raw.json'),
    sourceRoot ?? dirname(expectedPath),
    'extended-state',
    { maxDepth: 1 },
  )

  assert(
    limited.truncated &&
      limited.diagnostics.some(
        (dependency) => dependency.reason === 'depth-limit',
      ),
  )
  writeFileSync(
    resolve(directory, 'fixture-invariants.json'),
    JSON.stringify(
      {
        stateLevels: true,
        functionalUpdates: true,
        cycles: true,
        unknownCalls: true,
        matchedCalls: true,
        callbackIdentity: true,
        annotations: true,
        depthLimit: true,
      },
      null,
      2,
    ) + '\n',
  )
}
