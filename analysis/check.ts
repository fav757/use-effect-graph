import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { dirname } from 'node:path'
import assert from 'node:assert/strict'
import { exportResult } from './export.ts'
import type { Result } from './export.ts'
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
if (!expectedPath)
  throw new Error(
    'Usage: node analysis/check.ts output-directory expected.json',
  )
const expected = JSON.parse(readFileSync(expectedPath, 'utf8')) as Record<
  string,
  Expectation
>
const load = (name: string) =>
  JSON.parse(
    readFileSync(resolve(directory, name), 'utf8').replace(/^\uFEFF/, ''),
  )

type Link = { dependency: string; expression: string; source: string }
function assess(result: Result) {
  const entities = new Map(result.entities.map((e) => [e.id, e]))
  const missing: Link[] = []
  const extra: Link[] = []
  const found: Link[] = []
  const inventoryErrors: string[] = []
  for (const [file, spec] of Object.entries(expected)) {
    const effects = result.effects.filter((e) => e.location.file === file)
    if (effects.length !== spec.effectCount)
      inventoryErrors.push(
        file +
          ': expected ' +
          spec.effectCount +
          ' effects, got ' +
          effects.length,
      )
    for (const [mode, count] of Object.entries(spec.modes ?? {})) {
      if (effects.filter((e) => e.mode === mode).length !== count)
        inventoryErrors.push(
          file + ': expected ' + count + ' effects in mode ' + mode,
        )
    }
    for (const depSpec of spec.dependencies) {
      const deps = result.dependencies.filter(
        (d) =>
          entities.get(d.entityId)?.location.file === file &&
          d.expression === depSpec.expression &&
          (depSpec.index === undefined || depSpec.index === d.index),
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
            .filter((p) => p.dependencyId === dep.id)
            .map((p) => entities.get(p.source)?.expression),
        )
        for (const source of depSpec.include ?? []) {
          const link = {
            dependency: dep.id,
            expression: dep.expression,
            source,
          }
          ;(sources.has(source) ? found : missing).push(link)
        }
        for (const source of depSpec.exclude ?? [])
          if (sources.has(source))
            extra.push({
              dependency: dep.id,
              expression: dep.expression,
              source,
            })
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
for (const mode of [
  'standard-value',
  'standard-taint',
  'extended',
  'extended-state',
])
  report[mode] = assess(load(mode + '.json'))

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
const catalog = (
  load('inventory.raw.json')['#select'].tuples as string[][]
).map(
  ([id, , kind, label]) =>
    enhanced.entities.find((e) => e.id === id) ?? {
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
      .filter((e) => normalized.has(dep.id + '\u0000' + e.id))
      .map((e) => ({
        id: 'baseline-projection',
        dependencyId: dep.id,
        source: e.id,
        sourceRole: 'syntactic',
        nodes: [e.id, dep.entityId],
        edges: [],
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
  unit: '(effect source position, dependency index, origin expression source position)',
  oracle: expectedPath.split(/[\\/]/).at(-1),
  results: report,
}
writeFileSync(
  resolve(directory, 'comparison.json'),
  JSON.stringify(output, null, 2) + '\n',
)
for (const [mode, score] of Object.entries(report))
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
const target = report['extended-state']
if (
  target.missing.length ||
  target.extra.length ||
  target.inventoryErrors.length ||
  target.truncated
) {
  process.stderr.write(JSON.stringify(target, null, 2) + '\n')
  process.exitCode = 1
}

// Exercise actual CodeQL fixture graphs, including negative composition guarantees.
if (!process.exitCode) {
  const base = load('extended.json') as Result
  assert(base.paths.some((p) => p.stopReason === 'react-state'))
  assert(!base.edges.some((e) => e.type.startsWith('state-')))
  assert(enhanced.edges.some((e) => e.type === 'state-initial'))
  assert(enhanced.edges.some((e) => e.type === 'state-update'))
  assert(enhanced.edges.some((e) => e.type === 'state-update-functional'))
  assert(enhanced.diagnostics.some((d) => d.reason === 'cycle'))
  assert(enhanced.boundaries.some((b) => b.reason === 'unknown-call'))
  assert(
    enhanced.filteredPaths.some((p) => p.reason === 'mismatched-call-site'),
  )
  const callbacks = enhanced.dependencies.filter(
    (d) => d.expression === 'callback',
  )
  assert(
    callbacks.every((d) =>
      enhanced.paths.some(
        (p) => p.dependencyId === d.id && p.stopReason === 'function-identity',
      ),
    ),
  )
  assert(
    enhanced.edges
      .filter((e) => ['closure-capture', 'hook-dependency'].includes(e.type))
      .every((e) => !e.composable),
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
      limited.diagnostics.some((d) => d.reason === 'depth-limit'),
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
