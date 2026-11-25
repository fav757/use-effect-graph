import { useMemo, useState } from 'react'
import { Icon } from './Icon.tsx'
import { EmptyEffect } from './EmptyEffect.tsx'
import { Sources } from './Sources.tsx'
import { Paths } from './Paths.tsx'
import { Notes } from './Notes.tsx'
import type { Dependency, Effect, Result, SourceRole } from './types.ts'
import { basename, compact, pathsFor } from './utils.ts'

export function EffectPanel({
  data,
  effect,
  dependencies,
  dependency,
  onDependency,
  onShowGraph,
}: {
  data: Result
  effect: Effect
  dependencies: Dependency[]
  dependency?: Dependency
  onDependency: (index: number) => void
  onShowGraph: (sourceId: string | null) => void
}) {
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

        <button
          className="show-graph"
          onClick={() =>
            onShowGraph(
              graphSource?.selection === selectionKey ? graphSource.id : null,
            )
          }
        >
          <Icon name="branch" />
          Highlight on graph
        </button>
      </header>

      <div className="dependency-bar">
        <span>Dependencies</span>

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

      <DependencyContent
        key={selectionKey}
        data={data}
        effect={effect}
        dependency={dependency}
        onSourceChange={(id) => setGraphSource({ selection: selectionKey, id })}
      />

      <Notes data={data} effect={effect} dependency={dependency} />
    </section>
  )
}

function DependencyContent({
  data,
  effect,
  dependency,
  onSourceChange,
}: {
  data: Result
  effect: Effect
  dependency?: Dependency
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

  const paths = useMemo(() => pathsFor(data, dependency), [data, dependency])

  const [role, setRole] = useState<SourceRole>(() =>
    paths.some((path) => path.sourceRole === 'origin')
      ? 'origin'
      : paths.length
        ? 'observation'
        : 'origin',
  )

  const [sourceId, setSourceId] = useState<string | null>(null)
  return dependency ? (
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
  )
}
