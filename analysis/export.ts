import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve, relative, sep } from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath } from 'node:url'

export type Location = {
  file: string
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
}
export type Entity = {
  id: string
  location: Location
  kind: string
  label: string
  expression: string
}
type Table = { columns: { name: string; kind: string }[]; tuples: unknown[][] }
type Bqrs = Record<string, Table>
type RawNode = { entity: string; context: string }
type RawEdge = { from: string; to: string; kind: string; provenance: string }
type RawPair = { effect: string; index: number; source: string; sink: string }
type RawSubpath = { arg: string; par: string; ret: string; out: string }
type CallContext = { action: 'enter' | 'return'; site: string; target: string }
export type Limits = {
  maxDepth: number
  maxContexts: number
  maxPaths: number
  maxSteps: number
}
export type Result = ReturnType<typeof exportResult>
const defaults: Limits = {
  maxDepth: 96,
  maxContexts: 64,
  maxPaths: 128,
  maxSteps: 50000,
}
const hash = (s: string) =>
  createHash('sha256').update(s).digest('hex').slice(0, 24)
const rawId = (v: unknown): string =>
  typeof v === 'string' ? v : String((v as { id: number }).id)
const rows = (data: Bqrs, name: string): unknown[][] => {
  if (!data[name]) throw new Error('Missing BQRS result set: ' + name)
  return data[name].tuples
}
function location(value: string): Location {
  const match = /^(.*):(\d+):(\d+):(\d+):(\d+)$/.exec(value)
  if (!match) throw new Error('Invalid source position: ' + value)
  return {
    file: match[1],
    startLine: +match[2],
    startColumn: +match[3],
    endLine: +match[4],
    endColumn: +match[5],
  }
}
export function exportResult(
  inventory: Bqrs,
  flow: Bqrs,
  sourceRoot: string,
  mode: string,
  overrides: Partial<Limits> = {},
) {
  if (flow.collisions?.tuples.length)
    throw new Error(
      'CodeQL context keys collide; refusing to merge distinct flow contexts.',
    )
  const limits = { ...defaults, ...overrides }
  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1)
      throw new Error('Invalid limit: ' + key)
  }
  const files = new Map<string, string[]>()
  const entities = new Map<string, Entity>()
  for (const [id, pos, kind, label] of rows(
    inventory,
    '#select',
  ) as string[][]) {
    const loc = location(pos)
    if (!files.has(loc.file)) {
      const absolute = resolve(sourceRoot, loc.file)
      const rel = relative(resolve(sourceRoot), absolute)
      if (rel === '..' || rel.startsWith('..' + sep) || resolve(rel) === rel)
        throw new Error('Source outside root: ' + loc.file)
      files.set(loc.file, readFileSync(absolute, 'utf8').split(/\r?\n/))
    }
    const lines = files.get(loc.file)!
    let expression = lines
      .slice(loc.startLine - 1, loc.endLine)
      .map((line, i) => {
        const first = i === 0 ? loc.startColumn - 1 : 0
        const last =
          loc.startLine + i === loc.endLine ? loc.endColumn : line.length
        return line.slice(first, last)
      })
      .join('\n')
    entities.set(id, { id, location: loc, kind, label, expression })
  }
  const effects = (rows(inventory, 'effects') as string[][])
    .map(([id, pos, mode]) => ({ id, location: location(pos), mode }))
    .sort((a, b) => a.id.localeCompare(b.id, 'en'))
  const dependencies = rows(inventory, 'dependencies')
    .map(([effect, index, entity]) => ({
      id: String(effect) + '/dependency:' + index,
      effectId: String(effect),
      index: Number(index),
      entityId: String(entity),
      expression: entities.get(String(entity))?.expression ?? '',
    }))
    .sort((a, b) => a.id.localeCompare(b.id, 'en'))
  const nodes = new Map<string, RawNode>(
    rows(flow, 'pathNodes').map(([id, entity, context]) => [
      rawId(id),
      { entity: String(entity), context: String(context) },
    ]),
  )
  const adjacency = new Map<string, RawEdge[]>()
  for (const [a, b, kind, provenance] of rows(flow, 'pathEdges')) {
    const edge = {
      from: rawId(a),
      to: rawId(b),
      kind: String(kind),
      provenance: String(provenance),
    }
    const list = adjacency.get(edge.from) ?? []
    list.push(edge)
    adjacency.set(edge.from, list)
  }
  const stableRaw = (id: string) => {
    const n = nodes.get(id)
    return n ? n.entity + ':' + n.context : 'unmapped'
  }
  for (const list of adjacency.values())
    list.sort((a, b) => stableRaw(a.to).localeCompare(stableRaw(b.to), 'en'))
  const subpaths = new Map<string, RawSubpath[]>()
  for (const [arg, par, ret, out] of rows(flow, 'subpaths')) {
    const s = {
      arg: rawId(arg),
      par: rawId(par),
      ret: rawId(ret),
      out: rawId(out),
    }
    const key = s.arg + ':' + s.out
    const list = subpaths.get(key) ?? []
    list.push(s)
    subpaths.set(key, list)
  }
  for (const list of subpaths.values())
    list.sort((a, b) =>
      (stableRaw(a.par) + stableRaw(a.ret)).localeCompare(
        stableRaw(b.par) + stableRaw(b.ret),
        'en',
      ),
    )
  const pairs: RawPair[] = rows(flow, '#select').map(
    ([effect, index, source, sink]) => ({
      effect: String(effect),
      index: Number(index),
      source: rawId(source),
      sink: rawId(sink),
    }),
  )
  pairs.sort((a, b) =>
    (a.effect + ':' + a.index + ':' + stableRaw(a.source)).localeCompare(
      b.effect + ':' + b.index + ':' + stableRaw(b.source),
      'en',
    ),
  )
  const used = new Set(
    effects.map((e) => e.id).concat(dependencies.map((d) => d.entityId)),
  )
  const callEvidence = new Map<string, CallContext[]>()
  const addContext = (from: string, to: string, context: CallContext) => {
    const key = from + '\u0000' + to
    const list = callEvidence.get(key) ?? []
    if (!list.some((c) => JSON.stringify(c) === JSON.stringify(context)))
      list.push(context)
    callEvidence.set(key, list)
  }
  for (const [argument, parameter, site, target] of (inventory.callArguments
    ?.tuples ?? []) as string[][]) {
    addContext(argument, parameter, { action: 'enter', site, target })
  }
  for (const [returned, site, target] of (inventory.callReturns?.tuples ??
    []) as string[][]) {
    addContext(returned, site, { action: 'return', site, target })
  }
  const edgeContexts = (edge: RawEdge) =>
    callEvidence.get(
      nodes.get(edge.from)!.entity + '\u0000' + nodes.get(edge.to)!.entity,
    ) ?? []
  const edgeMap = new Map<
    string,
    {
      id: string
      from: string
      to: string
      type: string
      evidence: Location
      rule: string
      status: string
      composable: boolean
      provenance: string
      callContext?: CallContext
    }
  >()
  const paths: {
    id: string
    dependencyId: string
    source: string
    sourceRole: string
    nodes: string[]
    edges: string[]
    stopReason: string
    status: string
  }[] = []
  const boundaries: {
    dependencyId: string
    reason: string
    entityId: string
    status: string
  }[] = []
  const diagnostics: {
    dependencyId: string
    reason: string
    status: string
  }[] = []
  const filteredPaths: {
    dependencyId: string
    source: string
    reason: string
    enteredAt: string
    returnedAt: string
    target: string
  }[] = []
  const addEdge = (
    from: string,
    to: string,
    type: string,
    rule: string,
    composable: boolean,
    provenance = '',
    callContext?: CallContext,
  ) => {
    const target = entities.get(to)
    if (!target || !entities.has(from))
      throw new Error('Unmapped flow entity: ' + from + ' -> ' + to)
    const id =
      'edge:' +
      hash(JSON.stringify([from, to, type, rule, provenance, callContext]))
    used.add(from)
    used.add(to)
    if (callContext && entities.has(callContext.site))
      used.add(callContext.site)
    edgeMap.set(id, {
      id,
      from,
      to,
      type,
      evidence: target.location,
      rule,
      status: composable ? 'modeled' : 'annotation',
      composable,
      provenance,
      ...(callContext ? { callContext } : {}),
    })
    return id
  }
  for (const dep of dependencies) {
    addEdge(
      dep.entityId,
      dep.effectId,
      'effect-dependency',
      'dependency-array-position:' + dep.index,
      false,
    )
    const relevant = pairs.filter(
      (p) => p.effect === dep.effectId && p.index === dep.index,
    )
    let steps = 0
    let count = 0
    const contexts = new Set<string>()
    const issues = new Set<string>()
    const dedup = new Set<string>()
    function* walk(
      current: string,
      target: string,
      seen: Set<string>,
      depth: number,
    ): Generator<RawEdge[]> {
      if (++steps > limits.maxSteps) {
        issues.add('step-limit')
        return
      }
      if (depth > limits.maxDepth) {
        issues.add('depth-limit')
        return
      }
      if (!nodes.has(current)) {
        issues.add('unmapped-codeql-node')
        return
      }
      if (seen.has(current)) {
        issues.add('cycle')
        return
      }
      if (current === target) {
        yield []
        return
      }
      const nextSeen = new Set(seen).add(current)
      for (const edge of adjacency.get(current) ?? []) {
        const summaries = subpaths.get(edge.from + ':' + edge.to) ?? []
        if (summaries.length > 0) {
          for (const sub of summaries) {
            const evidence = callEvidence.get(
              nodes.get(sub.arg)?.entity +
                '\u0000' +
                nodes.get(sub.par)?.entity,
            )
            const context =
              evidence?.length === 1
                ? evidence[0].site
                : stableRaw(sub.arg) + ' -> ' + stableRaw(sub.out)
            contexts.add(context)
            if (contexts.size > limits.maxContexts) {
              issues.add('context-limit')
              return
            }
            for (const inner of walk(sub.par, sub.ret, nextSeen, depth + 1)) {
              const enter: RawEdge = {
                from: sub.arg,
                to: sub.par,
                kind: 'call-argument',
                provenance: 'CodeQL.PathGraph.subpaths',
              }
              const leave: RawEdge = {
                from: sub.ret,
                to: sub.out,
                kind: 'call-return',
                provenance: 'CodeQL.PathGraph.subpaths',
              }
              for (const tail of walk(
                edge.to,
                target,
                nextSeen,
                depth + inner.length + 2,
              )) {
                yield [enter, ...inner, leave, ...tail]
                if (count >= limits.maxPaths || steps > limits.maxSteps) return
              }
            }
          }
        } else {
          for (const tail of walk(edge.to, target, nextSeen, depth + 1)) {
            yield [edge, ...tail]
            if (count >= limits.maxPaths || steps > limits.maxSteps) return
          }
        }
      }
    }
    for (const pair of relevant) {
      if (count >= limits.maxPaths) {
        issues.add('path-limit')
        break
      }
      const source = nodes.get(pair.source)
      if (!source) {
        issues.add('unmapped-codeql-node')
        continue
      }
      for (const raw of walk(pair.source, pair.sink, new Set(), 0)) {
        if (count >= limits.maxPaths) {
          issues.add('path-limit')
          break
        }
        if (raw.length > limits.maxDepth) {
          issues.add('depth-limit')
          continue
        }
        const sequence = [
          source.entity,
          ...raw.map((e) => nodes.get(e.to)?.entity ?? ''),
        ]
        if (sequence.some((id) => !entities.has(id))) {
          issues.add('unmapped-codeql-node')
          continue
        }
        if (mode.startsWith('extended')) {
          const frames: CallContext[] = []
          let rejected = false
          for (const edge of raw) {
            const actions = edgeContexts(edge)
            if (actions.length > 1) {
              issues.add('ambiguous-call-context')
              rejected = true
              break
            }
            const context = actions[0]
            if (!context) continue
            contexts.add(context.site)
            if (contexts.size > limits.maxContexts) {
              issues.add('context-limit')
              rejected = true
              break
            }
            if (context.action === 'enter') frames.push(context)
            else {
              const index = frames.findLastIndex(
                (frame) => frame.target === context.target,
              )
              if (index < 0) continue
              const entered = frames[index]
              if (entered.site !== context.site) {
                for (const id of [source.entity, entered.site, context.site])
                  if (entities.has(id)) used.add(id)
                filteredPaths.push({
                  dependencyId: dep.id,
                  source: source.entity,
                  reason: 'mismatched-call-site',
                  enteredAt: entered.site,
                  returnedAt: context.site,
                  target: context.target,
                })
                rejected = true
                break
              }
              frames.splice(index, 1)
            }
          }
          if (rejected) continue
        }
        const key = JSON.stringify(sequence)
        if (dedup.has(key)) continue
        dedup.add(key)
        const origin = entities.get(source.entity)!
        used.add(source.entity)
        const ids = raw.map((e) =>
          addEdge(
            nodes.get(e.from)!.entity,
            nodes.get(e.to)!.entity,
            e.kind,
            e.kind === 'callback-identity'
              ? 'extension.react-callback-identity'
              : 'CodeQL.' + mode,
            true,
            e.provenance,
            edgeContexts(e).length === 1 ? edgeContexts(e)[0] : undefined,
          ),
        )
        const stopReason =
          (
            {
              'react-state': 'react-state',
              'unknown-call': 'unknown-call',
              literal: 'literal',
              'function-creation': 'function-identity',
              'object-creation': 'object-identity',
              'array-creation': 'array-identity',
              parameter: 'parameter-interface',
              'property-read': 'property-observation',
            } as Record<string, string>
          )[origin.kind] ?? 'analysis-boundary'
        const sourceRole = ['parameter', 'property-read'].includes(origin.kind)
          ? 'observation'
          : 'origin'
        paths.push({
          id: 'path:' + hash(dep.id + key),
          dependencyId: dep.id,
          source: source.entity,
          sourceRole,
          nodes: sequence,
          edges: ids,
          stopReason,
          status: 'modeled',
        })
        boundaries.push({
          dependencyId: dep.id,
          reason: stopReason,
          entityId: source.entity,
          status: sourceRole,
        })
        count++
      }
      if (steps > limits.maxSteps || contexts.size > limits.maxContexts) break
    }
    if (count >= limits.maxPaths) issues.add('path-limit')
    if (count === 0)
      boundaries.push({
        dependencyId: dep.id,
        reason: 'no-modeled-origin',
        entityId: dep.entityId,
        status: 'incomplete',
      })
    for (const reason of [...issues].sort())
      diagnostics.push({
        dependencyId: dep.id,
        reason,
        status: reason === 'cycle' ? 'bounded' : 'truncated',
      })
  }
  for (const [parent, child, kind] of rows(
    inventory,
    'annotations',
  ) as string[][]) {
    if (used.has(parent) && entities.has(child))
      addEdge(
        child,
        parent,
        kind,
        kind === 'closure-capture'
          ? 'annotation.lexical-capture'
          : 'annotation.declared-hook-dependency',
        false,
      )
  }
  for (const effect of effects) {
    if (effect.mode === 'unsupported')
      diagnostics.push({
        dependencyId: effect.id,
        reason: 'unsupported-dependency-array',
        status: 'incomplete',
      })
  }
  return {
    schemaVersion: '1.0.0',
    mode,
    limits,
    semantics: {
      direction: 'source-to-dependency',
      pathComposition: 'CodeQL contextual path edges; matched subpaths only',
      annotationsComposable: false,
      stateOrdering: 'not-modeled',
      capturedParameterContextCheck: mode.startsWith('extended'),
      approximations: [
        'CodeQL may-flow analysis',
        'captured variables may be flow-insensitive',
        'interface and property observations are not terminal origins',
      ],
    },
    effects,
    dependencies,
    entities: [...entities.values()]
      .filter((e) => used.has(e.id))
      .sort((a, b) => a.id.localeCompare(b.id, 'en')),
    edges: [...edgeMap.values()].sort((a, b) => a.id.localeCompare(b.id, 'en')),
    paths: paths.sort((a, b) => a.id.localeCompare(b.id, 'en')),
    boundaries: boundaries.sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'),
    ),
    diagnostics: diagnostics.sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'),
    ),
    filteredPaths: filteredPaths.sort((a, b) =>
      JSON.stringify(a).localeCompare(JSON.stringify(b), 'en'),
    ),
    truncated: diagnostics.some((d) => d.status === 'truncated'),
  }
}
export function toDot(result: Result) {
  const quote = (value: string) => JSON.stringify(value)
  const html = (value: string) =>
    value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
  const compact = (value: string) => {
    const text = value.replace(/\s+/g, ' ').trim()
    return text.length > 48 ? text.slice(0, 45) + '…' : text
  }
  const lines = [
    'digraph Provenance {',
    'graph [rankdir=LR, bgcolor="#f8fafc", pad="0.45", nodesep="0.35", ranksep="0.65", outputorder=edgesfirst];',
    'node [shape=box, style="rounded,filled", fillcolor="white", color="#dce2ec", penwidth=1.2, margin="0.18,0.13", fontname="Segoe UI", fontsize=12];',
    'edge [color="#b3bfd2", arrowsize=0.6, penwidth=1.1, fontname="Segoe UI", fontsize=10, fontcolor="#64748b"];',
  ]
  const effects = new Map(result.effects.map((e) => [e.id, e]))
  for (const entity of result.entities) {
    const effect = effects.get(entity.id)
    const palette = effect
      ? ['#f0edff', '#c7baf9', '#6750c5']
      : entity.kind === 'react-state'
        ? ['#ecf9f3', '#a9ddc7', '#1d8060']
        : entity.kind === 'unknown-call'
          ? ['#fff8e9', '#ead29f', '#a46b18']
          : ['#ffffff', '#dce2ec', '#64748b']
    const kind = effect
      ? 'REACT EFFECT'
      : entity.kind.replaceAll('-', ' ').toUpperCase()
    const text = effect
      ? 'useEffect (' + effect.mode + ')'
      : compact(entity.expression || entity.label)
    const file =
      entity.location.file.split('/').at(-1) + ':' + entity.location.startLine
    const label =
      '<TABLE BORDER="0" CELLBORDER="0" CELLSPACING="0" CELLPADDING="2"><TR><TD ALIGN="LEFT"><FONT COLOR="' +
      palette[2] +
      '" POINT-SIZE="9">' +
      html(kind) +
      '</FONT></TD></TR><TR><TD ALIGN="LEFT"><FONT COLOR="#24324b"><B>' +
      html(text) +
      '</B></FONT></TD></TR><TR><TD ALIGN="LEFT"><FONT COLOR="#8692a7" POINT-SIZE="10">' +
      html(file) +
      '</FONT></TD></TR></TABLE>'
    lines.push(
      quote(entity.id) +
        ' [label=<' +
        label +
        '>,fillcolor="' +
        palette[0] +
        '",color="' +
        palette[1] +
        '",tooltip=' +
        quote(
          entity.expression +
            '\n' +
            entity.location.file +
            ':' +
            entity.location.startLine,
        ) +
        '];',
    )
  }
  for (const edge of result.edges) {
    const annotation = ['closure-capture', 'hook-dependency'].includes(
      edge.type,
    )
    const special = edge.type !== 'value-flow'
    lines.push(
      quote(edge.from) +
        ' -> ' +
        quote(edge.to) +
        ' [id=' +
        quote(edge.id) +
        ',tooltip=' +
        quote(edge.type + '\n' + edge.rule) +
        ',label=' +
        quote(special ? edge.type.replaceAll('-', ' ') : '') +
        ',color="' +
        (annotation
          ? '#c49a5e'
          : edge.type.startsWith('state-')
            ? '#65aa92'
            : edge.type === 'effect-dependency'
              ? '#9b88d5'
              : '#b3bfd2') +
        '",style=' +
        (edge.type === 'closure-capture'
          ? 'dashed'
          : edge.type === 'hook-dependency'
            ? 'dotted'
            : 'solid') +
        (annotation ? ',constraint=false' : '') +
        '];',
    )
  }
  lines.push('}')
  return lines.join('\n') + '\n'
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [inventoryPath, flowPath, sourceRoot, mode, output, limitsPath] =
    process.argv.slice(2)
  if (!output)
    throw new Error(
      'Usage: node analysis/export.ts inventory.json flow.json sourceRoot mode output.json [limits.json]',
    )
  const result = exportResult(
    JSON.parse(readFileSync(inventoryPath, 'utf8').replace(/^\uFEFF/, '')),
    JSON.parse(readFileSync(flowPath, 'utf8').replace(/^\uFEFF/, '')),
    sourceRoot,
    mode,
    limitsPath
      ? JSON.parse(readFileSync(limitsPath, 'utf8').replace(/^\uFEFF/, ''))
      : {},
  )
  mkdirSync(resolve(output, '..'), { recursive: true })
  writeFileSync(output, JSON.stringify(result, null, 2) + '\n')
  writeFileSync(output.replace(/\.json$/, '.dot'), toDot(result))
  process.stdout.write(
    mode +
      ': ' +
      result.effects.length +
      ' effects, ' +
      result.dependencies.length +
      ' dependencies, ' +
      result.paths.length +
      ' paths\n',
  )
}
