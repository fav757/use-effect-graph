import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { PointerEvent } from 'react'
import type { Dependency, Effect, Result } from './types.ts'
import { basename, pathsFor } from './utils.ts'

/** Graphviz owns SVG geometry; React owns controls and selection. Only SVG presentation is adapted here. */
export function Graph({
  svgMarkup,
  data,
  effect,
  dependency,
  sourceId,
  onEffect,
  fitRequest,
  visible,
  legacy = false,
}: {
  svgMarkup: string
  data?: Result
  effect?: Effect
  dependency?: Dependency
  sourceId?: string | null
  onEffect?: (effect: Effect) => void
  fitRequest?: number
  visible: boolean
  legacy?: boolean
}) {
  const canvas = useRef<HTMLDivElement>(null)
  const drag = useRef<{
    x: number
    y: number
    left: number
    top: number
  } | null>(null)
  const zoomAnchor = useRef<{
    graphX: number
    graphY: number
    clientX: number
    clientY: number
  } | null>(null)
  const [manualScale, setManualScale] = useState<number | null>(null)
  const [fitScale, setFitScale] = useState(1)
  const scale = manualScale ?? fitScale

  // A stable object keeps React from replacing the Graphviz DOM when controls change.
  const markup = useMemo(() => ({ __html: svgMarkup }), [svgMarkup])

  const dimensions = /viewBox=["'][^"']*?[\s,]([\d.]+)[\s,]([\d.]+)["']/.exec(
    svgMarkup,
  )
  const width = Number(dimensions?.[1]) || 1
  const height = Number(dimensions?.[2]) || 1
  const effects = useMemo(
    () => new Map(data?.effects.map((item) => [item.id, item])),
    [data],
  )

  const minScale = legacy ? 0.25 : Math.min(0.04, fitScale)
  const maxScale = legacy ? 2.5 : 3
  const interactive = Boolean(onEffect)

  function zoom(value: number, pointer?: { clientX: number; clientY: number }) {
    const next = Math.max(minScale, Math.min(maxScale, value))
    if (next === scale) return

    const viewport = canvas.current
    const svg = viewport?.querySelector('svg')

    if (!legacy && viewport && svg) {
      const bounds = viewport.getBoundingClientRect()
      const graph = svg.getBoundingClientRect()
      const clientX = pointer?.clientX ?? bounds.left + viewport.clientWidth / 2
      const clientY = pointer?.clientY ?? bounds.top + viewport.clientHeight / 2

      zoomAnchor.current = {
        graphX: (clientX - graph.left) / scale,
        graphY: (clientY - graph.top) / scale,
        clientX,
        clientY,
      }
    }

    setManualScale(next)
  }

  function fitGraph() {
    if (legacy) {
      zoom(((canvas.current?.clientWidth ?? 25) - 24) / width)
      return
    }

    zoomAnchor.current = null
    setManualScale(null)
    canvas.current?.scrollTo(0, 0)
  }

  const handleWheelZoom = useEffectEvent((event: WheelEvent) => {
    if (!event.ctrlKey || !event.deltaY) return

    event.preventDefault()
    zoom(event.deltaY < 0 ? scale * 1.3 : scale / 1.3, event)
  })

  function effectAt(target: EventTarget) {
    const node = target instanceof Element ? target.closest('.node') : null
    return effects.get(node?.querySelector('title')?.textContent ?? '')
  }

  function startPan(event: PointerEvent<HTMLDivElement>) {
    const viewport = event.currentTarget
    if (
      event.pointerType !== 'mouse' ||
      event.button !== 0 ||
      effectAt(event.target) ||
      (viewport.scrollWidth <= viewport.clientWidth &&
        viewport.scrollHeight <= viewport.clientHeight)
    ) {
      return
    }

    drag.current = {
      x: event.clientX,
      y: event.clientY,
      left: viewport.scrollLeft,
      top: viewport.scrollTop,
    }

    viewport.setPointerCapture(event.pointerId)
  }

  function pan(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return

    event.currentTarget.scrollTo(
      drag.current.left - (event.clientX - drag.current.x),
      drag.current.top - (event.clientY - drag.current.y),
    )
  }

  const controls = (
    <>
      <button
        aria-label="Zoom out"
        disabled={scale <= minScale}
        onClick={() => zoom(legacy ? scale - 0.15 : scale / 1.3)}
      >
        −
      </button>

      <output id="zoom" aria-live="polite">
        {scale < 0.1 ? (scale * 100).toFixed(1) : Math.round(scale * 100)}%
      </output>

      <button
        aria-label="Zoom in"
        disabled={scale >= maxScale}
        onClick={() => zoom(legacy ? scale + 0.15 : scale * 1.3)}
      >
        +
      </button>

      <button onClick={fitGraph}>{legacy ? 'Fit width' : 'Fit all'}</button>

      {!legacy && <button onClick={() => zoom(1)}>100%</button>}
    </>
  )

  useLayoutEffect(() => {
    if (!fitRequest) return

    zoomAnchor.current = null
    setManualScale(null)
    canvas.current?.scrollTo(0, 0)
  }, [fitRequest])

  useLayoutEffect(() => {
    const viewport = canvas.current
    if (!visible || !viewport) return

    if (legacy) {
      setFitScale(
        Math.max(0.25, Math.min(1, (viewport.clientWidth - 24) / width)),
      )
      return
    }

    const fit = () => {
      if (!viewport.clientWidth || !viewport.clientHeight) return

      setFitScale(
        Math.min(
          1,
          Math.max(1, viewport.clientWidth - 2) / width,
          Math.max(1, viewport.clientHeight - 2) / height,
        ),
      )
    }

    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(viewport)
    return () => observer.disconnect()
  }, [visible, width, height, legacy])

  useLayoutEffect(() => {
    const viewport = canvas.current
    const svg = viewport?.querySelector('svg')
    if (!viewport || !svg) return

    svg.style.width = `${width * scale}px`
    svg.style.height = 'auto'

    const anchor = zoomAnchor.current

    if (anchor) {
      const graph = svg.getBoundingClientRect()
      viewport.scrollBy(
        graph.left + anchor.graphX * scale - anchor.clientX,
        graph.top + anchor.graphY * scale - anchor.clientY,
      )

      zoomAnchor.current = null
    }
  }, [width, scale, svgMarkup])

  useEffect(() => {
    const viewport = canvas.current
    if (!visible || legacy || !viewport) return

    const onWheel = (event: WheelEvent) => handleWheelZoom(event)
    viewport.addEventListener('wheel', onWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', onWheel)
  }, [visible, legacy])

  useEffect(() => {
    if (!interactive) return

    for (const node of canvas.current?.querySelectorAll('.node') ?? []) {
      const item = effects.get(node.querySelector('title')?.textContent ?? '')
      if (!item) continue

      node.setAttribute('tabindex', '0')
      node.setAttribute('role', 'button')
      node.setAttribute(
        'aria-label',
        `Open useEffect in ${basename(item.location.file)} at line ${item.location.startLine}`,
      )
    }
  }, [effects, interactive, svgMarkup])

  useEffect(() => {
    if (!data) return

    if (!effect) {
      for (const element of canvas.current?.querySelectorAll('.dimmed') ?? []) {
        element.classList.remove('dimmed')
      }

      return
    }

    const paths = pathsFor(data, dependency).filter(
      (path) => !sourceId || path.source === sourceId,
    )

    const nodeIds = new Set(paths.flatMap((path) => path.nodes))
    const edgeIds = new Set(paths.flatMap((path) => path.edges))
    nodeIds.add(effect.id)
    if (dependency) nodeIds.add(dependency.entityId)

    for (const edge of data.edges) {
      if (
        edge.type === 'effect-dependency' &&
        edge.from === dependency?.entityId &&
        edge.to === effect.id
      ) {
        edgeIds.add(edge.id)
      }
    }

    for (const node of canvas.current?.querySelectorAll('.node') ?? []) {
      node.classList.toggle(
        'dimmed',
        !nodeIds.has(node.querySelector('title')?.textContent ?? ''),
      )
    }

    for (const edge of canvas.current?.querySelectorAll('.edge') ?? []) {
      edge.classList.toggle('dimmed', !edgeIds.has(edge.id))
    }
  }, [data, effect, dependency, sourceId, svgMarkup])

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
        <div className="graph-controls" role="group" aria-label="Graph zoom">
          {controls}
        </div>
      )}

      <div
        className={legacy ? 'canvas' : 'graph-canvas'}
        id="graph-canvas"
        ref={canvas}
        tabIndex={0}
        aria-label="Whole-program graph. Scroll to explore."
        onPointerDown={legacy ? undefined : startPan}
        onPointerMove={legacy ? undefined : pan}
        onLostPointerCapture={() => {
          drag.current = null
        }}
        onClick={
          onEffect &&
          ((event) => {
            const item = effectAt(event.target)
            if (item) onEffect(item)
          })
        }
        onKeyDown={
          onEffect &&
          ((event) => {
            if (event.key !== 'Enter' && event.key !== ' ') return

            const item = effectAt(event.target)
            if (!item) return

            event.preventDefault()
            onEffect(item)
          })
        }
        dangerouslySetInnerHTML={markup}
      />

      {!legacy && (
        <div className="graph-caption">
          <p>
            Ctrl + mouse wheel to zoom. Drag to pan. Select a useEffect node to
            open its traces.
          </p>

          <div className="graph-key" role="group" aria-label="Graph legend">
            <span data-kind="effect">useEffect</span>
            <span data-kind="state">React state</span>
            <span data-kind="external">External call</span>
          </div>
        </div>
      )}
    </>
  )
}
