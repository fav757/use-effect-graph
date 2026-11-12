import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { exportResult } from './export.ts'
import { assessPaths } from './path-oracle.ts'
import type { Bqrs } from './export.ts'
import type { PathOracle, Position } from './path-oracle.ts'

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

test('all path oracle positions identify syntax in the current fixtures', () => {
  const sources = new Map<string, ts.SourceFile>()

  const visit = (value: unknown, field = '') => {
    if (!value || typeof value !== 'object') return
    const entry = value as Record<string, unknown>

    if (typeof entry.file === 'string' && typeof entry.startLine === 'number') {
      const position = entry as Position & { kind?: string }
      let source = sources.get(position.file)

      if (!source) {
        source = ts.createSourceFile(
          position.file,
          readFileSync(join(fixtures, position.file), 'utf8'),
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TSX,
        )

        sources.set(position.file, source)
      }

      const matches: ts.Node[] = []

      const inspect = (node: ts.Node) => {
        const actual = source.getLineAndCharacterOfPosition(
          node.getStart(source),
        )

        if (
          actual.line + 1 === position.startLine &&
          actual.character + 1 === position.startColumn
        ) {
          matches.push(node)
        }

        ts.forEachChild(node, inspect)
      }

      inspect(source)
      const description = field + ': ' + JSON.stringify(position)
      assert(matches.length > 0, description)

      if (field === 'effect') {
        assert(
          matches.some(
            (node) =>
              ts.isCallExpression(node) &&
              node.expression.getText(source) === 'useEffect',
          ),
          description,
        )
      }

      if (field === 'target')
        assert(matches.some(ts.isFunctionDeclaration), description)
      if (position.kind === 'literal')
        assert(matches.some(ts.isStringLiteral), description)
      if (position.kind === 'parameter')
        assert(matches.some(ts.isParameter), description)

      if (position.kind === 'function-creation') {
        assert(matches.some(ts.isArrowFunction), description)
      }

      return
    }

    for (const [key, child] of Object.entries(entry)) visit(child, key)
  }

  visit(goldens)
})

function callResult() {
  // Independent facts for first('left-origin', 'unused-left'): only the first argument returns.
  const inventory: Bqrs = {
    '#select': table([
      ['effect', 'calls.tsx:11:3:11:34', 'value', 'useEffect'],
      ['a', 'calls.tsx:9:22:9:34', 'literal', 'left origin'],
      ['p', 'calls.tsx:4:16:4:20', 'parameter', 'value'],
      ['r', 'calls.tsx:5:10:5:14', 'value', 'value'],
      ['c', 'calls.tsx:9:16:9:50', 'value', 'first'],
      ['l', 'calls.tsx:9:9:9:12', 'value', 'left'],
      ['d', 'calls.tsx:11:24:11:27', 'value', 'left'],
    ]),
    effects: table([['effect', 'calls.tsx:11:3:11:34', 'literal']]),
    dependencies: table([['effect', 0, 'd', 'calls.tsx:11:24:11:27']]),
    annotations: table([]),
    callArguments: table([['a', 'p', 'c', 'calls.tsx:4:1:6:1#function']]),
    callReturns: table([['r', 'c', 'calls.tsx:4:1:6:1#function']]),
  }

  const flow: Bqrs = {
    pathNodes: table([
      [{ id: 1 }, 'a', "'left-origin' <CcAny>"],
      [{ id: 2 }, 'p', 'value <CcSomeCall> <value >'],
      [{ id: 3 }, 'r', 'value <CcSomeCall> <value >'],
      [{ id: 4 }, 'c', "first(' ... -left') <CcAny>"],
      [{ id: 5 }, 'l', 'left <CcAny>'],
      [{ id: 6 }, 'd', 'left'],
    ]),
    pathEdges: table([
      [{ id: 1 }, { id: 2 }, 'call-argument', ''],
      [{ id: 2 }, { id: 3 }, 'value-flow', ''],
      [{ id: 3 }, { id: 4 }, 'call-return', ''],
      [{ id: 4 }, { id: 5 }, 'value-flow', ''],
      [{ id: 5 }, { id: 6 }, 'value-flow', ''],
    ]),
    subpaths: table([]),
    '#select': table([['effect', 0, { id: 1 }, { id: 6 }]]),
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
  'context labels',
  'context order',
  'context count',
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

    if (mutation === 'context labels') {
      result.paths[0].contexts.fill('arbitrary-corrupted-context')
    }

    if (mutation === 'context order') {
      result.paths[0].contexts.reverse()
    }

    if (mutation === 'context count') {
      result.paths[0].contexts.pop()
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

test('context expectations distinguish forbidden routes', () => {
  const result = callResult()

  const forbidden: PathOracle = {
    schemaVersion: '1.0.0',
    required: [],
    forbidden: [{ ...oracle.required[0], id: 'forbidden-context-route' }],
  }

  assert.equal(assessPaths(result, forbidden).errors.length, 1)
  result.paths[0].contexts[1] = 'another invocation'
  assert.deepEqual(assessPaths(result, forbidden), {
    passed: ['forbidden-context-route'],
    errors: [],
  })
})

test('a valid contextual route cannot hide a corrupted sibling', () => {
  const result = callResult()
  const corrupted = structuredClone(result.paths[0])
  corrupted.id = 'corrupted-sibling'
  corrupted.contexts[1] = 'another invocation'
  result.paths.push(corrupted)
  const assessment = assessPaths(result, oracle)
  assert.deepEqual(assessment.passed, [])
  assert(assessment.errors.some((error) => error.includes(corrupted.id)))
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
