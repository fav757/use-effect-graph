import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

test('baseline entry loads its CSS and mounts the graph with report data', () => {
  const source = readFileSync(
    new URL('./viewer/legacy-main.tsx', import.meta.url),
    'utf8',
  )

  const script = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText

  type Element = { type: unknown; props: Record<string, unknown> }
  const root = {}
  const svg = '<svg viewBox="0 0 1 1"/>'
  const imports: string[] = []
  let rendered: Element | undefined
  const graph = () => null
  const jsx = (type: unknown, props: Element['props']) => ({ type, props })

  runInNewContext(script, {
    exports: {},
    window: {
      REPORT_ASSETS: { svg, stem: 'use-effects' },
      BASELINE_TOTALS: { effects: 2, nodes: 5 },
    },
    document: { getElementById: (id: string) => (id === 'root' ? root : null) },
    require: (name: string) => {
      imports.push(name)
      if (name === './legacy.css') return {}
      if (name === './Graph.tsx') return { Graph: graph }
      if (name === 'react/jsx-runtime')
        return { jsx, jsxs: jsx, Fragment: 'fragment' }

      if (name === 'react-dom/client') {
        return {
          createRoot: (element: unknown) => {
            assert.equal(element, root)
            return {
              render: (element: Element) => {
                rendered = element
              },
            }
          },
        }
      }

      throw new Error('Unexpected entry dependency: ' + name)
    },
  })

  assert(imports.includes('./legacy.css'))
  assert(rendered, 'baseline entry did not mount a report')
  const elements: Element[] = []

  const visit = (value: unknown) => {
    if (Array.isArray(value)) value.forEach(visit)
    else if (value && typeof value === 'object' && 'props' in value) {
      const element = value as Element
      elements.push(element)
      visit(element.props.children)
    }
  }

  visit(rendered)
  const mountedGraph = elements.find((element) => element.type === graph)
  assert.equal(mountedGraph?.props.svgMarkup, svg)
  assert.equal(mountedGraph?.props.legacy, true)
  assert.equal(mountedGraph?.props.visible, true)
  assert(
    elements.some(
      (element) => element.type === 'strong' && element.props.children === 2,
    ),
  )
})
