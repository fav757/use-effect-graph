import { Icon } from './Icon.tsx'
import type { Entity, FlowPath, SourceRole } from './types.ts'
import { at, color, compact, names } from './utils.ts'

export function Sources({
  paths,
  entities,
  role,
  sourceId,
  onRole,
  onSource,
}: {
  paths: FlowPath[]
  entities: Map<string, Entity>
  role: SourceRole
  sourceId: string | null
  onRole: (role: SourceRole) => void
  onSource: (id: string | null) => void
}) {
  const origins = new Set(
    paths
      .filter((path) => path.sourceRole === 'origin')
      .map((path) => path.source),
  )
  const interfaces = new Set(
    paths
      .filter((path) => path.sourceRole !== 'origin')
      .map((path) => path.source),
  )
  const matching = paths.filter(
    (path) => (role === 'origin') === (path.sourceRole === 'origin'),
  )
  const sources = new Map<string, { entity: Entity; paths: FlowPath[] }>()

  for (const path of matching) {
    const entity = entities.get(path.source)
    if (!entity) continue
    const entry = sources.get(path.source) ?? { entity, paths: [] }
    entry.paths.push(path)
    sources.set(path.source, entry)
  }

  const priority = (entity: Entity) =>
    entity.kind === 'react-state' ? 0 : entity.kind === 'literal' ? 1 : 2
  const list = [...sources.values()].sort(
    (first, second) =>
      priority(first.entity) - priority(second.entity) ||
      at(first.entity).localeCompare(at(second.entity)),
  )
  return (
    <section className="origins" aria-label="Dependency sources">
      <div className="section-heading">
        <h3>Value sources</h3>
        <span className="count">{list.length} sources</span>
      </div>
      <p className="section-copy">Where this dependency can come from.</p>
      <div className="source-tabs" role="group" aria-label="Source category">
        {(['origin', 'observation'] as const).map((value) => (
          <button
            key={value}
            className={`source-tab ${role === value ? 'active' : ''}`}
            aria-pressed={role === value}
            onClick={() => onRole(value)}
          >
            {value === 'origin'
              ? `Origins · ${origins.size}`
              : `Interfaces · ${interfaces.size}`}
          </button>
        ))}
      </div>
      <button
        className={`source-all ${!sourceId ? 'active' : ''}`}
        onClick={() => onSource(null)}
      >
        {sourceId
          ? 'Clear source filter'
          : `All ${role === 'origin' ? 'origins' : 'interfaces'}`}
        <Icon name="arrow" />
      </button>
      <div className="source-list">
        {list.map(({ entity, paths: sourcePaths }) => (
          <button
            key={entity.id}
            className={`source-card ${sourceId === entity.id ? 'active' : ''}`}
            aria-pressed={sourceId === entity.id}
            title={entity.expression}
            onClick={() => onSource(sourceId === entity.id ? null : entity.id)}
          >
            <span className="source-top">
              <i className={`kind-dot ${color(entity)}`} />
              <span className="source-kind">
                {names[entity.kind] ?? entity.kind}
              </span>
              <span className="source-count">
                {sourcePaths.length}{' '}
                {sourcePaths.length === 1 ? 'path' : 'paths'}
              </span>
            </span>
            <span className="source-expression">
              {compact(entity.expression, 50)}
            </span>
            <span className="source-location">
              <Icon name="file" />
              {at(entity)}
            </span>
          </button>
        ))}
        {!list.length && (
          <div className="no-results">No sources in this category.</div>
        )}
      </div>
    </section>
  )
}
