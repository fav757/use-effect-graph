import type { Entity, Location, Result } from './export.ts'

export type Position = Pick<Location, 'file' | 'startLine' | 'startColumn'> &
  Partial<Pick<Location, 'endLine' | 'endColumn'>>
export type EntitySelector = Position & { kind?: string; expression?: string }
export type TransitionSelector = {
  from: EntitySelector
  to: EntitySelector
  type: string
  rule?: string
  evidence?: Position
  provenance?: string
  callContext?: { action: 'enter' | 'return'; site: Position; target: Position }
}
export type PathCase = {
  id: string
  description?: string
  effect: Position
  dependencyIndex: number
  source: EntitySelector
  stopReason?: string
  via?: EntitySelector[]
  transitions?: TransitionSelector[]
}
export type PathOracle = {
  schemaVersion: '1.0.0'
  required: (PathCase & { stopReason: string })[]
  forbidden: PathCase[]
  annotations?: {
    from: EntitySelector
    to: EntitySelector
    type: string
    composable: false
  }[]
}
export type PathAssessment = { passed: string[]; errors: string[] }

function positionMatches(actual: Location | undefined, expected: Position) {
  return (
    !!actual &&
    Object.entries(expected).every(
      ([key, value]) => actual[key as keyof Location] === value,
    )
  )
}

function entityMatches(actual: Entity | undefined, expected: EntitySelector) {
  const { kind, expression, ...position } = expected
  return (
    !!actual &&
    positionMatches(actual.location, position) &&
    (kind === undefined || kind === actual.kind) &&
    (expression === undefined || expression === actual.expression)
  )
}

function functionPosition(token: string): Location | undefined {
  const match = /^(.*):(\d+):(\d+):(\d+):(\d+)#function$/.exec(token)
  return match
    ? {
        file: match[1],
        startLine: +match[2],
        startColumn: +match[3],
        endLine: +match[4],
        endColumn: +match[5],
      }
    : undefined
}

/** Source-level constraints are authored independently of exported IDs or traversal order. */
export function assessPaths(
  result: Result,
  oracle: PathOracle,
): PathAssessment {
  const passed: string[] = [],
    errors: string[] = []

  if (oracle.schemaVersion !== '1.0.0') {
    return { passed, errors: ['Unsupported path oracle version'] }
  }

  if (result.schemaVersion !== '2.0.0') {
    return { passed, errors: ['Path checking requires result schema 2.0.0'] }
  }

  const entities = new Map(result.entities.map((entity) => [entity.id, entity]))
  const edges = new Map(result.edges.map((edge) => [edge.id, edge]))
  const dependencies = new Map(result.dependencies.map((dep) => [dep.id, dep]))
  const effects = new Map(result.effects.map((effect) => [effect.id, effect]))

  for (const path of result.paths) {
    const dep = dependencies.get(path.dependencyId)
    const fail = (reason: string) => errors.push(path.id + ': ' + reason)

    if (!dep || !effects.has(dep.effectId)) {
      fail('unknown dependency or Effect')
      continue
    }

    if (path.source !== path.nodes[0] || path.nodes.at(-1) !== dep.entityId) {
      fail('source/dependency endpoint mismatch')
    }

    if (path.edges.length + 1 !== path.nodes.length) {
      fail('disconnected node/edge sequence')
    }

    if (path.contexts?.length !== path.nodes.length) {
      fail('missing contextual node identities')
    }

    if (path.nodes.some((id) => !entities.has(id))) {
      fail('unknown intermediate entity')
    }

    for (const [index, id] of path.edges.entries()) {
      const edge = edges.get(id)

      if (!edge) {
        fail('unknown transition')
        continue
      }

      if (
        edge.from !== path.nodes[index] ||
        edge.to !== path.nodes[index + 1]
      ) {
        fail('intermediate connection mismatch')
      }

      if (
        !edge.composable ||
        ['closure-capture', 'hook-dependency', 'effect-dependency'].includes(
          edge.type,
        )
      ) {
        fail('annotation composed into a value path')
      }

      if (
        edge.callContext &&
        (!entities.has(edge.callContext.site) ||
          !functionPosition(edge.callContext.target))
      ) {
        fail('invalid call context evidence')
      }
    }
  }

  const rootMatches = (path: Result['paths'][number], spec: PathCase) => {
    const dep = dependencies.get(path.dependencyId)
    return (
      dep?.index === spec.dependencyIndex &&
      positionMatches(effects.get(dep.effectId)?.location, spec.effect) &&
      entityMatches(entities.get(path.source), spec.source)
    )
  }

  const pathMatches = (path: Result['paths'][number], spec: PathCase) => {
    if (spec.stopReason !== undefined && path.stopReason !== spec.stopReason) {
      return false
    }

    let previous = -1

    for (const checkpoint of spec.via ?? []) {
      const index = path.nodes.findIndex(
        (id, index) =>
          index > previous && entityMatches(entities.get(id), checkpoint),
      )
      if (index < 0) return false
      previous = index
    }

    previous = -1

    for (const transition of spec.transitions ?? []) {
      const index = path.edges.findIndex((id, index) => {
        if (index <= previous) return false
        const edge = edges.get(id)

        if (
          !edge ||
          edge.type !== transition.type ||
          !entityMatches(entities.get(edge.from), transition.from) ||
          !entityMatches(entities.get(edge.to), transition.to)
        ) {
          return false
        }

        if (transition.rule !== undefined && transition.rule !== edge.rule) {
          return false
        }

        if (
          transition.provenance !== undefined &&
          transition.provenance !== edge.provenance
        ) {
          return false
        }

        if (
          transition.evidence &&
          !positionMatches(edge.evidence, transition.evidence)
        ) {
          return false
        }

        const context = transition.callContext
        return (
          !context ||
          (!!edge.callContext &&
            context.action === edge.callContext.action &&
            positionMatches(
              entities.get(edge.callContext.site)?.location,
              context.site,
            ) &&
            positionMatches(
              functionPosition(edge.callContext.target),
              context.target,
            ))
        )
      })
      if (index < 0) return false
      previous = index
    }

    return true
  }

  for (const spec of oracle.required) {
    const candidates = result.paths.filter((path) => rootMatches(path, spec))

    if (!candidates.length) {
      errors.push(
        spec.id +
          ': no path for the specified Effect, dependency index and source position',
      )
      continue
    }

    const invalid = candidates.filter((path) => !pathMatches(path, spec))

    if (invalid.length) {
      errors.push(
        spec.id +
          ': intermediate entities, transitions, contexts or stop reason differ in ' +
          invalid.map((path) => path.id).join(', '),
      )
    } else {
      passed.push(spec.id)
    }
  }

  for (const spec of oracle.forbidden) {
    const invalid = result.paths.filter(
      (path) => rootMatches(path, spec) && pathMatches(path, spec),
    )

    if (invalid.length) {
      errors.push(
        spec.id +
          ': forbidden path ' +
          invalid.map((path) => path.id).join(', '),
      )
    } else {
      passed.push(spec.id)
    }
  }

  for (const [index, spec] of (oracle.annotations ?? []).entries()) {
    if (
      !result.edges.some(
        (edge) =>
          edge.type === spec.type &&
          edge.composable === spec.composable &&
          entityMatches(entities.get(edge.from), spec.from) &&
          entityMatches(entities.get(edge.to), spec.to),
      )
    ) {
      errors.push(
        'annotation:' + index + ': missing non-composable ' + spec.type,
      )
    } else {
      passed.push('annotation:' + index)
    }
  }

  return { passed, errors }
}
