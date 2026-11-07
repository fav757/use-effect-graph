# use-effect-graph

Static analysis of React `useEffect` dependencies with CodeQL, structured JSON
provenance, and an offline graph explorer. A React 19.2 / TypeScript / Vite
dashboard provides the example application.

The repository includes two workflows:

- **Provenance analyzer:** tracks possible value sources for each dependency
  position, preserves call contexts, and separates state boundaries from possible
  initializer/setter values. Start here for the current analyzer and viewer.
- **Original dependency graph:** follows syntactic variable references with
  `example.ql` and renders CSV edges. Preserved as the comparison baseline.

See [the analyzer guide](analysis/README.md) for the JSON contract, modeling
rules, path oracle, and traversal budgets. [The recorded results](analysis/RESULTS.md)
document earlier verification and comparisons; they are not checks performed
when you clone or run this project.

See [migration verification](analysis/MIGRATION.md) for the infrastructure regression results.

## Setup and example application

Use Node.js **24+** and npm. The analysis scripts execute TypeScript directly
with Node.

Run commands from the repository root. Multi-line examples use POSIX shell
continuations; on Windows, enter each command on one line:

```sh
npm ci
npm run dev
```

Open the local URL printed by Vite. The dashboard uses local mock data from
[`src/data/mockApi.ts`](src/data/mockApi.ts), with simulated delays and abortable
requests; no backend or API credentials are required.

The example covers:

- Debounced directory search, account-status filters, and pagination.
- User activity, manual refresh, and configurable automatic refresh.
- Theme, page size, and refresh interval persisted in local storage.
- Browser online/offline events; going offline disables automatic refresh.
- `useEffectEvent` in the activity timer: ticks read the latest loading state
  and filter without restarting the timer when those values change.
- A local `useStableCallback` hook for settings actions: a stable function
  identity delegates to a callback ref updated in a layout effect.

## Run the provenance analyzer

In addition to Node/npm dependencies, install:

- CodeQL CLI; the documented toolchain uses **2.26.4**.
- The CodeQL JavaScript library pack **`codeql/javascript-all` 2.10.0**. The
  query pack pins this version, and the runner checks the resolved library path.
- Graphviz (`dot` on `PATH`) for rendered reports. Use `-SkipRender` to generate
  analysis data without Graphviz.

Check availability:

```sh
node --version
codeql version
dot -V
```

Analyze `src` and generate the report:

```sh
npm run build:viewer
npm run analysis
```

Open **`codeql-graph/provenance/extended-state.html`** in a browser. The offline
explorer lets you search Effects and dependencies, select sources, inspect
ordered paths and transition evidence, and view the graph with zoom controls.
Its export menu links to JSON, SVG, and PNG files.

The runner performs:

```text
source -> fresh CodeQL database -> inventory and comparison queries
       -> decoded BQRS -> provenance JSON -> DOT -> SVG / PNG / HTML
```

Each run creates a new database at `codeql-db/provenance-<guid>` and checks
source hashes before accepting results. Extraction uses `--build-mode=none`;
it does not execute the application or run an application build. Reusing the
output directory replaces generated reports there.

### Analysis modes

The pipeline runs all modes below; it renders `extended-state` by default.

| Mode                          | Purpose                                                                                               |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| `baseline` / `baseline-units` | Original syntactic query and normalized comparison units                                              |
| `standard-value`              | Standard CodeQL value-preserving flow                                                                 |
| `standard-taint`              | Standard flow including supported transformations                                                     |
| `extended`                    | Taint flow plus callback identity and call-context validation; stops at state slots and unknown calls |
| `extended-state`              | Extended analysis including possible initial and setter values, with distinct transition types        |

An inventory query also retains Effects with empty, absent, or unsupported
dependency arrays. React Effects are recognized by import origin, including
aliases and namespace/default imports.

### Output files

Outputs live under `codeql-graph/provenance/` by default:

| File                                          | Contents                                                                                                                                                               |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<query>.bqrs`, `<query>.raw.json`            | CodeQL results and decoded tables                                                                                                                                      |
| `<mode>.json`                                 | Schema 2.0.0 exports for the four flow modes: Effects, dependency positions, entities, typed edges, contextual paths, boundaries, diagnostics, and search completeness |
| `extended-state.dot`, `.svg`, `.png`, `.html` | Graph source, images, and offline explorer                                                                                                                             |
| `<mode>.data.js`, `viewer.js`, `viewer.css`   | Synchronously loaded analysis/SVG data and independent React assets; copy these with the report                                                                        |
| `limits.json`                                 | Export traversal budgets                                                                                                                                               |
| `run.json`                                    | Tool versions, source hashes, database location, limits, and stage timings                                                                                             |

Database directories and the default provenance output directories are ignored
by Git. Output coordinates are relative to the selected source root.

### Other inputs and rendering

Analyze another source directory with a separate output directory:

```sh
npm run analysis -- \
  -SourceDirectory path/to/source \
  -OutputDirectory codeql-graph/my-analysis
```

Output must be outside the source directory. Choose a common source root when
analyzing multiple packages; imports outside that root may remain boundaries.
`-DatabaseDirectory` must point to a new location. Optional runner flags include
`-SkipRender`, `-Threads`, `-Ram`, `-MaxDepth`, `-MaxContexts`, `-MaxPaths`, and
`-MaxSteps`. Defaults and budget semantics are in the
[analyzer guide](analysis/README.md#scope-and-limits).

Build the viewer once with `npm run build:viewer`. Analysis and report regeneration reuse
those assets until viewer source changes. No demo application build is needed.
Regenerate visual formats from existing JSON without rerunning CodeQL:

```sh
npm run report -- \
  -JsonPath codeql-graph/provenance/extended-state.json
```

Use the same command with another flow mode's JSON to render that mode.
Customize the React provenance viewer in `analysis/viewer/`.

## Checks

Targeted checks available without an application build or ESLint:

```sh
npm run typecheck:analysis
npm run typecheck:app
npm run typecheck:viewer
npm run test:analysis
```

The tests cover export/path composition, traversal budgets, stable identities,
and the independent path oracle. They do not require a CodeQL extraction.
After generating application results, run the application-specific assertions:

```sh
node analysis/app-check.ts codeql-graph/provenance
```

For a fresh fixture analysis with handwritten positive/negative source and
path expectations:

```sh
npm run analysis -- \
  -SourceDirectory analysis/fixtures \
  -OutputDirectory codeql-graph/provenance-fixtures \
  -Expectations analysis/fixtures/expected.json
```

This also writes `comparison.json`. Fixture assertion failures in
`extended-state` cause a nonzero exit status. See the
[checks and comparison guide](analysis/README.md#checks-and-comparison) for
what is scored and how path assertions work.

## Interpretation and limits

- Provenance describes possible static flow, not observed execution or the
  order of renders, Effects, timers, promises, or state updates.
- Extended exports follow `source -> value -> dependency -> Effect`. Closure
  captures and declared Hook dependencies are separate, non-composable
  annotations; reading a captured value does not prove a function identity changes.
- The rendered graph combines paths. Inspect the JSON paths and their call
  contexts before inferring a route through that combined graph.
- Unknown calls, missing imports/bodies, dynamic properties, mutable aliases,
  ref mutation, and recursion can limit precision. Setter associations passed
  through returned tuples or JSX callbacks may remain interface boundaries.
- Empty or unsupported dependency arrays retain their Effect inventory entries;
  spread, holey, and non-literal arrays receive no invented dependency positions.
- Traversal has depth, context, path, and step budgets. Consult `searches`,
  `diagnostics`, and `truncated` in JSON when assessing completeness. Reaching
  the path quota alone does not imply truncation.

## Original CSV dependency graph

[`example.ql`](codeql-queries/codeql-custom-queries-javascript/example.ql)
and its identical `baseline.ql` copy preserve the original analysis. It follows
variables referenced in literal dependency arrays and their assigned expressions:

```text
useEffect -> request -> makeRequest
                     -> userId
```

Unlike the provenance analyzer, this query matches the callee name `useEffect`
without verifying its React import. It does not model reaching definitions or
matched calls. The styled renderer shows solid dependency/source edges, dotted
Effect Event invocation edges, and dashed callback capture edges.

To regenerate the legacy graph, use a new database path (change `legacy-db` if
it already exists):

```sh
codeql database create codeql-db/legacy-db \
  --language=javascript-typescript \
  --source-root=src \
  --build-mode=none

codeql query run \
  codeql-queries/codeql-custom-queries-javascript/example.ql \
  --database=codeql-db/legacy-db \
  --output=codeql-graph/use-effects.bqrs

codeql bqrs decode codeql-graph/use-effects.bqrs \
  --result-set='#select' \
  --format=csv \
  --entities=all \
  --no-titles \
  --output=codeql-graph/edges.csv

npm run report:baseline
```

Open `codeql-graph/use-effects.html`. The renderer also writes DOT, SVG, and PNG;
its React entrypoint is `analysis/viewer/legacy-main.tsx`. These baseline files
are separate from the provenance reports.

## Troubleshooting stale results and database locks

A CodeQL database is a source snapshot. Recreate it after source edits;
rerunning a query against an old database does not import those edits. The
provenance runner creates a fresh database automatically. Rerendering JSON or
DOT only changes the presentation of existing results.

If CodeQL reports that the IMB disk cache is locked, deselect the database in
the VS Code CodeQL sidebar, close the relevant VS Code window, or use a separate
new database path. Do not delete a lock file while a query server is active.
