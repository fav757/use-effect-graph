import { Icon } from './Icon.tsx'
import type { Result } from './types.ts'
import { modeName } from './utils.ts'

export function ReportHeader({ data, stem }: { data: Result; stem: string }) {
  return (
    <header className="report-header">
      <div className="brand">
        <span className="brand-mark">
          <Icon name="branch" />
        </span>
        <strong>Effect Graph</strong>
        <span className="report-mode">{modeName(data.mode)}</span>
      </div>

      <details
        className="exports"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && event.currentTarget.open) {
            event.currentTarget.open = false
            event.currentTarget.querySelector('summary')?.focus()
          }
        }}
      >
        <summary>
          <Icon name="download" />
          Export
        </summary>

        <div className="export-menu">
          {[
            ['json', 'Analysis data (JSON)'],
            ['svg', 'Whole graph (SVG)'],
            ['png', 'Whole graph (PNG)'],
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
    </header>
  )
}
