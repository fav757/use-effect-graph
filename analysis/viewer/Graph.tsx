import { useEffect, useMemo, useRef, useState } from 'react'
import type { Dependency, Effect, Result } from './types.ts'
import { pathsFor } from './utils.ts'

/** Graphviz owns SVG geometry; React owns controls and selection. Only SVG presentation is adapted here. */
export function Graph({
  svgMarkup,
  data,
  effect,
  dependency,
  sourceId,
  visible,
  legacy = false,
}: {
  svgMarkup: string
  data?: Result
  effect?: Effect
  dependency?: Dependency
  sourceId?: string | null
  visible: boolean
  legacy?: boolean
}) {
  const canvas = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  const [highlight, setHighlight] = useState(true)
  // A stable object keeps React from replacing the Graphviz DOM when controls change.
  const markup = useMemo(() => ({ __html: svgMarkup }), [svgMarkup])
  const width =
    Number(
      /viewBox=["'][^"']*?[\s,]([\d.]+)[\s,][\d.]+["']/.exec(svgMarkup)?.[1],
    ) || 1
  const zoom = (value: number) =>
    setScale(Math.max(legacy ? 0.25 : 0.04, Math.min(legacy ? 2.5 : 3, value)))
  useEffect(() => {
    if (visible) {
      setScale(
        Math.max(
          legacy ? 0.25 : 0.04,
          Math.min(
            1,
            ((canvas.current?.clientWidth ?? 31) - (legacy ? 24 : 30)) / width,
          ),
        ),
      )
    }
  }, [visible, width, legacy])
  useEffect(() => {
    const svg = canvas.current?.querySelector('svg')
    if (svg) {
      svg.style.width = `${width * scale}px`
      svg.style.height = 'auto'
    }
  }, [width, scale, svgMarkup])
  useEffect(() => {
    if (!data) return
    const paths = pathsFor(data, dependency).filter(
      (path) => !sourceId || path.source === sourceId,
    )
    const nodeIds = new Set(paths.flatMap((path) => path.nodes))
    const edgeIds = new Set(paths.flatMap((path) => path.edges))
    if (effect) nodeIds.add(effect.id)
    if (dependency) nodeIds.add(dependency.entityId)
    for (const edge of data.edges) {
      if (
        edge.type === 'effect-dependency' &&
        edge.from === dependency?.entityId &&
        edge.to === effect?.id
      ) {
        edgeIds.add(edge.id)
      }
    }
    for (const node of canvas.current?.querySelectorAll('.node') ?? []) {
      node.classList.toggle(
        'dimmed',
        highlight &&
          !nodeIds.has(node.querySelector('title')?.textContent ?? ''),
      )
    }
    for (const edge of canvas.current?.querySelectorAll('.edge') ?? []) {
      edge.classList.toggle('dimmed', highlight && !edgeIds.has(edge.id))
    }
  }, [data, effect, dependency, sourceId, highlight, svgMarkup])
  const controls = (
    <>
      <button
        aria-label="Zoom out"
        disabled={legacy && scale <= 0.25}
        onClick={() => zoom(legacy ? scale - 0.15 : scale / 1.3)}
      >
        −
      </button>
      <output id="zoom" aria-live="polite">
        {Math.round(scale * 100)}%
      </output>
      <button
        aria-label="Zoom in"
        disabled={legacy && scale >= 2.5}
        onClick={() => zoom(legacy ? scale + 0.15 : scale * 1.3)}
      >
        +
      </button>
      <button
        onClick={() =>
          zoom(
            ((canvas.current?.clientWidth ?? 31) - (legacy ? 24 : 30)) / width,
          )
        }
      >
        {legacy ? 'Fit width' : 'Fit all'}
      </button>
      {!legacy && <button onClick={() => zoom(1)}>100%</button>}
    </>
  )
  return (
    <>
      {legacy ? (
        <div className="toolbar">
          <div className="legend" aria-label="Graph legend">
            <span>
              <i className="swatch" />
              Effect
            </span>
            <span>
              <i className="swatch event" />
              Effect Event
            </span>
            <span>
              <i className="swatch stable" />
              Stable callback
            </span>
            <span>
              <i className="swatch dependency" />
              Value
            </span>
            <span>
              <i className="edge-key" /> dependency/source
            </span>
            <span>
              <i className="edge-key dotted" /> invokes
            </span>
            <span>
              <i className="edge-key dashed" /> captures
            </span>
          </div>
          <div className="controls" aria-label="Zoom controls">
            {controls}
          </div>
        </div>
      ) : (
        <div className="graph-toolbar">
          <label>
            <input
              type="checkbox"
              checked={highlight}
              onChange={(event) => setHighlight(event.target.checked)}
            />
            Highlight selected dependency
          </label>
          <div className="graph-controls" aria-label="Graph zoom">
            {controls}
          </div>
        </div>
      )}
      <div
        className={legacy ? 'canvas' : 'graph-canvas'}
        id="graph-canvas"
        ref={canvas}
        tabIndex={0}
        aria-label="Whole-program graph. Scroll to explore."
        dangerouslySetInnerHTML={markup}
      />
      {!legacy && (
        <p className="graph-caption">
          Whole-program overview. Use provenance paths to follow a specific call
          context. Dashed and dotted links are annotations.
        </p>
      )}
    </>
  )
}
