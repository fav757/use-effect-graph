import assert from 'node:assert/strict'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { join } from 'node:path'
import { test } from 'node:test'
import { runInNewContext } from 'node:vm'
import { command, ProcessFailure } from './cli.ts'
import type { Command } from './cli.ts'
import {
  assertSourceUnchanged,
  parseRunOptions,
  runAnalysis,
  sourceHashes,
} from './run.ts'
import { packageReport, readResult, serializeReport } from './report.ts'
import { baselineDot, parseCsv } from '../codeql-graph/render-graph.ts'

function workspace(action: (directory: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'effect report '))
  try {
    action(directory)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
test('runner preserves defaults, legacy options, aliases and numeric bounds', () => {
  const defaults = parseRunOptions([])
  assert.deepEqual(
    [
      defaults.MaxDepth,
      defaults.MaxContexts,
      defaults.MaxPaths,
      defaults.MaxSteps,
      defaults.Threads,
      defaults.Ram,
    ],
    [96, 64, 128, 50000, 2, 6000],
  )
  const custom = parseRunOptions([
    '-MaxDepth',
    '7',
    '--max-contexts=8',
    '-SkipRender',
    '--threads',
    '4',
  ])
  assert.deepEqual(
    [custom.MaxDepth, custom.MaxContexts, custom.Threads, custom.skipRender],
    [7, 8, 4, true],
  )
  for (const args of [
    ['-Ram', '1024'],
    ['--threads', '33'],
    ['-MaxPaths', '0'],
    ['--max-depth', '1.2'],
    ['--unknown'],
    ['-SourceDirectory'],
  ]) {
    assert.throws(() => parseRunOptions(args))
  }
})
test('runner passes exact analysis stages and resource arguments without PowerShell', () =>
  workspace((directory) => {
    const source = join(directory, 'custom source'),
      output = join(directory, 'custom output'),
      database = join(directory, 'new database')
    mkdirSync(source)
    writeFileSync(join(source, 'file.ts'), 'const value = 1')
    const calls: { executable: string; args: string[] }[] = []
    const execute: Command = (executable, args) => {
      calls.push({ executable, args })
      if (args[0] === 'version') return '{"version":"reference"}'
      if (args[0] === 'resolve') return '/packs/codeql/javascript-all/2.10.0'
      return ''
    }
    runAnalysis(
      [
        '-SourceDirectory',
        source,
        '-OutputDirectory',
        output,
        '-DatabaseDirectory',
        database,
        '-SkipRender',
        '-MaxPaths',
        '9',
        '-Threads',
        '3',
        '-Ram',
        '4096',
      ],
      execute,
    )
    assert.equal(calls.filter((call) => call.args[0] === 'query').length, 7)
    assert.equal(calls.filter((call) => call.args[0] === 'bqrs').length, 7)
    assert.equal(
      calls.filter((call) => call.args[0].endsWith('export.ts')).length,
      4,
    )
    assert(
      calls.some(
        (call) =>
          call.args.includes('--build-mode=none') &&
          call.args.includes(`--source-root=${source}`),
      ),
    )
    for (const call of calls.filter((call) =>
      ['query', 'database'].includes(call.args[0]),
    )) {
      assert(
        call.args.includes('--threads=3') && call.args.includes('--ram=4096'),
      )
    }
    assert(calls.every((call) => !/powershell|pwsh/i.test(call.executable)))
    const manifest = JSON.parse(readFileSync(join(output, 'run.json'), 'utf8'))
    assert.equal(manifest.stages.length, 19)
    assert.equal(manifest.limits.maxPaths, 9)
    assert.deepEqual(manifest.sourceHashes, sourceHashes(source))
    assert.equal(manifest.resultSchemaVersion, '2.0.0')
  }))
test('runner rejects existing databases and output inside source before invoking tools', () =>
  workspace((directory) => {
    const source = join(directory, 'source'),
      database = join(directory, 'existing')
    mkdirSync(source)
    mkdirSync(database)
    const never: Command = () => {
      throw new Error('Unexpected command')
    }
    assert.throws(
      () =>
        runAnalysis(
          ['-SourceDirectory', source, '-OutputDirectory', join(source, 'out')],
          never,
        ),
      /outside SourceDirectory/,
    )
    assert.throws(
      () =>
        runAnalysis(
          ['-SourceDirectory', source, '-DatabaseDirectory', database],
          never,
        ),
      /already exists/,
    )
  }))
test('source snapshots exclude node_modules and detect edits, additions and removals', () =>
  workspace((directory) => {
    mkdirSync(join(directory, 'node_modules'))
    writeFileSync(join(directory, 'node_modules/ignored.ts'), 'ignored')
    writeFileSync(join(directory, 'input.tsx'), 'before')
    writeFileSync(join(directory, 'other.txt'), 'ignored')
    const before = sourceHashes(directory)
    assert.deepEqual(Object.keys(before), ['input.tsx'])
    writeFileSync(join(directory, 'input.tsx'), 'after')
    assert.throws(
      () => assertSourceUnchanged(before, sourceHashes(directory)),
      /Source changed/,
    )
    assert.throws(() => assertSourceUnchanged(before, {}), /added or removed/)
    assert.throws(
      () =>
        assertSourceUnchanged(before, { 'renamed.tsx': before['input.tsx'] }),
      /Source changed/,
    )
  }))
test('native command failures retain the child exit code', () => {
  assert.throws(
    () => command(process.execPath, ['-e', 'process.exit(7)'], true),
    (error) => error instanceof ProcessFailure && error.exitCode === 7,
  )
})
test('pipeline aborts on native failure without accepting a run manifest', () =>
  workspace((directory) => {
    const source = join(directory, 'source'),
      output = join(directory, 'output')
    mkdirSync(source)
    assert.throws(
      () =>
        runAnalysis(
          ['--source-directory', source, '--output-directory', output],
          () => {
            throw new ProcessFailure(9, 'codeql')
          },
        ),
      ProcessFailure,
    )
    assert.equal(existsSync(join(output, 'run.json')), false)
  }))
test('data script round-trips the entire export including unknown fields and SVG', () => {
  const result = {
    schemaVersion: '2.0.0',
    expression: '</script>\u2028\u2029',
    extra: { nested: ['quotes"', '\\', '\u{1f600}'] },
  }
  const svg = '<svg viewBox="0 0 100 50"><title>&amp;</title></svg>'
  const context = { window: {} as Record<string, unknown> }
  const script = serializeReport(
    result,
    '<?xml version="1.0"?>' + svg,
    'custom report',
  )
  runInNewContext(script, context)
  assert.equal(
    JSON.stringify(context.window.ANALYSIS_DATA),
    JSON.stringify(result),
  )
  assert.equal(
    JSON.stringify(context.window.REPORT_ASSETS),
    JSON.stringify({ svg, stem: 'custom report' }),
  )
  assert(!script.includes('</script>'))
})
test('report regeneration copies independent assets and loads data synchronously under relative URLs', () =>
  workspace((directory) => {
    const assets = join(directory, 'built assets')
    mkdirSync(assets)
    writeFileSync(join(assets, 'viewer.js'), '/* bundle */')
    writeFileSync(join(assets, 'viewer.css'), '/* styles */')
    const jsonPath = join(directory, 'custom report.json')
    const original =
      '\uFEFF' +
      JSON.stringify({ schemaVersion: '1.0.0', effects: [], unchanged: true })
    writeFileSync(jsonPath, original)
    writeFileSync(
      join(directory, 'custom report.svg'),
      '<svg viewBox="0 0 1 1"/>',
    )
    packageReport(jsonPath, assets)
    assert.equal(readFileSync(jsonPath, 'utf8'), original)
    assert.equal(
      readFileSync(join(directory, 'viewer.js'), 'utf8'),
      '/* bundle */',
    )
    const html = readFileSync(join(directory, 'custom report.html'), 'utf8')
    assert(
      html.indexOf('./custom%20report.data.js') < html.indexOf('./viewer.js'),
    )
    assert(!/type="module"|fetch\(|\{\{/.test(html))
    assert.throws(
      () => packageReport(jsonPath, join(directory, 'missing')),
      /build:viewer/,
    )
    writeFileSync(jsonPath, '{"schemaVersion":"invalid"}')
    assert.throws(() => readResult(jsonPath), /Unsupported/)
  }))
test('baseline CSV retains quoted delimiters and node/edge classifications', () => {
  assert.deepEqual(parseCsv('a,"b,b","c""c",d,"line\nline",f\r\n'), [
    ['a', 'b,b', 'c"c', 'd', 'line\nline', 'f'],
  ])
  assert.throws(() => parseCsv('a,b'))
  assert.throws(() => parseCsv('"unterminated'))
  const rows = [
    [
      'effect',
      'useEffect(...)',
      'file:///C:/example.ts:1:1:1:9',
      'event',
      'event',
      'file:///C:/example.ts:2:1:2:9',
    ],
    [
      'event',
      'event',
      'file:///C:/example.ts:2:1:2:9',
      'value',
      'a<&',
      'file:///C:/example.ts:3:1:3:2',
    ],
  ]
  const result = baselineDot(
    rows,
    () => 'useEffect(() => {})\nuseEffectEvent(() => {})\na',
  )
  assert.deepEqual(result.totals, {
    effects: 1,
    nodes: 3,
    connections: 2,
    files: 1,
  })
  assert(
    result.dot.includes('"effect" -> "event" [style=dotted, color="#c48336"]'),
  )
  assert(
    result.dot.includes('"event" -> "value" [style=dashed, color="#c48336"]'),
  )
  assert(result.dot.includes('a&lt;&amp;'))
})

test('CLI error handler propagates native exit codes to its caller', () => {
  const cli = pathToFileURL(join(import.meta.dirname, 'cli.ts')).href
  const program = `import { command, main } from ${JSON.stringify(cli)}; main(() => command(process.execPath, ['-e', 'process.exit(7)'], true))`
  const child = spawnSync(
    process.execPath,
    ['--input-type=module', '-e', program],
    { encoding: 'utf8' },
  )
  assert.equal(child.status, 7)
  assert.match(child.stderr, /failed with exit code 7/)
})
