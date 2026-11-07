# Infrastructure migration verification

Verified on 2026-11-07 with Node 24.18.1, CodeQL CLI 2.26.4,
`codeql/javascript-all` 2.10.0, and Graphviz 15.1.1 on Windows.
The earlier scientific-analysis measurements remain in [RESULTS.md](RESULTS.md).

## Reference capture and analytical equivalence

Before implementation, captured the existing application and fixture JSON,
DOT, SVG, PNG and HTML, plus the original CSV graph outputs. The original
29 unit tests, analysis/application type checks, seven application assertions
and 19 handwritten fixture path-oracle assertions passed.

Ran fresh complete TypeScript pipelines against both `src` and
`analysis/fixtures`, using new database and custom output directories. The
fixture output directory contained a space. Both pipelines exited successfully,
and the fixture run invoked its expectations through the runner.

- All eight JSON exports (four modes per corpus) were deeply equal to the
  reference JSON, including IDs, edges, paths, contexts, diagnostics, budgets
  and completeness metadata. No metadata exclusions were needed in result JSON.
- Both corpora's extended-state DOT, SVG and PNG were byte-identical.
- Regeneration from existing application/fixture JSON preserved those input
  files byte-for-byte and reproduced identical DOT, SVG and PNG.
- The migrated baseline CSV renderer reproduced byte-identical DOT, SVG and PNG:
  41 nodes, 34 edges and six file groups.
- Regenerating the standard-value graph produced byte-identical reference DOT.
- Seven application assertions and all 19 fixture path assertions passed against
  the fresh results. Standard-control comparison counts were unchanged.
- Query files, the exporter/`toDot`, fixtures, path oracle and demo source were
  not modified. Run metadata retains its contract except that the obsolete
  PowerShell version field is omitted; durations/database locations vary.

Reference captures and local browser automation evidence remain in the ignored
`.migration-reference/` directory. They are verification artifacts, not runtime
report dependencies.

## Targeted checks

- `npm run test:analysis`: **39 passed**, including ten new infrastructure tests.
  These cover CLI defaults/aliases/bounds, command arguments/stages, unsafe output
  locations, source hashes, failure exit status, CSV classifications, complete
  data serialization and report regeneration without CodeQL.
- `npm run typecheck:analysis`: passed.
- `npm run typecheck:app`: passed.
- `npm run typecheck:viewer`: passed.
- `npm run build:viewer`: both independent IIFE/CSS bundles built successfully.
- `git diff --check`: passed.

## Offline browser checks

Automated a hidden local Microsoft Edge browser through its debugging protocol.
Application and fixture reports opened directly under `file://`. Checked Effect
and dependency navigation, source/category filters, expanded provenance paths,
transition evidence, notes, empty dependency states, search/no-match recovery,
export URLs, Escape dismissal, graph highlighting and zoom. Zoom and highlight
settings persisted across Effect changes. The baseline React report opened and
zoomed correctly.

Copied a report with its data, viewer and exports to another directory containing
spaces and opened it without a server. Also checked an artifact stem containing
spaces and `#`, and a standard-value report alongside extended-state using
shared viewer assets. There were no JavaScript exceptions or HTTP(S) report
resource requests. Synchronous data-before-viewer loading used classic scripts.

## Workflow and compatibility

Build viewer assets once with `npm run build:viewer`, run analysis with
`npm run analysis`, or regenerate existing JSON with `npm run report -- file.json`.
Use `--html` to repackage existing JSON/SVG without Graphviz rendering;
`--dot-only` preserves the old direct renderer's DOT-only operation.
`npm run report:baseline` regenerates the original CSV graph and React report.
`npm run typecheck:viewer` checks the viewer separately from the demo.

The three PowerShell entrypoints and both HTML templates were removed. Existing
single-dash option names/defaults remain supported, with kebab-case aliases.
No dependencies were added. Copy report HTML, data JS, viewer JS/CSS and graph
exports together; the report is now a portable set of files.

Browser execution was checked in Edge on Windows; other browsers and operating
systems were not exercised. No real APIs, ESLint or demo application builds
were run. The viewer build was explicitly requested by the migration task.
