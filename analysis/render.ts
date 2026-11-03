import { readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { toDot } from './export.ts'
import type { Result } from './export.ts'
const path = process.argv[2]
if (!path?.endsWith('.json'))
  throw new Error('Usage: node analysis/render.ts result.json')
const result = JSON.parse(
  readFileSync(path, 'utf8').replace(/^\uFEFF/, ''),
) as Result
if (!['1.0.0', '2.0.0'].includes(result.schemaVersion))
  throw new Error('Unsupported result schema: ' + result.schemaVersion)
if (process.argv.includes('--html')) {
  const template = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), 'viewer-template.html'),
    'utf8',
  )
  const svg = readFileSync(path.replace(/\.json$/, '.svg'), 'utf8')
  const payload = JSON.stringify(result)
    .replaceAll('<', '\\u003c')
    .replaceAll('\u2028', '\\u2028')
    .replaceAll('\u2029', '\\u2029')
  const html = template
    .replace('{{DATA}}', () => payload)
    .replace('{{GRAPH}}', () => svg.slice(svg.indexOf('<svg')))
    .replaceAll('{{BASENAME}}', encodeURIComponent(basename(path, '.json')))
  writeFileSync(path.replace(/\.json$/, '.html'), html)
} else {
  writeFileSync(path.replace(/\.json$/, '.dot'), toDot(result))
}
