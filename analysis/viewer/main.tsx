import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import { SourceDirectory } from './sourceDirectory.ts'
import './viewer.css'
const data = window.ANALYSIS_DATA

if (!data || !['1.0.0', '2.0.0'].includes(data.schemaVersion)) {
  throw new Error('Missing or unsupported report data')
}

createRoot(document.getElementById('root')!).render(
  <SourceDirectory value={window.REPORT_ASSETS.sourceDirectory}>
    <App data={data} assets={window.REPORT_ASSETS} />
  </SourceDirectory>,
)
