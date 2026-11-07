import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { EOL } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { command, isMain, main, options } from '../analysis/cli.ts'
import type { Command } from '../analysis/cli.ts'

/** CodeQL's headerless RFC 4180 CSV, including quoted commas, quotes, and newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [],
    field = '',
    quoted = false
  text = text.replace(/^\uFEFF/, '')
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"'
        index++
      } else {
        quoted = !quoted
      }
    } else if (char === ',' && !quoted) {
      row.push(field)
      field = ''
    } else if ((char === '\r' || char === '\n') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index++
      row.push(field)
      rows.push(row)
      row = []
      field = ''
    } else {
      field += char
    }
  }
  if (quoted) throw new Error('Unterminated CSV field')
  if (field || row.length) {
    row.push(field)
    rows.push(row)
  }
  for (const fields of rows) {
    if (fields.length !== 6) {
      throw new Error('Expected six columns in edges.csv')
    }
  }
  return rows
}
const escapeDot = (value: string) =>
  value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        character
      ]!,
  )
type Node = {
  id: string
  label: string
  url: string
  line: number
  kind: string
}
export function baselineDot(
  rows: string[][],
  readSource: (path: string) => string = (path) => readFileSync(path, 'utf8'),
) {
  const nodes = new Map<string, { label: string; url: string }>()
  for (const [
    parentId,
    parentLabel,
    parentUrl,
    childId,
    childLabel,
    childUrl,
  ] of rows) {
    nodes.set(parentId, { label: parentLabel, url: parentUrl })
    nodes.set(childId, { label: childLabel, url: childUrl })
  }
  const groups = new Map<string, Node[]>()
  const nodeKinds = new Map<string, string>()
  const sources = new Map<string, string[]>()
  let effectCount = 0
  for (const [id, node] of nodes) {
    const location = /^(.*):(\d+):(\d+):(\d+):(\d+)$/.exec(node.url)
    if (!location) throw new Error(`Invalid source URL: ${node.url}`)
    const file = location[1].split('/').at(-1)!
    const sourcePath = fileURLToPath(location[1])
    if (!sources.has(sourcePath)) {
      sources.set(sourcePath, readSource(sourcePath).split(/\r?\n/))
    }
    const line = Number(location[2])
    const callText = sources
      .get(sourcePath)!
      [line - 1].slice(Number(location[3]) - 1)
    let kind = 'dependency',
      label = node.label
    if (/^useEffectEvent\s*\(/i.test(callText)) {
      kind = 'event'
      label = 'useEffectEvent'
    } else if (/^useStableCallback\s*\(/i.test(callText)) {
      kind = 'stable'
      label = 'useStableCallback'
    } else if (/^useEffect\s*\(/i.test(callText)) {
      kind = 'effect'
      label = 'useEffect'
      effectCount++
    }
    nodeKinds.set(id, kind)
    const group = groups.get(file) ?? []
    group.push({ id, label, url: node.url, line, kind })
    groups.set(file, group)
  }
  const lines = [
    'digraph UseEffects {',
    'graph [rankdir=LR, bgcolor="#f5f7fb", pad="0.5", nodesep="0.28", ranksep="0.7", compound=true, fontname="Segoe UI", fontsize=18, fontcolor="#17233c"];',
    'node [shape=box, style="rounded,filled", margin="0.22,0.14", fontname="Segoe UI", fontsize=12, penwidth=1.2];',
    'edge [color="#9aaac2", penwidth=1.3, arrowsize=0.65];',
  ]
  let index = 0
  for (const [file, group] of [...groups].sort(([first], [second]) =>
    first.localeCompare(second, 'en', { sensitivity: 'base' }),
  )) {
    lines.push(
      `subgraph cluster_${index++} { label="${escapeDot(file)}"; labeljust=l; style="rounded,filled"; color="#dce3ee"; fillcolor="white"; margin=24;`,
    )
    for (const node of group.sort(
      (first, second) =>
        first.line - second.line ||
        first.label.localeCompare(second.label, 'en', { sensitivity: 'base' }),
    )) {
      let fill = '#f0f5ff',
        stroke = '#c8d8f3',
        ink = '#254b82'
      if (node.kind === 'effect') {
        fill = '#ede9fe'
        stroke = '#c4b5fd'
        ink = '#5b36a8'
      } else if (node.kind === 'event') {
        fill = '#fff3df'
        stroke = '#e7b768'
        ink = '#975700'
      } else if (node.kind === 'stable' || /^use[A-Z0-9]/.test(node.label)) {
        fill = '#e6f7f2'
        stroke = '#99d6c5'
        ink = '#176b57'
      }
      lines.push(
        `"${node.id}" [label=<<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="0"><TR><TD ALIGN="LEFT"><FONT COLOR="${ink}"><B>${escapeHtml(node.label)}</B></FONT></TD></TR><TR><TD ALIGN="LEFT"><FONT COLOR="#738199" POINT-SIZE="10">line ${node.line}</FONT></TD></TR></TABLE>>, fillcolor="${fill}", color="${stroke}", URL="${escapeDot(node.url)}", tooltip="${escapeDot(file)}:${node.line}"];`,
      )
    }
    lines.push('}')
  }
  for (const [parentId, , , childId] of rows) {
    let style = ''
    if (['event', 'stable'].includes(nodeKinds.get(parentId)!)) {
      style = ' [style=dashed, color="#c48336"]'
    } else if (
      nodeKinds.get(parentId) === 'effect' &&
      nodeKinds.get(childId) === 'event'
    ) {
      style = ' [style=dotted, color="#c48336"]'
    }
    lines.push(`"${parentId}" -> "${childId}"${style};`)
  }
  lines.push('}')
  return {
    dot: lines.join('\n') + '\n',
    totals: {
      effects: effectCount,
      nodes: nodes.size,
      connections: rows.length,
      files: groups.size,
    },
  }
}
export function renderBaseline(directory: string, execute: Command = command) {
  const { dot, totals } = baselineDot(
    parseCsv(readFileSync(join(directory, 'edges.csv'), 'utf8')),
  )
  writeFileSync(join(directory, 'use-effects.dot'), dot.replaceAll('\n', EOL))
  for (const format of ['svg', 'png']) {
    execute('dot', [
      `-T${format}`,
      join(directory, 'use-effects.dot'),
      '-o',
      join(directory, `use-effects.${format}`),
    ])
  }
  const svg = readFileSync(join(directory, 'use-effects.svg'), 'utf8')
  const assets = fileURLToPath(
    new URL('../analysis/viewer/dist/', import.meta.url),
  )
  for (const extension of ['js', 'css']) {
    copyFileSync(
      join(assets, `viewer-baseline.${extension}`),
      join(directory, `viewer-baseline.${extension}`),
    )
  }
  const serialize = (value: unknown) =>
    JSON.stringify(value).replaceAll('<', '\\u003c')
  writeFileSync(
    join(directory, 'use-effects.data.js'),
    `window.REPORT_ASSETS = ${serialize({ svg: svg.slice(svg.indexOf('<svg')), stem: 'use-effects' })};\nwindow.BASELINE_TOTALS = ${serialize(totals)};\n`,
  )
  writeFileSync(
    join(directory, 'use-effects.html'),
    '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Effect map · React dependency graph</title><link rel="stylesheet" href="./viewer-baseline.css"></head><body><div id="root"></div><script src="./use-effects.data.js"></script><script src="./viewer-baseline.js"></script></body></html>\n',
  )
  console.log(
    `Rendered ${totals.nodes} nodes and ${totals.connections} edges across ${totals.files} files.`,
  )
}
if (isMain(import.meta.url)) {
  main(() => {
    const parsed = options(process.argv.slice(2), ['OutputDirectory'])
    renderBaseline(
      resolve(
        String(
          parsed.OutputDirectory ?? dirname(fileURLToPath(import.meta.url)),
        ),
      ),
    )
  })
}
