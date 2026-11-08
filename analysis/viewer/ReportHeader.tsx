import { useEffect, useState } from 'react'
import { Icon } from './Icon.tsx'
import type { Result } from './types.ts'

export function ReportHeader({ data, stem }: { data: Result; stem: string }) {
  const [exportsOpen, setExportsOpen] = useState(false)
  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExportsOpen(false)
    }

    document.addEventListener('keydown', close)
    return () => document.removeEventListener('keydown', close)
  }, [])

  const metrics: [string, number, string][] = [
    ['layers', data.effects.length, 'React Effects'],
    ['branch', data.dependencies.length, 'Dependencies'],
    ['route', data.paths.length, 'Provenance paths'],
    [
      'file',
      new Set(data.entities.map((entity) => entity.location.file)).size,
      'Source files',
    ],
  ]

  return (
    <>
      <div className="topline">
        <div className="breadcrumb">
          <span>WORKSPACE</span>
          <span>/</span>
          <span className="current">EFFECT EXPLORER</span>
        </div>
        <div className="top-status">
          <span className="status-dot" />
          <span>
            {data.truncated ? 'Partial analysis' : 'Analysis complete'}
          </span>
        </div>
      </div>
      <div className="heading">
        <div>
          <h1>Effect provenance</h1>
          <p className="subtitle">Follow the values behind every dependency.</p>
        </div>
        <details
          className="exports"
          open={exportsOpen}
          onToggle={(event) => setExportsOpen(event.currentTarget.open)}
        >
          <summary>
            <Icon name="download" />
            Export report <span style={{ color: '#abb3c2' }}>⌄</span>
          </summary>
          <div className="export-menu">
            {[
              ['json', 'Structured data · JSON'],
              ['svg', 'Full graph · SVG'],
              ['png', 'Full graph · PNG'],
            ].map(([extension, label]) => (
              <a
                key={extension}
                href={`./${encodeURIComponent(stem)}.${extension}`}
                download
              >
                {label}
              </a>
            ))}
          </div>
        </details>
      </div>
      <section className="metrics" aria-label="Analysis totals">
        {metrics.map(([icon, count, label]) => (
          <div className="metric" key={label}>
            <div className="metric-icon">
              <Icon name={icon} />
            </div>
            <div>
              <strong>{count}</strong>
              <span>{label}</span>
            </div>
          </div>
        ))}
      </section>
      {data.truncated && (
        <div className="partial-note">
          Some paths reached the configured analysis limits. The displayed
          origins may be incomplete.
        </div>
      )}
    </>
  )
}
