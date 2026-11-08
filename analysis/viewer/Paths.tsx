import { useState } from 'react'
import { Icon } from './Icon.tsx'
import type { Dependency, Edge, Entity, FlowPath, SourceRole } from './types.ts'
import { at, compact, names, rules } from './utils.ts'

function Transition({
  edge,
  context,
  entities,
}: {
  edge: Edge
  context?: string
  entities: Map<string, Entity>
}) {
  return (
    <details className="step-proof">
      <summary>Transition evidence</summary>
      <div>
        {edge.rule} · {edge.status}
        <br />
        {edge.evidence.file}:{edge.evidence.startLine}:
        {edge.evidence.startColumn}
        {context && (
          <>
            <br />
            Flow context: {context}
          </>
        )}
        {edge.summary && (
          <>
            <br />
            Call summary: {edge.summary.type} · {edge.summary.provenance}
          </>
        )}
        {edge.callContext && (
          <>
            <br />
            Matched call {at(entities.get(edge.callContext.site))}
          </>
        )}
      </div>
    </details>
  )
}

function PathCard({
  path,
  dependency,
  entities,
  edges,
  initiallyOpen,
}: {
  path: FlowPath
  dependency: Dependency
  entities: Map<string, Entity>
  edges: Map<string, Edge>
  initiallyOpen: boolean
}) {
  const [open, setOpen] = useState(initiallyOpen)
  const source = entities.get(path.source)
  return (
    <details
      className="trace-card"
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
    >
      <summary>
        <span className="trace-icon">
          <Icon name={source?.kind === 'react-state' ? 'layers' : 'route'} />
        </span>
        <span className="trace-name">
          <code>{compact(source?.expression, 75)}</code>
          <small>
            {at(source)} <span style={{ padding: '0 4px' }}>→</span>{' '}
            {compact(dependency.expression, 32)}
          </small>
        </span>
        <span className="step-count">{path.edges.length} steps</span>
        <Icon name="chevron" className="chevron" />
      </summary>
      <div className="trace-steps">
        {path.nodes.map((id, index) => {
          const entity = entities.get(id)
          const edge = edges.get(path.edges[index - 1])
          if (!entity) return null

          const label =
            index === 0
              ? (names[entity.kind] ?? 'Source value')
              : (rules[edge?.type ?? ''] ??
                edge?.type.replaceAll('-', ' ') ??
                'Value flow')

          return (
            <div className="step" key={`${index}:${id}`}>
              <span className="step-number">{index + 1}</span>
              <div className="step-heading">
                <span>{label}</span>
                <span className="step-file" title={entity.location.file}>
                  {at(entity)}
                </span>
              </div>
              <code>{entity.expression || entity.label}</code>
              {edge && (
                <Transition
                  edge={edge}
                  context={path.contexts?.[index]}
                  entities={entities}
                />
              )}
            </div>
          )
        })}
      </div>
    </details>
  )
}

export function Paths({
  paths,
  dependency,
  entities,
  edges,
  role,
  sourceId,
}: {
  paths: FlowPath[]
  dependency: Dependency
  entities: Map<string, Entity>
  edges: Map<string, Edge>
  role: SourceRole
  sourceId: string | null
}) {
  const [limit, setLimit] = useState(6)

  const matching = paths
    .filter(
      (path) =>
        (role === 'origin') === (path.sourceRole === 'origin') &&
        (!sourceId || path.source === sourceId),
    )
    .sort(
      (first, second) =>
        (entities.get(first.source)?.kind === 'react-state' ? 0 : 1) -
          (entities.get(second.source)?.kind === 'react-state' ? 0 : 1) ||
        first.edges.length - second.edges.length ||
        first.id.localeCompare(second.id),
    )

  return (
    <section className="paths" aria-label="Provenance traces">
      <div className="paths-heading">
        <div>
          <h3>Provenance paths</h3>
          <span className="counter">{matching.length}</span>
        </div>
        <span style={{ color: '#bbc2d0', fontSize: 9 }}>
          POSSIBLE VALUE FLOW
        </span>
      </div>
      <p className="paths-caption">
        {sourceId
          ? `Showing paths from ${compact(entities.get(sourceId)?.expression, 50)} to ${compact(dependency.expression, 40)}.`
          : `Expand a path to inspect how a source reaches ${compact(dependency.expression, 45)}.`}
      </p>
      <div className="trace-list">
        {matching.slice(0, limit).map((path, index) => (
          <PathCard
            key={path.id}
            path={path}
            dependency={dependency}
            entities={entities}
            edges={edges}
            initiallyOpen={!!sourceId && index === 0}
          />
        ))}
        {!matching.length && (
          <div className="no-results">
            No modeled paths for this selection. Boundary notes explain where
            analysis stopped.
          </div>
        )}
      </div>
      {matching.length > limit && (
        <button className="load-more" onClick={() => setLimit(Infinity)}>
          Show {matching.length - limit} more paths
        </button>
      )}
    </section>
  )
}
