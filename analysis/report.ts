import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Result } from './export.ts'

const defaultAssets = fileURLToPath(new URL('./viewer/dist/', import.meta.url))

export function readResult(path: string): Result {
  const result = JSON.parse(
    readFileSync(path, 'utf8').replace(/^\uFEFF/, ''),
  ) as Result

  if (!['1.0.0', '2.0.0'].includes(result.schemaVersion)) {
    throw new Error('Unsupported result schema: ' + result.schemaVersion)
  }

  return result
}

export function serializeReport(result: unknown, svg: string, stem: string) {
  const serialize = (value: unknown) =>
    JSON.stringify(value)
      .replaceAll('<', '\\u003c')
      .replaceAll('\u2028', '\\u2028')
      .replaceAll('\u2029', '\\u2029')

  return `window.ANALYSIS_DATA = ${serialize(result)};\nwindow.REPORT_ASSETS = ${serialize({ svg: svg.slice(svg.indexOf('<svg')), stem })};\n`
}

export function reportHtml(stem: string) {
  const dataPath = encodeURIComponent(stem) + '.data.js'
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Effect explorer · Dependency provenance</title><link rel="stylesheet" href="./viewer.css"></head><body><div id="root"></div><script src="./${dataPath}"></script><script src="./viewer.js"></script></body></html>\n`
}

export function packageReport(
  jsonPath: string,
  assetsDirectory = defaultAssets,
) {
  for (const asset of ['viewer.js', 'viewer.css']) {
    if (!existsSync(join(assetsDirectory, asset))) {
      throw new Error(
        'Viewer assets are missing. Run npm run build:viewer first.',
      )
    }
  }

  const result = readResult(jsonPath)
  const directory = dirname(jsonPath)
  const stem = basename(jsonPath, '.json')
  const svg = readFileSync(join(directory, `${stem}.svg`), 'utf8')

  if (!svg.includes('<svg')) {
    throw new Error('Graphviz output does not contain an SVG root.')
  }

  for (const asset of ['viewer.js', 'viewer.css']) {
    copyFileSync(join(assetsDirectory, asset), join(directory, asset))
  }

  writeFileSync(
    join(directory, `${stem}.data.js`),
    serializeReport(result, svg, stem),
  )
  writeFileSync(join(directory, `${stem}.html`), reportHtml(stem))
}
