import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { exportResult, toDot } from './export.ts'
const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const table = (tuples: unknown[][]) => ({ columns: [], tuples })
function data() {
  const inventory = {
    '#select': table([
      ['effect', 'assignments.tsx:6:3:6:36', 'value', 'useEffect'],
      ['a', 'assignments.tsx:3:17:3:35', 'literal', 'origin'],
      ['b', 'assignments.tsx:4:18:4:22', 'value', 'first'],
      ['c', 'assignments.tsx:5:17:5:22', 'value', 'second'],
      ['dep', 'assignments.tsx:6:24:6:28', 'value', 'third'],
      ['empty', 'arrays.tsx:3:3:3:26', 'value', 'empty effect'],
    ]),
    effects: table([
      ['effect', 'assignments.tsx:6:3:6:36', 'literal'],
      ['empty', 'arrays.tsx:3:3:3:26', 'empty'],
    ]),
    dependencies: table([
      ['effect', 0, 'dep', 'assignments.tsx:6:24:6:28'],
      ['effect', 1, 'dep', 'assignments.tsx:6:24:6:28'],
    ]),
    annotations: table([
      ['dep', 'a', 'closure-capture', 'assignments.tsx:3:17:3:35'],
    ]),
  }
  const flow = {
    pathNodes: table([
      [{ id: 1 }, 'a', 'source'],
      [{ id: 2 }, 'b', 'middle'],
      [{ id: 3 }, 'c', 'middle'],
      [{ id: 4 }, 'dep', 'sink'],
    ]),
    pathEdges: table([
      [{ id: 1 }, { id: 2 }, 'value-flow', ''],
      [{ id: 2 }, { id: 4 }, 'value-flow', ''],
    ]),
    subpaths: table([]),
    '#select': table([
      ['effect', 0, { id: 1 }, { id: 4 }],
      ['effect', 1, { id: 1 }, { id: 4 }],
    ]),
  }
  return { inventory, flow }
}
test('retains effects with no edges and distinct dependency positions', () => {
  const { inventory, flow } = data()
  const result = exportResult(inventory, flow, sourceRoot, 'extended-state')
  assert.equal(result.effects.length, 2)
  assert.equal(new Set(result.dependencies.map((d) => d.id)).size, 2)
  assert.equal(result.paths.length, 2)
  const annotation = result.edges.find((e) => e.type === 'closure-capture')!
  assert.equal(annotation.composable, false)
  assert(result.paths.every((p) => !p.edges.includes(annotation.id)))
  assert(toDot(result).includes('useEffect (empty)'))
})
test('reports cycle and depth limits while terminating', () => {
  const { inventory, flow } = data()
  flow.pathEdges.tuples.push([{ id: 2 }, { id: 1 }, 'value-flow', ''])
  const result = exportResult(inventory, flow, sourceRoot, 'extended-state')
  assert(result.diagnostics.some((d) => d.reason === 'cycle'))
  const shallow = exportResult(inventory, flow, sourceRoot, 'extended-state', {
    maxDepth: 1,
  })
  assert.equal(shallow.truncated, true)
  assert(shallow.diagnostics.some((d) => d.reason === 'depth-limit'))
})
test('reports path and exploration limits', () => {
  const { inventory, flow } = data()
  flow.pathEdges.tuples.push(
    [{ id: 1 }, { id: 3 }, 'value-flow', ''],
    [{ id: 3 }, { id: 4 }, 'value-flow', ''],
  )
  const result = exportResult(inventory, flow, sourceRoot, 'extended-state', {
    maxPaths: 1,
  })
  assert(result.diagnostics.some((d) => d.reason === 'path-limit'))
  const tiny = exportResult(inventory, flow, sourceRoot, 'extended-state', {
    maxSteps: 1,
  })
  assert.equal(tiny.truncated, true)
})
test('expands only matched CodeQL call subpaths and bounds contexts', () => {
  const { inventory, flow } = data()
  flow.pathEdges = table([
    [{ id: 1 }, { id: 4 }, 'call-return', ''],
    [{ id: 2 }, { id: 3 }, 'value-flow', ''],
  ])
  flow.subpaths = table([[{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]])
  const result = exportResult(inventory, flow, sourceRoot, 'extended-state')
  assert.deepEqual(result.paths[0].nodes, ['a', 'b', 'c', 'dep'])
  assert(result.edges.some((e) => e.type === 'call-argument'))
  assert(result.edges.some((e) => e.type === 'call-return'))
  flow.subpaths.tuples.push([{ id: 2 }, { id: 3 }, { id: 3 }, { id: 3 }])
  flow.pathEdges.tuples.push([{ id: 2 }, { id: 3 }, 'call-return', ''])
  const limited = exportResult(inventory, flow, sourceRoot, 'extended-state', {
    maxContexts: 1,
  })
  assert(limited.diagnostics.some((d) => d.reason === 'context-limit'))
})
test('output is independent of CodeQL entity numbers and row order', () => {
  const { inventory, flow } = data()
  const first = exportResult(inventory, flow, sourceRoot, 'extended-state')
  const changed = JSON.parse(
    JSON.stringify(flow).replace(
      /"id":(\d+)/g,
      (_, n) => '"id":' + (+n + 1000),
    ),
  )
  for (const t of Object.values(changed) as { tuples: unknown[][] }[])
    t.tuples.reverse()
  assert.deepEqual(
    exportResult(inventory, changed, sourceRoot, 'extended-state'),
    first,
  )
})
test('rejects invalid budgets and unsafe source locations', () => {
  const { inventory, flow } = data()
  assert.throws(
    () =>
      exportResult(inventory, flow, sourceRoot, 'extended-state', {
        maxDepth: 0,
      }),
    /Invalid limit/,
  )
  inventory['#select'].tuples[0][1] = '../outside.ts:1:1:1:1'
  assert.throws(
    () => exportResult(inventory, flow, sourceRoot, 'extended-state'),
    /outside root/,
  )
})

test('rejects captured-parameter paths that return through another invocation', () => {
  const { inventory, flow } = data()
  const contexts = {
    ...inventory,
    callArguments: table([['a', 'b', 'c', 'capturing-function']]),
    callReturns: table([['b', 'dep', 'capturing-function']]),
  }
  const standard = exportResult(contexts, flow, sourceRoot, 'standard-taint')
  assert.equal(standard.paths.length, 2)
  const extended = exportResult(contexts, flow, sourceRoot, 'extended-state')
  assert.equal(extended.paths.length, 0)
  assert.equal(extended.filteredPaths.length, 2)
  assert(
    extended.filteredPaths.every((p) => p.reason === 'mismatched-call-site'),
  )
  contexts.callArguments = table([['a', 'b', 'dep', 'capturing-function']])
  assert.equal(
    exportResult(contexts, flow, sourceRoot, 'extended-state').paths.length,
    2,
  )
})
