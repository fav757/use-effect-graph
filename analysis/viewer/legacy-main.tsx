import { createRoot } from 'react-dom/client'
import { Graph } from './Graph.tsx'
import './legacy.css'
const assets = window.REPORT_ASSETS
const totals = window.BASELINE_TOTALS
createRoot(document.getElementById('root')!).render(
  <>
    <header>
      <div>
        <div className="eyebrow">React · Dependency explorer</div>
        <h1>Effect and callback map</h1>
        <p>Trace effect dependencies and callback captures.</p>
      </div>
      <div className="stats">
        {Object.entries(totals).map(([label, count]) => (
          <div key={label}>
            <strong>{count}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
    </header>
    <main>
      <Graph svgMarkup={assets.svg} visible legacy />
      <footer>
        <span>
          Grouped by source file · Scroll to explore · Node labels show source
          lines
        </span>
        <span>
          Export{' '}
          <a href="use-effects.svg" download>
            SVG
          </a>{' '}
          ·{' '}
          <a href="use-effects.png" download>
            PNG
          </a>
        </span>
      </footer>
    </main>
  </>,
)

declare global {
  interface Window {
    BASELINE_TOTALS: Record<string, number>
  }
}
