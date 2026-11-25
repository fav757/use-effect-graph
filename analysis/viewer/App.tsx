import { useMemo, useRef, useState } from 'react'
import { Navigation, visibleEffects } from './Navigation.tsx'
import { ReportHeader } from './ReportHeader.tsx'
import { EffectPanel } from './EffectPanel.tsx'
import { Graph } from './Graph.tsx'
import { Icon } from './Icon.tsx'
import { useSelection } from './useSelection.ts'
import type { Effect, ReportAssets, Result } from './types.ts'
import { basename } from './utils.ts'

export function App({ data, assets }: { data: Result; assets: ReportAssets }) {
  const [view, setView] = useState<'graph' | 'traces'>(() => {
    const hash = new URLSearchParams(location.hash.slice(1))
    return hash.has('effect') && hash.get('view') !== 'graph'
      ? 'traces'
      : 'graph'
  })

  const [search, setSearch] = useState('')
  const [focus, setFocus] = useState<{ sourceId: string | null } | null>(null)
  const [fitRequest, setFitRequest] = useState(0)
  const graphButton = useRef<HTMLButtonElement>(null)
  const tracesButton = useRef<HTMLButtonElement>(null)
  const selection = useSelection(data, view)
  const visible = useMemo(() => visibleEffects(data, search), [data, search])

  function showGraph() {
    setFocus(null)
    setView('graph')
    setFitRequest((request) => request + 1)
    graphButton.current?.focus()
  }

  function openEffect(effect: Effect) {
    setSearch('')
    selection.select(effect)
    setView('traces')
    tracesButton.current?.focus()
  }

  return (
    <div className="app">
      <ReportHeader data={data} stem={assets.stem} />

      <main className="workspace">
        <div className="report-heading">
          <div>
            <h1>
              {view === 'graph' ? 'Dependency graph' : 'Dependency traces'}
            </h1>

            {view === 'graph' && (
              <p className="report-counts">
                {data.entities.length} nodes <span>·</span> {data.edges.length}{' '}
                connections <span>·</span> {data.effects.length} effects
              </p>
            )}
          </div>

          <div className="view-switch" role="group" aria-label="Report view">
            <button
              ref={graphButton}
              aria-pressed={view === 'graph'}
              onClick={showGraph}
            >
              <Icon name="branch" />
              Full graph
            </button>

            <button
              ref={tracesButton}
              aria-pressed={view === 'traces'}
              onClick={() => setView('traces')}
            >
              <Icon name="route" />
              Effect traces
            </button>
          </div>
        </div>

        {data.truncated && (
          <p className="partial-note">
            Some paths reached the analysis limits. The displayed origins may be
            incomplete.
          </p>
        )}

        <section
          className="graph-panel"
          aria-label="Dependency graph"
          hidden={view !== 'graph'}
        >
          <div className="graph-summary">
            <p>
              {focus && selection.effect
                ? `${basename(selection.effect.location.file)}:${selection.effect.location.startLine}${selection.dependency ? ` · ${selection.dependency.expression}` : ''}`
                : 'All nodes and connections'}
            </p>

            {focus && <button onClick={showGraph}>Show all nodes</button>}
          </div>

          <Graph
            svgMarkup={assets.svg}
            data={data}
            effect={focus ? selection.effect : undefined}
            dependency={focus ? selection.dependency : undefined}
            sourceId={focus?.sourceId}
            onEffect={openEffect}
            fitRequest={fitRequest}
            visible={view === 'graph'}
          />
        </section>

        <div className="trace-workspace" hidden={view !== 'traces'}>
          <Navigation
            data={data}
            visible={visible}
            selected={selection.effect}
            search={search}
            onSearch={(value) => {
              setSearch(value)

              const next = visibleEffects(data, value)

              if (!selection.effect || !next.includes(selection.effect)) {
                selection.select(next[0])
              }
            }}
            onSelect={selection.select}
          />

          {selection.effect ? (
            <EffectPanel
              data={data}
              effect={selection.effect}
              dependencies={selection.dependencies}
              dependency={selection.dependency}
              onDependency={(index) =>
                selection.select(selection.effect, index)
              }
              onShowGraph={(sourceId) => {
                setFocus({ sourceId })
                setView('graph')
                graphButton.current?.focus()
              }}
            />
          ) : (
            <div className="empty-workspace">
              {data.effects.length
                ? 'No matching effects. Try another file or dependency.'
                : 'No effects were found in this report.'}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
