import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { exportResult } from './export.ts'
import { assessPaths } from './path-oracle.ts'
import type { Bqrs } from './export.ts'
import type { PathOracle } from './path-oracle.ts'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const goldens = JSON.parse(
  readFileSync(join(fixtures, 'paths.expected.json'), 'utf8'),
) as PathOracle
const required = goldens.required.find((spec) => spec.id === 'calls-left')
assert(required)
const oracle: PathOracle = {
  schemaVersion: '1.0.0',
  required: [required],
  forbidden: [],
}
const table = (tuples: unknown[][]) => ({ columns: [], tuples })

function callResult() {
  // Independent facts for first('left-origin', 'unused-left'): only the first argument returns.
  const inventory: Bqrs = {
    '#select': table([
      ['effect', 'calls.tsx:6:3:6:37', 'value', 'useEffect'],
      ['a', 'calls.tsx:4:22:4:34', 'literal', 'left origin'],
      ['p', 'calls.tsx:2:16:2:20', 'parameter', 'value'],
      ['r', 'calls.tsx:2:56:2:60', 'value', 'value'],
      ['c', 'calls.tsx:4:16:4:48', 'value', 'first'],
      ['d', 'calls.tsx:6:24:6:27', 'value', 'left'],
    ]),
    effects: table([['effect', 'calls.tsx:6:3:6:37', 'literal']]),
    dependencies: table([['effect', 0, 'd', 'calls.tsx:6:24:6:27']]),
    annotations: table([]),
    callArguments: table([['a', 'p', 'c', 'calls.tsx:2:1:2:62#function']]),
    callReturns: table([['r', 'c', 'calls.tsx:2:1:2:62#function']]),
  }
  const flow: Bqrs = {
    pathNodes: table([
      [{ id: 1 }, 'a', 'caller'],
      [{ id: 2 }, 'p', 'first'],
      [{ id: 3 }, 'r', 'first'],
      [{ id: 4 }, 'c', 'caller'],
      [{ id: 5 }, 'd', 'sink'],
    ]),
    pathEdges: table([
      [{ id: 1 }, { id: 2 }, 'call-argument', ''],
      [{ id: 2 }, { id: 3 }, 'value-flow', ''],
      [{ id: 3 }, { id: 4 }, 'call-return', ''],
      [{ id: 4 }, { id: 5 }, 'value-flow', ''],
    ]),
    subpaths: table([]),
    '#select': table([['effect', 0, { id: 1 }, { id: 5 }]]),
  }
  return exportResult(inventory, flow, fixtures, 'extended-state')
}

test('independent path oracle accepts the authored function-return route', () => {
  assert.deepEqual(assessPaths(callResult(), oracle), {
    passed: ['calls-left'],
    errors: [],
  })
})

for (const mutation of [
  'transition type',
  'call context',
  'evidence coordinates',
  'intermediate connection',
  'stop reason',
] as const) {
  test('oracle rejects corrupted ' + mutation + ' with the same source', () => {
    const result = callResult()
    const source = result.paths[0].source
    const returning = result.edges.find((edge) => edge.type === 'call-return')!
    if (mutation === 'transition type') returning.type = 'state-update'
    if (mutation === 'evidence coordinates') returning.evidence.startColumn++
    if (mutation === 'call context') {
      returning.callContext!.target = 'calls.tsx:3:1:3:24#function'
    }
    if (mutation === 'intermediate connection') {
      const path = result.paths[0]
      path.nodes.splice(2, 1)
      path.contexts.splice(2, 1)
      path.edges.splice(1, 1)
      returning.from = 'p'
    }
    if (mutation === 'stop reason') {
      result.paths[0].stopReason = 'parameter-interface'
    }
    assert.equal(result.paths[0].source, source)
    assert(
      assessPaths(result, oracle).errors.some((error) =>
        error.startsWith('calls-left:'),
      ),
    )
  })
}

test('source text does not substitute for the expected source position', () => {
  const result = callResult()
  const source = result.entities.find(
    (entity) => entity.id === result.paths[0].source,
  )!
  const text = source.expression
  source.location.startColumn++
  assert.equal(source.expression, text)
  assert(
    assessPaths(result, oracle).errors.some((error) =>
      error.includes('source position'),
    ),
  )
})

test('forbidden path assertions reject an otherwise valid path', () => {
  const result = callResult()
  const forbidden: PathOracle = {
    schemaVersion: '1.0.0',
    required: [],
    forbidden: [{ ...required!, id: 'forbidden-route' }],
  }
  assert(
    assessPaths(result, forbidden).errors.some((error) =>
      error.includes('forbidden path'),
    ),
  )
})

test('callback capture cannot be composed as a value transition', () => {
  const result = callResult()
  const edge = result.edges.find((edge) => edge.type === 'value-flow')!
  edge.type = 'closure-capture'
  assert(
    assessPaths(result, oracle).errors.some((error) =>
      error.includes('annotation composed'),
    ),
  )
})

test('oracle pins the Effect and dependency position', () => {
  for (const field of ['effect', 'dependency'] as const) {
    const result = callResult()
    if (field === 'effect') result.effects[0].location.startLine++
    else result.dependencies[0].index = 1
    assert(
      assessPaths(result, oracle).errors.some((error) =>
        error.includes('Effect, dependency index'),
      ),
    )
  }
})
