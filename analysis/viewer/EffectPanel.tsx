import { useMemo, useState } from 'react'
import { Icon } from './Icon.tsx'
import { EmptyEffect } from './EmptyEffect.tsx'
import { Graph } from './Graph.tsx'
import { Sources } from './Sources.tsx'
import { Paths } from './Paths.tsx'
import { Notes } from './Notes.tsx'
import type { Dependency, Effect, Result, SourceRole } from './types.ts'
import { basename, compact, pathsFor } from './utils.ts'

export function EffectPanel({
  data,
  svg,
  effect,
  dependencies,
  dependency,
  onDependency,
}: {
  data: Result
  svg: string
  effect: Effect
  dependencies: Dependency[]
  dependency?: Dependency
  onDependency: (index: number) => void
}) {
  const [view, setView] = useState<'trace' | 'graph'>('trace')
  const selectionKey = `${effect.id}:${dependency?.id ?? ''}`

  const [graphSource, setGraphSource] = useState<{
    selection: string
    id: string | null
  } | null>(null)

  return (
    <section className="effect-panel" aria-label="Selected Effect">
      <header className="effect-header">
        <div>
          <div className="effect-kicker">
            <Icon name="file" />

            {effect.location.file.includes('/')
              ? effect.location.file.slice(
                  0,
                  effect.location.file.lastIndexOf('/'),
                )
              : 'Project root'}
          </div>

          <div className="effect-title">
            <h2>{basename(effect.location.file)}</h2>
            <span className="line-badge">line {effect.location.startLine}</span>
          </div>

          <p className="effect-path">{effect.location.file}</p>
        </div>

        <span className="hook-tag">useEffect</span>
      </header>

      <div className="dependency-bar">
        <span>DEPENDENCIES</span>

        <div className="dependency-buttons">
          {dependencies.map((item) => (
            <button
              className={`dependency ${item === dependency ? 'selected' : ''}`}
              key={item.id}
              aria-pressed={item === dependency}
              onClick={() => onDependency(item.index)}
            >
              <small>{item.index}</small>
              {compact(item.expression, 65)}
            </button>
          ))}

          {!dependencies.length && (
            <span style={{ color: '#a9a0b8', font: '11px var(--mono)' }}>
              {effect.mode === 'empty'
                ? '[]'
                : effect.mode === 'absent'
                  ? 'Not supplied'
                  : 'Unsupported expression'}
            </span>
          )}
        </div>
      </div>

      <div className="view-tabs" role="tablist" aria-label="Report view">
        {(['trace', 'graph'] as const).map((name) => (
          <button
            key={name}
            className={`view-tab ${view === name ? 'active' : ''}`}
            id={`${name}-tab`}
            role="tab"
            aria-selected={view === name}
            aria-controls={`${name}-view`}
            onClick={() => setView(name)}
          >
            <Icon name={name === 'trace' ? 'route' : 'grid'} />
            {name === 'trace' ? 'Dependency traces' : 'Graph overview'}
          </button>
        ))}

        <span className="view-hint">Source → dependency → Effect</span>
      </div>

      <DependencyContent
        key={selectionKey}
        data={data}
        effect={effect}
        dependency={dependency}
        view={view}
        onSourceChange={(id) => setGraphSource({ selection: selectionKey, id })}
      />

      <div
        id="graph-view"
        role="tabpanel"
        aria-labelledby="graph-tab"
        hidden={view !== 'graph'}
      >
        <Graph
          svgMarkup={svg}
          data={data}
          effect={effect}
          dependency={dependency}
          sourceId={
            graphSource?.selection === selectionKey ? graphSource.id : null
          }
          visible={view === 'graph'}
        />
      </div>

      <Notes data={data} effect={effect} dependency={dependency} />
    </section>
  )
}

function DependencyContent({
  data,
  effect,
  dependency,
  view,
  onSourceChange,
}: {
  data: Result
  effect: Effect
  dependency?: Dependency
  view: 'trace' | 'graph'
  onSourceChange: (id: string | null) => void
}) {
  const entities = useMemo(
    () => new Map(data.entities.map((entity) => [entity.id, entity])),
    [data],
  )

  const edges = useMemo(
    () => new Map(data.edges.map((edge) => [edge.id, edge])),
    [data],
  )

  const paths = pathsFor(data, dependency)

  const [role, setRole] = useState<SourceRole>(() =>
    paths.some((path) => path.sourceRole === 'origin')
      ? 'origin'
      : paths.length
        ? 'observation'
        : 'origin',
  )

  const [sourceId, setSourceId] = useState<string | null>(null)
  return (
    <>
      <div
        id="trace-view"
        role="tabpanel"
        aria-labelledby="trace-tab"
        hidden={view !== 'trace'}
      >
        {dependency ? (
          <div className="trace-layout">
            <Sources
              paths={paths}
              entities={entities}
              role={role}
              sourceId={sourceId}
              onRole={(next) => {
                setRole(
                  next === 'origin' &&
                    paths.length > 0 &&
                    !paths.some((path) => path.sourceRole === 'origin')
                    ? 'observation'
                    : next,
                )

                setSourceId(null)
                onSourceChange(null)
              }}
              onSource={(id) => {
                setSourceId(id)
                onSourceChange(id)
              }}
            />

            <Paths
              key={`${role}:${sourceId ?? ''}`}
              paths={paths}
              dependency={dependency}
              entities={entities}
              edges={edges}
              role={role}
              sourceId={sourceId}
            />
          </div>
        ) : (
          <EmptyEffect effect={effect} entity={entities.get(effect.id)} />
        )}
      </div>
    </>
  )
}
