import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { toDot } from './export.ts'
import { command, isMain, main, options } from './cli.ts'
import type { Command } from './cli.ts'
import { packageReport, readResult } from './report.ts'

export function renderReport(
  jsonPath: string,
  execute: Command = command,
  htmlOnly = false,
  dotOnly = false,
) {
  if (!jsonPath.endsWith('.json')) {
    throw new Error('Expected a .json result path')
  }

  if (!htmlOnly) {
    writeFileSync(
      jsonPath.replace(/\.json$/, '.dot'),
      toDot(readResult(jsonPath)),
    )

    if (dotOnly) return

    for (const format of ['svg', 'png']) {
      execute('dot', [
        `-T${format}`,
        jsonPath.replace(/\.json$/, '.dot'),
        '-o',
        jsonPath.replace(/\.json$/, `.${format}`),
      ])
    }
  }

  packageReport(jsonPath)
  console.log(`Graph viewer: ${jsonPath.replace(/\.json$/, '.html')}`)
}

if (isMain(import.meta.url)) {
  main(() => {
    const arguments_ = process.argv.slice(2)

    const positional =
      arguments_[0] && !arguments_[0].startsWith('-')
        ? arguments_.shift()
        : undefined

    const parsed = options(arguments_, ['JsonPath'], ['html', 'dot-only'])
    const path = positional ?? parsed.JsonPath

    if (typeof path !== 'string') {
      throw new Error(
        'Usage: node analysis/render.ts result.json (or -JsonPath result.json) [--html | --dot-only]',
      )
    }

    renderReport(
      resolve(path),
      command,
      parsed.html === true,
      parsed['dot-only'] === true,
    )
  })
}
