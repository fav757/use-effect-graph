import { createRoot } from 'react-dom/client'
import { App } from './App.tsx'
import './viewer.css'
const data = window.ANALYSIS_DATA
if (!data || !['1.0.0', '2.0.0'].includes(data.schemaVersion)) {
  throw new Error('Missing or unsupported report data')
}
createRoot(document.getElementById('root')!).render(
  <App data={data} assets={window.REPORT_ASSETS} />,
)
