import test from 'node:test'
import assert from 'node:assert/strict'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { exportResult, toDot } from './export.ts'
test('path identity preserves transition kinds and evidence', () => {
  for (const [kind, provenance] of [
    ['state-update', ''],
    ['state-initial', 'another basis'],
  ]) {
    const { inventory, flow } = data()
    flow.pathEdges = table([
      [{ id: 1 }, { id: 4 }, 'state-initial', ''],
      [{ id: 1 }, { id: 4 }, kind, provenance],
    ])

    const result = exportResult(inventory, flow, sourceRoot, 'extended-state')
    assert.equal(
      result.paths.filter((path) => path.dependencyId.endsWith(':0')).length,
      2,
    )

    assert.equal(new Set(result.paths.map((path) => path.id)).size, 4)
  }
})

test('path identity preserves meaningful contexts and merges equivalent aliases', () => {
  for (const distinct of [true, false]) {
    const { inventory, flow } = data()
    flow.pathNodes.tuples.push([
      { id: 11 },
      'a',
      distinct ? 'another call context' : 'source',
    ])

    flow.pathEdges = table([
      [{ id: 1 }, { id: 4 }, 'value-flow', ''],
      [{ id: 11 }, { id: 4 }, 'value-flow', ''],
    ])

    flow['#select'].tuples.push(['effect', 0, { id: 11 }, { id: 4 }])
    const result = exportResult(inventory, flow, sourceRoot, 'extended-state')
    assert.equal(
      result.paths.filter((path) => path.dependencyId.endsWith(':0')).length,
      distinct ? 2 : 1,
    )
  }
})

test('unique path count below or exactly at the limit is complete', () => {
  const { inventory, flow } = data()

  for (const maxPaths of [1, 2]) {
    const result = exportResult(inventory, flow, sourceRoot, 'extended-state', {
      maxPaths,
    })

    assert.equal(result.truncated, false)
    assert(
      !result.diagnostics.some(
        (dependency) => dependency.reason === 'path-limit',
      ),
    )

    assert.equal(result.paths.length, 2)
    assert(
      result.searches.every(
        (search) =>
          search.complete &&
          !search.additionalPathFound &&
          search.pathLimitReached === (maxPaths === 1),
      ),
    )
  }
})

test('equivalent table duplicates do not consume the unique path budget', () => {
  const { inventory, flow } = data()
  flow.pathEdges.tuples.push(...structuredClone(flow.pathEdges.tuples))
  flow['#select'].tuples.push(...structuredClone(flow['#select'].tuples))

  const result = exportResult(inventory, flow, sourceRoot, 'extended-state', {
    maxPaths: 1,
  })

  assert.equal(result.paths.length, 2)
  assert.equal(result.truncated, false)
})

test('context-rejected candidates after a full path quota do not imply truncation', () => {
  const { inventory, flow } = data()
  flow.pathEdges.tuples.push(
    [{ id: 1 }, { id: 3 }, 'call-argument', ''],
    [{ id: 3 }, { id: 4 }, 'call-return', ''],
  )

  const contexts = {
    ...inventory,
    callArguments: table([
      ['a', 'b', 'dep', 'f'],
      ['a', 'c', 'b', 'f'],
    ]),
    callReturns: table([
      ['b', 'dep', 'f'],
      ['c', 'dep', 'f'],
    ]),
  }

  const result = exportResult(contexts, flow, sourceRoot, 'extended-state', {
    maxPaths: 1,
  })

  assert.equal(result.paths.length, 2)
  assert.equal(result.filteredPaths.length, 2)
  assert.equal(result.truncated, false)
})

test('unfinished lookahead reports the actual step, depth or context budget', () => {
  for (const budget of ['maxSteps', 'maxDepth', 'maxContexts'] as const) {
    const { inventory, flow } = data()
    flow.pathEdges.tuples.push(
      [{ id: 1 }, { id: 3 }, 'value-flow', ''],
      [{ id: 3 }, { id: 2 }, 'value-flow', ''],
    )

    const contexts = {
      ...inventory,
      callArguments: table([
        ['a', 'b', 'dep', 'f'],
        ['a', 'c', 'c', 'g'],
      ]),
      callReturns: table([]),
    }

    const limits = {
      maxPaths: 1,
      [budget]: budget === 'maxSteps' ? 3 : budget === 'maxDepth' ? 2 : 1,
    }

    const result = exportResult(
      contexts,
      flow,
      sourceRoot,
      'extended-state',
      limits,
    )

    assert(
      result.diagnostics.some(
        (dependency) =>
          dependency.reason ===
          {
            maxSteps: 'step-limit',
            maxDepth: 'depth-limit',
            maxContexts: 'context-limit',
          }[budget],
      ),
    )

    assert(
      !result.diagnostics.some(
        (dependency) => dependency.reason === 'path-limit',
      ),
    )

    assert.equal(result.truncated, true)
  }
})

test('typed paths are deterministic under row shuffles and BQRS renumbering', () => {
  const { inventory, flow } = data()
  flow.pathEdges = table([
    [{ id: 1 }, { id: 4 }, 'state-initial', 'basis A'],
    [{ id: 1 }, { id: 4 }, 'state-update', 'basis B'],
  ])

  const first = exportResult(inventory, flow, sourceRoot, 'extended-state')

  for (let seed = 1; seed <= 12; seed++) {
    let random = seed

    const permute = (input: typeof flow | typeof inventory) => {
      const output = JSON.parse(
        JSON.stringify(input, (key, value: unknown) =>
          key === 'id' && typeof value === 'number'
            ? -value - seed * 1000
            : value,
        ),
      ) as Record<string, { columns: []; tuples: unknown[][] }>

      for (const entry of Object.values(output)) {
        for (let index = entry.tuples.length - 1; index > 0; index--) {
          random = (random * 1664525 + 1013904223) >>> 0

          const other = random % (index + 1)

          ;[entry.tuples[index], entry.tuples[other]] = [
            entry.tuples[other],
            entry.tuples[index],
          ]
        }
      }

      return output
    }

    assert.deepEqual(
      exportResult(
        permute(inventory),
        permute(flow),
        sourceRoot,
        'extended-state',
      ),
      first,
    )
  }
})

test('summary grounds remain distinct after call subpaths are expanded', () => {
  const { inventory, flow } = data()
  flow.pathEdges = table([
    [{ id: 1 }, { id: 4 }, 'call-return', 'basis A'],
    [{ id: 1 }, { id: 4 }, 'call-return', 'basis B'],
    [{ id: 2 }, { id: 3 }, 'value-flow', ''],
  ])

  flow.subpaths = table([[{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }]])
  const result = exportResult(inventory, flow, sourceRoot, 'extended-state')
  assert.equal(result.paths.length, 4)
  assert.deepEqual(
    new Set(
      result.edges.flatMap((edge) =>
        edge.summary ? [edge.summary.provenance] : [],
      ),
    ),
    new Set(['basis A', 'basis B']),
  )
})

test('lookahead stops at the first additional unique path', () => {
  const { inventory, flow } = data()
  flow.pathEdges = table([])
  flow['#select'] = table([])

  for (let index = 100; index < 1100; index++) {
    flow.pathNodes.tuples.push([{ id: index }, 'a', 'invocation ' + index])
    flow.pathEdges.tuples.push([{ id: index }, { id: 4 }, 'value-flow', ''])
    flow['#select'].tuples.push(['effect', 0, { id: index }, { id: 4 }])
  }

  const result = exportResult(inventory, flow, sourceRoot, 'extended-state', {
    maxPaths: 1,
    maxSteps: 10,
  })

  assert.equal(result.paths.length, 1)
  assert(result.searches[0].additionalPathFound && !result.searches[0].complete)
  assert(result.searches[0].steps < 10)
  assert(
    result.diagnostics.some((dependency) => dependency.reason === 'path-limit'),
  )

  assert(
    !result.diagnostics.some(
      (dependency) => dependency.reason === 'step-limit',
    ),
  )
})

test('annotation closure is independent of input row order', () => {
  const { inventory, flow } = data()
  inventory.annotations = table([
    ['c', 'empty', 'closure-capture', ''],
    ['dep', 'c', 'closure-capture', ''],
  ])

  const first = exportResult(inventory, flow, sourceRoot, 'extended-state')
  inventory.annotations.tuples.reverse()
  assert.deepEqual(
    exportResult(inventory, flow, sourceRoot, 'extended-state'),
    first,
  )

  assert.equal(
    first.edges.filter((edge) => edge.type === 'closure-capture').length,
    2,
  )
})

test('exactly two available paths fill a quota of two without truncation', () => {
  const { inventory, flow } = data()
  flow.pathEdges.tuples.push(
    [{ id: 1 }, { id: 3 }, 'value-flow', ''],
    [{ id: 3 }, { id: 4 }, 'value-flow', ''],
  )

  const equal = exportResult(inventory, flow, sourceRoot, 'extended-state', {
    maxPaths: 2,
  })

  assert.equal(equal.paths.length, 4)
  assert(
    equal.searches.every(
      (search) =>
        search.complete &&
        search.pathLimitReached &&
        !search.additionalPathFound,
    ),
  )

  const overflow = exportResult(inventory, flow, sourceRoot, 'extended-state', {
    maxPaths: 1,
  })

  assert.equal(overflow.paths.length, 2)
  assert(
    overflow.searches.every(
      (search) => !search.complete && search.additionalPathFound,
    ),
  )
})

test('bounded selection is independent of aliases with identical context labels', () => {
  const { inventory, flow } = data()
  flow.pathNodes.tuples.push([{ id: 11 }, 'a', 'source'])
  flow.pathEdges = table([
    [{ id: 1 }, { id: 2 }, 'value-flow', ''],
    [{ id: 2 }, { id: 4 }, 'value-flow', ''],
    [{ id: 11 }, { id: 3 }, 'value-flow', ''],
    [{ id: 3 }, { id: 4 }, 'value-flow', ''],
  ])

  flow['#select'] = table([
    ['effect', 0, { id: 1 }, { id: 4 }],
    ['effect', 0, { id: 11 }, { id: 4 }],
  ])

  for (const maxPaths of [1, 2]) {
    const original = exportResult(
      inventory,
      flow,
      sourceRoot,
      'extended-state',
      { maxPaths },
    )

    const changed = JSON.parse(
      JSON.stringify(flow, (key, value: unknown) =>
        key === 'id' && typeof value === 'number' ? 10000 - value : value,
      ),
    ) as typeof flow

    for (const table of Object.values(changed)) table.tuples.reverse()
    assert.deepEqual(
      exportResult(inventory, changed, sourceRoot, 'extended-state', {
        maxPaths,
      }),
      original,
    )
  }
})

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
  assert.equal(
    new Set(result.dependencies.map((dependency) => dependency.id)).size,
    2,
  )

  assert.equal(result.paths.length, 2)

  const annotation = result.edges.find(
    (edge) => edge.type === 'closure-capture',
  )!

  assert.equal(annotation.composable, false)
  assert(result.paths.every((path) => !path.edges.includes(annotation.id)))
  assert(toDot(result).includes('useEffect (empty)'))
})

test('reports cycle and depth limits while terminating', () => {
  const { inventory, flow } = data()
  flow.pathEdges.tuples.push([{ id: 2 }, { id: 1 }, 'value-flow', ''])
  const result = exportResult(inventory, flow, sourceRoot, 'extended-state')
  assert(result.diagnostics.some((dependency) => dependency.reason === 'cycle'))

  const shallow = exportResult(inventory, flow, sourceRoot, 'extended-state', {
    maxDepth: 1,
  })

  assert.equal(shallow.truncated, true)
  assert(
    shallow.diagnostics.some(
      (dependency) => dependency.reason === 'depth-limit',
    ),
  )
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

  assert(
    result.diagnostics.some((dependency) => dependency.reason === 'path-limit'),
  )

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
  assert(result.edges.some((edge) => edge.type === 'call-argument'))
  assert(result.edges.some((edge) => edge.type === 'call-return'))
  flow.subpaths.tuples.push([{ id: 2 }, { id: 3 }, { id: 3 }, { id: 3 }])
  flow.pathEdges.tuples.push([{ id: 2 }, { id: 3 }, 'call-return', ''])

  const limited = exportResult(inventory, flow, sourceRoot, 'extended-state', {
    maxContexts: 1,
  })

  assert(
    limited.diagnostics.some(
      (dependency) => dependency.reason === 'context-limit',
    ),
  )
})

test('output is independent of CodeQL entity numbers and row order', () => {
  const { inventory, flow } = data()
  const first = exportResult(inventory, flow, sourceRoot, 'extended-state')

  const changed = JSON.parse(
    JSON.stringify(flow).replace(
      /"id":(\d+)/g,
      (_, number) => '"id":' + (+number + 1000),
    ),
  )

  for (const t of Object.values(changed) as { tuples: unknown[][] }[]) {
    t.tuples.reverse()
  }

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
    extended.filteredPaths.every(
      (path) => path.reason === 'mismatched-call-site',
    ),
  )

  contexts.callArguments = table([['a', 'b', 'dep', 'capturing-function']])
  assert.equal(
    exportResult(contexts, flow, sourceRoot, 'extended-state').paths.length,
    2,
  )
})
