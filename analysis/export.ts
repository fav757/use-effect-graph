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
export type Bqrs = Record<string, Table>
type RawNode = { entity: string; context: string }
type Summary = { type: string; provenance: string }
type RawEdge = {
  from: string
  to: string
  kind: string
  provenance: string
  summary?: Summary
}
type RawPair = { effect: string; index: number; source: string; sink: string }
type RawSubpath = { arg: string; par: string; ret: string; out: string }
export type CallContext = {
  action: 'enter' | 'return'
  site: string
  target: string
}
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

const hash = (source: string) =>
  createHash('sha256').update(source).digest('hex').slice(0, 24)

const rawId = (value: unknown): string =>
  typeof value === 'string' ? value : String((value as { id: number }).id)

const rows = (data: Bqrs, name: string): unknown[][] => {
  if (!data[name]) throw new Error('Missing BQRS result set: ' + name)
  return data[name].tuples
}

const compare = (left: string, right: string) =>
  left < right ? -1 : left > right ? 1 : 0

const unique = <T>(values: T[]): T[] => [
  ...new Map(values.map((value) => [JSON.stringify(value), value])).values(),
]

const pairKey = (left: string, right: string) => JSON.stringify([left, right])

/** Refine source-labeled neighborhoods for ordering only; never join contextual nodes. */
function contextualOrder(
  nodes: Map<string, RawNode>,
  adjacency: Map<string, RawEdge[]>,
  summaries: Map<string, RawSubpath[]>,
  pairs: RawPair[],
) {
  const roles = new Map<string, string[]>()

  for (const pair of pairs) {
    for (const [node, role] of [
      [pair.source, 'source'],
      [pair.sink, 'sink'],
    ]) {
      const list = roles.get(node) ?? []
      list.push(JSON.stringify([role, pair.effect, pair.index]))
      roles.set(node, list)
    }
  }

  const links = new Map<string, { role: string; nodes: string[] }[]>()

  const link = (node: string, role: string, others: string[]) => {
    const list = links.get(node) ?? []
    list.push({ role, nodes: others })
    links.set(node, list)
  }

  for (const list of adjacency.values()) {
    for (const edge of list) {
      const label = JSON.stringify([edge.kind, edge.provenance])
      link(edge.from, 'out:' + label, [edge.to])
      link(edge.to, 'in:' + label, [edge.from])
    }
  }

  for (const list of summaries.values()) {
    for (const sub of list) {
      const tuple = [sub.arg, sub.par, sub.ret, sub.out]
      tuple.forEach((node, index) => link(node, 'summary:' + index, tuple))
    }
  }

  const base = new Map(
    [...nodes].map(([id, node]) => [
      id,
      JSON.stringify([
        node.entity,
        node.context,
        [...new Set(roles.get(id) ?? [])].sort(compare),
      ]),
    ]),
  )

  const rank = (keys: Map<string, string>) => {
    const sorted = [...new Set(keys.values())].sort(compare)
    const indices = new Map(sorted.map((value, index) => [value, index]))
    return new Map([...keys].map(([id, key]) => [id, indices.get(key)!]))
  }

  let classes = rank(base)

  for (let round = 0; round < nodes.size; round++) {
    const keys = new Map(
      [...nodes.keys()].map((id) => [
        id,
        JSON.stringify([
          base.get(id),
          classes.get(id),
          (links.get(id) ?? [])
            .map((link) =>
              JSON.stringify([
                link.role,
                link.nodes.map((node) => classes.get(node)),
              ]),
            )
            .sort(compare),
        ]),
      ]),
    )

    const next = rank(keys)

    const stable =
      new Set(next.values()).size === new Set(classes.values()).size

    classes = next
    if (stable) break
  }

  return new Map(
    [...nodes.keys()].map((id) => [
      id,
      JSON.stringify([base.get(id), classes.get(id)]),
    ]),
  )
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
  if (flow.collisions?.tuples.length) {
    throw new Error(
      'CodeQL context keys collide; refusing to merge distinct flow contexts.',
    )
  }

  const limits = { ...defaults, ...overrides }

  for (const [key, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      throw new Error('Invalid limit: ' + key)
    }
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

      if (rel === '..' || rel.startsWith('..' + sep) || resolve(rel) === rel) {
        throw new Error('Source outside root: ' + loc.file)
      }

      files.set(loc.file, readFileSync(absolute, 'utf8').split(/\r?\n/))
    }

    const lines = files.get(loc.file)!

    const expression = lines
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
    .sort((left, right) => left.id.localeCompare(right.id, 'en'))

  const dependencies = rows(inventory, 'dependencies')
    .map(([effect, index, entity]) => ({
      id: String(effect) + '/dependency:' + index,
      effectId: String(effect),
      index: Number(index),
      entityId: String(entity),
      expression: entities.get(String(entity))?.expression ?? '',
    }))
    .sort((left, right) => left.id.localeCompare(right.id, 'en'))

  const nodes = new Map<string, RawNode>()

  for (const [id, entity, context] of rows(flow, 'pathNodes')) {
    const key = rawId(id),
      value = { entity: String(entity), context: String(context) }

    if (
      nodes.has(key) &&
      JSON.stringify(nodes.get(key)) !== JSON.stringify(value)
    ) {
      throw new Error('Conflicting BQRS path node: ' + key)
    }

    nodes.set(key, value)
  }

  const adjacency = new Map<string, RawEdge[]>()

  for (const [left, right, kind, provenance] of unique(
    rows(flow, 'pathEdges'),
  )) {
    const edge = {
      from: rawId(left),
      to: rawId(right),
      kind: String(kind),
      provenance: String(provenance),
    }

    const list = adjacency.get(edge.from) ?? []
    list.push(edge)
    adjacency.set(edge.from, list)
  }

  const stableRaw = (id: string) => {
    const node = nodes.get(id)
    return node ? JSON.stringify([node.entity, node.context]) : 'unmapped'
  }

  const subpaths = new Map<string, RawSubpath[]>()

  for (const [arg, par, ret, out] of unique(rows(flow, 'subpaths'))) {
    const source = {
      arg: rawId(arg),
      par: rawId(par),
      ret: rawId(ret),
      out: rawId(out),
    }

    const key = pairKey(source.arg, source.out)
    const list = subpaths.get(key) ?? []
    list.push(source)
    subpaths.set(key, list)
  }

  const pairs: RawPair[] = unique(rows(flow, '#select')).map(
    ([effect, index, source, sink]) => ({
      effect: String(effect),
      index: Number(index),
      source: rawId(source),
      sink: rawId(sink),
    }),
  )

  const order = contextualOrder(nodes, adjacency, subpaths, pairs)
  const nodeOrder = (id: string) => order.get(id) ?? stableRaw(id)

  for (const list of adjacency.values()) {
    list.sort((left, right) =>
      compare(
        JSON.stringify([nodeOrder(left.to), left.kind, left.provenance]),
        JSON.stringify([nodeOrder(right.to), right.kind, right.provenance]),
      ),
    )
  }

  for (const list of subpaths.values()) {
    list.sort((left, right) =>
      compare(
        JSON.stringify([left.arg, left.par, left.ret, left.out].map(nodeOrder)),
        JSON.stringify(
          [right.arg, right.par, right.ret, right.out].map(nodeOrder),
        ),
      ),
    )
  }

  pairs.sort((left, right) =>
    compare(
      JSON.stringify([
        left.effect,
        left.index,
        nodeOrder(left.source),
        nodeOrder(left.sink),
      ]),
      JSON.stringify([
        right.effect,
        right.index,
        nodeOrder(right.source),
        nodeOrder(right.sink),
      ]),
    ),
  )

  const used = new Set(
    effects
      .map((effect) => effect.id)
      .concat(dependencies.map((dependency) => dependency.entityId)),
  )

  const callEvidence = new Map<string, CallContext[]>()

  const addContext = (from: string, to: string, context: CallContext) => {
    const key = from + '\u0000' + to
    const list = callEvidence.get(key) ?? []

    if (
      !list.some(
        (existing) => JSON.stringify(existing) === JSON.stringify(context),
      )
    ) {
      list.push(context)
    }

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
      summary?: Summary
    }
  >()

  const paths: {
    id: string
    dependencyId: string
    source: string
    sourceRole: string
    nodes: string[]
    edges: string[]
    contexts: string[]
    stopReason: string
    status: string
  }[] = []

  const searches: {
    dependencyId: string
    retainedPaths: number
    pathLimitReached: boolean
    additionalPathFound: boolean
    complete: boolean
    steps: number
    contexts: number
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
    summary?: Summary,
  ) => {
    const target = entities.get(to)

    if (!target || !entities.has(from)) {
      throw new Error('Unmapped flow entity: ' + from + ' -> ' + to)
    }

    const id =
      'edge:' +
      hash(
        JSON.stringify([
          from,
          to,
          type,
          rule,
          target.location,
          provenance,
          callContext,
          summary,
        ]),
      )

    used.add(from)
    used.add(to)

    if (callContext && entities.has(callContext.site)) {
      used.add(callContext.site)
    }

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
      ...(summary ? { summary } : {}),
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
      (path) => path.effect === dep.effectId && path.index === dep.index,
    )

    let steps = 0
    let count = 0
    let additionalPathFound = false
    const contexts = new Set<string>()
    const issues = new Set<string>()
    const dedup = new Set<string>()

    const registerContext = (context: string) => {
      if (contexts.has(context)) return true

      if (contexts.size >= limits.maxContexts) {
        issues.add('context-limit')
        return false
      }

      contexts.add(context)
      return true
    }

    function* walk(
      current: string,
      target: string,
      seen: Set<string>,
      depth: number,
    ): Generator<RawEdge[]> {
      if (
        additionalPathFound ||
        issues.has('step-limit') ||
        issues.has('context-limit')
      ) {
        return
      }

      if (steps >= limits.maxSteps) {
        issues.add('step-limit')
        return
      }

      steps++

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
        const summaries = subpaths.get(pairKey(edge.from, edge.to)) ?? []

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

            if (!registerContext(context)) return

            for (const inner of walk(sub.par, sub.ret, nextSeen, depth + 1)) {
              const enter: RawEdge = {
                from: sub.arg,
                to: sub.par,
                kind: 'call-argument',
                provenance: 'CodeQL.PathGraph.subpaths',
                summary: { type: edge.kind, provenance: edge.provenance },
              }

              const leave: RawEdge = {
                from: sub.ret,
                to: sub.out,
                kind: 'call-return',
                provenance: 'CodeQL.PathGraph.subpaths',
                summary: { type: edge.kind, provenance: edge.provenance },
              }

              for (const tail of walk(
                edge.to,
                target,
                nextSeen,
                depth + inner.length + 2,
              )) {
                yield [enter, ...inner, leave, ...tail]

                if (
                  additionalPathFound ||
                  issues.has('step-limit') ||
                  issues.has('context-limit')
                ) {
                  return
                }
              }
            }
          }
        } else {
          for (const tail of walk(edge.to, target, nextSeen, depth + 1)) {
            yield [edge, ...tail]

            if (
              additionalPathFound ||
              issues.has('step-limit') ||
              issues.has('context-limit')
            ) {
              return
            }
          }
        }
      }
    }

    for (const pair of relevant) {
      if (additionalPathFound) break
      const source = nodes.get(pair.source)

      if (!source) {
        issues.add('unmapped-codeql-node')
        continue
      }

      for (const raw of walk(pair.source, pair.sink, new Set(), 0)) {
        if (raw.length > limits.maxDepth) {
          issues.add('depth-limit')
          continue
        }

        const sequence = [
          source.entity,
          ...raw.map((entry) => nodes.get(entry.to)?.entity ?? ''),
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

            if (!registerContext(context.site)) {
              rejected = true
              break
            }

            if (context.action === 'enter') {
              frames.push(context)
            } else {
              const index = frames.findLastIndex(
                (frame) => frame.target === context.target,
              )

              if (index < 0) continue
              const entered = frames[index]

              if (entered.site !== context.site) {
                for (const id of [source.entity, entered.site, context.site]) {
                  if (entities.has(id)) used.add(id)
                }

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

        const pathContexts = [
          source.context,
          ...raw.map((edge) => nodes.get(edge.to)!.context),
        ]

        const transitions = raw.map((edge) => ({
          from: nodes.get(edge.from)!.entity,
          to: nodes.get(edge.to)!.entity,
          type: edge.kind,
          evidence: entities.get(nodes.get(edge.to)!.entity)!.location,
          rule:
            edge.kind === 'callback-identity'
              ? 'extension.react-callback-identity'
              : 'CodeQL.' + mode,
          provenance: edge.provenance,
          callContext:
            edgeContexts(edge).length === 1 ? edgeContexts(edge)[0] : undefined,
          summary: edge.summary,
        }))

        const key = JSON.stringify([sequence, pathContexts, transitions])
        if (dedup.has(key)) continue
        dedup.add(key)

        if (count === limits.maxPaths) {
          additionalPathFound = true
          issues.add('path-limit')
          break
        }

        const origin = entities.get(source.entity)!
        used.add(source.entity)

        const ids = raw.map((entry) =>
          addEdge(
            nodes.get(entry.from)!.entity,
            nodes.get(entry.to)!.entity,
            entry.kind,
            entry.kind === 'callback-identity'
              ? 'extension.react-callback-identity'
              : 'CodeQL.' + mode,
            true,
            entry.provenance,
            edgeContexts(entry).length === 1
              ? edgeContexts(entry)[0]
              : undefined,
            entry.summary,
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
          contexts: pathContexts,
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

      if (issues.has('step-limit') || issues.has('context-limit')) break
    }

    searches.push({
      dependencyId: dep.id,
      retainedPaths: count,
      pathLimitReached: count === limits.maxPaths,
      additionalPathFound,
      complete: [...issues].every((reason) => reason === 'cycle'),
      steps,
      contexts: contexts.size,
    })

    if (count === 0) {
      boundaries.push({
        dependencyId: dep.id,
        reason: 'no-modeled-origin',
        entityId: dep.entityId,
        status: 'incomplete',
      })
    }

    for (const reason of [...issues].sort()) {
      diagnostics.push({
        dependencyId: dep.id,
        reason,
        status: reason === 'cycle' ? 'bounded' : 'truncated',
      })
    }
  }

  const annotations = new Map<string, string[][]>()

  for (const row of unique(rows(inventory, 'annotations')) as string[][]) {
    const list = annotations.get(row[0]) ?? []
    list.push(row)
    annotations.set(row[0], list)
  }

  const annotated = [...used]

  for (let index = 0; index < annotated.length; index++) {
    for (const [parent, child, kind] of annotations.get(annotated[index]) ??
      []) {
      if (!entities.has(child)) continue
      const newlyReached = !used.has(child)
      addEdge(
        child,
        parent,
        kind,
        kind === 'closure-capture'
          ? 'annotation.lexical-capture'
          : 'annotation.declared-hook-dependency',
        false,
      )

      if (newlyReached) annotated.push(child)
    }
  }

  for (const effect of effects) {
    if (effect.mode === 'unsupported') {
      diagnostics.push({
        dependencyId: effect.id,
        reason: 'unsupported-dependency-array',
        status: 'incomplete',
      })
    }
  }

  return {
    schemaVersion: '2.0.0',
    mode,
    limits,
    semantics: {
      direction: 'source-to-dependency',
      pathComposition: 'CodeQL contextual path edges; matched subpaths only',
      annotationsComposable: false,
      stateOrdering: 'not-modeled',
      capturedParameterContextCheck: mode.startsWith('extended'),
      pathEquivalence:
        'dependency, ordered entities and contextual labels, ordered transition types, evidence, rules, provenance, call contexts and summaries',
      approximations: [
        'CodeQL may-flow analysis',
        'captured variables may be flow-insensitive',
        'interface and property observations are not terminal origins',
      ],
    },
    effects,
    dependencies,
    entities: [...entities.values()]
      .filter((entry) => used.has(entry.id))
      .sort((left, right) => left.id.localeCompare(right.id, 'en')),
    edges: [...edgeMap.values()].sort((left, right) =>
      left.id.localeCompare(right.id, 'en'),
    ),
    paths: paths.sort((left, right) => left.id.localeCompare(right.id, 'en')),
    boundaries: unique(boundaries).sort((left, boundary) =>
      JSON.stringify(left).localeCompare(JSON.stringify(boundary), 'en'),
    ),
    diagnostics: diagnostics.sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right), 'en'),
    ),
    filteredPaths: unique(filteredPaths).sort((left, right) =>
      JSON.stringify(left).localeCompare(JSON.stringify(right), 'en'),
    ),
    truncated: diagnostics.some(
      (dependency) => dependency.status === 'truncated',
    ),
    searches,
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

  const effects = new Map(result.effects.map((effect) => [effect.id, effect]))

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

  if (!output) {
    throw new Error(
      'Usage: node analysis/export.ts inventory.json flow.json sourceRoot mode output.json [limits.json]',
    )
  }

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
