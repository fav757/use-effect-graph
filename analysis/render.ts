import { readFileSync, writeFileSync } from 'node:fs'
import { toDot } from './export.ts'
import type { Result } from './export.ts'
const path = process.argv[2]
if (!path?.endsWith('.json'))
  throw new Error('Usage: node analysis/render.ts result.json')
const result = JSON.parse(
  readFileSync(path, 'utf8').replace(/^\uFEFF/, ''),
) as Result
writeFileSync(path.replace(/\.json$/, '.dot'), toDot(result))
