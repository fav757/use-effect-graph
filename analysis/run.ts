import { createHash, randomUUID } from 'node:crypto'
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs'
import {
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path'
import { fileURLToPath } from 'node:url'
import { command, isMain, main, options } from './cli.ts'
import type { Command } from './cli.ts'
import { renderReport } from './render.ts'

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const defaults = {
  MaxDepth: 96,
  MaxContexts: 64,
  MaxPaths: 128,
  MaxSteps: 50000,
  Threads: 2,
  Ram: 6000,
}

export function parseRunOptions(arguments_: string[]) {
  const parsed = options(
    arguments_,
    [
      'SourceDirectory',
      'OutputDirectory',
      'DatabaseDirectory',
      'Expectations',
      ...Object.keys(defaults),
    ],
    ['SkipRender'],
  )

  const numbers = { ...defaults }

  for (const key of Object.keys(defaults) as (keyof typeof defaults)[]) {
    const value =
      parsed[key] === undefined ? defaults[key] : Number(parsed[key])

    const minimum = key === 'Ram' ? 2048 : 1

    const maximum =
      key === 'Threads'
        ? 32
        : key === 'Ram'
          ? 65536
          : key === 'MaxSteps'
            ? 100000000
            : 1000000

    if (!Number.isInteger(value) || value < minimum || value > maximum) {
      throw new Error(`Invalid ${key}: ${parsed[key]}`)
    }

    numbers[key] = value
  }

  return {
    ...numbers,
    source: resolve(String(parsed.SourceDirectory ?? join(repository, 'src'))),
    output: resolve(
      String(
        parsed.OutputDirectory ?? join(repository, 'codeql-graph/provenance'),
      ),
    ),
    database: resolve(
      String(
        parsed.DatabaseDirectory ??
          join(
            repository,
            'codeql-db',
            `provenance-${randomUUID().replaceAll('-', '')}`,
          ),
      ),
    ),
    expectations: parsed.Expectations
      ? resolve(String(parsed.Expectations))
      : undefined,
    skipRender: parsed.SkipRender === true,
  }
}

export function sourceHashes(source: string): Record<string, string> {
  const files: string[] = []

  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name)

      if (entry.isDirectory() && entry.name.toLowerCase() !== 'node_modules') {
        visit(path)
      } else if (
        entry.isFile() &&
        ['.ts', '.tsx', '.js', '.jsx'].includes(extname(path).toLowerCase())
      ) {
        files.push(path)
      }
    }
  }

  visit(source)
  return Object.fromEntries(
    files
      .sort()
      .map((path) => [
        relative(source, path).split(sep).join('/'),
        createHash('sha256').update(readFileSync(path)).digest('hex'),
      ]),
  )
}

export function assertSourceUnchanged(
  before: Record<string, string>,
  after: Record<string, string>,
) {
  if (Object.keys(before).length !== Object.keys(after).length) {
    throw new Error('Source files were added or removed during analysis.')
  }

  for (const key of Object.keys(before)) {
    if (after[key] !== before[key]) {
      throw new Error(`Source changed during analysis: ${key}`)
    }
  }
}

function contained(source: string, output: string) {
  const path = relative(source, output)
  return (
    path === '' ||
    (path !== '..' && !path.startsWith('..' + sep) && !isAbsolute(path))
  )
}

export function runAnalysis(arguments_: string[], execute: Command = command) {
  if (Number(process.versions.node.split('.')[0]) < 24) {
    throw new Error(
      'Node.js 24 or newer is required for native TypeScript execution.',
    )
  }

  const config = parseRunOptions(arguments_)
  const source = realpathSync(config.source)
  // Resolve existing ancestors too, so junctions cannot put generated files in the source tree.
  let ancestor = config.output

  while (!existsSync(ancestor)) {
    const parent = dirname(ancestor)

    if (parent === ancestor) {
      throw new Error(`Output filesystem root does not exist: ${ancestor}`)
    }

    ancestor = parent
  }

  const output = resolve(
    realpathSync(ancestor),
    relative(ancestor, config.output),
  )

  if (existsSync(config.database)) {
    throw new Error(
      `Choose a new database directory; it already exists: ${config.database}`,
    )
  }

  if (contained(source, output)) {
    throw new Error(
      'OutputDirectory must be outside SourceDirectory to keep extraction reproducible.',
    )
  }

  mkdirSync(output, { recursive: true })
  const timings: { stage: string; seconds: number }[] = []

  const stage = (name: string, action: () => unknown) => {
    const start = performance.now()
    action()
    timings.push({
      stage: name,
      seconds: Math.round(performance.now() - start) / 1000,
    })
  }

  const version = JSON.parse(
    execute('codeql', ['version', '--format=json'], true),
  ) as { version: string }

  const queries = join(
    repository,
    'codeql-queries/codeql-custom-queries-javascript',
  )

  const libraryPath = execute(
    'codeql',
    ['resolve', 'library-path', `--query=${join(queries, 'extended.ql')}`],
    true,
  )

  if (!/javascript-all[\\/]2\.10\.0/.test(libraryPath)) {
    throw new Error(
      'Install the CodeQL bundle containing codeql/javascript-all 2.10.0.',
    )
  }

  const hashes = sourceHashes(source)
  const resources = [`--threads=${config.Threads}`, `--ram=${config.Ram}`]
  stage('database', () =>
    execute('codeql', [
      'database',
      'create',
      config.database,
      '--language=javascript-typescript',
      `--source-root=${source}`,
      '--build-mode=none',
      ...resources,
    ]),
  )

  for (const mode of [
    'inventory',
    'baseline',
    'baseline-units',
    'standard-value',
    'standard-taint',
    'extended',
    'extended-state',
  ]) {
    const bqrs = join(output, `${mode}.bqrs`)
    stage(`query:${mode}`, () =>
      execute('codeql', [
        'query',
        'run',
        join(queries, `${mode}.ql`),
        `--database=${config.database}`,
        `--output=${bqrs}`,
        ...resources,
      ]),
    )

    stage(`decode:${mode}`, () =>
      execute('codeql', [
        'bqrs',
        'decode',
        bqrs,
        '--format=json',
        '--entities=id',
        `--output=${join(output, `${mode}.raw.json`)}`,
      ]),
    )
  }

  const limits = {
    maxDepth: config.MaxDepth,
    maxContexts: config.MaxContexts,
    maxPaths: config.MaxPaths,
    maxSteps: config.MaxSteps,
  }

  const limitsPath = join(output, 'limits.json')
  writeFileSync(limitsPath, JSON.stringify(limits))

  for (const mode of [
    'standard-value',
    'standard-taint',
    'extended',
    'extended-state',
  ]) {
    stage(`export:${mode}`, () =>
      execute(process.execPath, [
        join(repository, 'analysis/export.ts'),
        join(output, 'inventory.raw.json'),
        join(output, `${mode}.raw.json`),
        source,
        mode,
        join(output, `${mode}.json`),
        limitsPath,
      ]),
    )
  }

  assertSourceUnchanged(hashes, sourceHashes(source))

  if (!config.skipRender) {
    stage('graphviz', () =>
      renderReport(join(output, 'extended-state.json'), execute),
    )
  }

  if (config.expectations) {
    stage('compare', () =>
      execute(process.execPath, [
        join(repository, 'analysis/check.ts'),
        output,
        realpathSync(config.expectations!),
        source,
      ]),
    )
  }

  writeFileSync(
    join(output, 'run.json'),
    JSON.stringify(
      {
        schemaVersion: '1.0.0',
        codeql: version.version,
        javascriptAll: '2.10.0',
        node: process.version,
        sourceHashes: hashes,
        limits,
        stages: timings,
        database: config.database,
        resultSchemaVersion: '2.0.0',
      },
      null,
      2,
    ),
  )

  console.log(`Analysis written to ${output}`)
}

if (isMain(import.meta.url)) main(() => runAnalysis(process.argv.slice(2)))
