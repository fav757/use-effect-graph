# Effect provenance analyzer

Requires PowerShell, Node.js 24+, Graphviz, and CodeQL CLI 2.26.4 with
`codeql/javascript-all` **2.10.0**. The pack dependency is pinned.
No application code, real APIs, npm build, or ESLint commands are executed.

See [RESULTS.md](RESULTS.md) for the measured comparison, application checks,
tool versions, timings, and reproducibility results from this implementation.

Run from the repository root:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File analysis/run.ps1
node analysis/app-check.ts codeql-graph/provenance
node --test analysis/export.test.ts

powershell -NoProfile -ExecutionPolicy Bypass -File analysis/run.ps1 `
  -SourceDirectory analysis/fixtures `
  -OutputDirectory codeql-graph/provenance-fixtures `
  -Expectations analysis/fixtures/expected.json
```

The default input is `src`. Pass another source directory with
`-SourceDirectory` and a separate `-OutputDirectory`. Output must be outside
the source directory. Coordinates are relative to the selected source root.
Imports outside that root may be boundaries; choose a common source directory
for multiple packages. Avoid mixing generated HTML or fixtures into app inputs.

Each run creates a new database under `codeql-db/provenance-<guid>`; it never
overwrites/deletes an existing database. `-DatabaseDirectory` accepts another
new location. Extraction uses `--build-mode=none`, not an application build.
Source SHA-256 hashes are checked again before accepting results.

The pipeline performs extraction, inventory, baseline and normalized baseline,
two standard controls, both extended modes, BQRS decoding, JSON export, and
Graphviz rendering. `run.json` records versions, source hashes, limits,
database path and stage timings. Query times include compilation and caching;
they are measurements of that run rather than controlled benchmarks.
Use `-SkipRender` without Graphviz.

Open `codeql-graph/provenance/extended-state.html` for the offline Effect
explorer. Search by file or dependency, select a dependency and source, then
expand a provenance path to inspect its code and transition evidence. Origins
and intermediate interfaces have separate filters. Empty and unsupported
dependency arrays remain visible in the navigation.

The Graph overview tab highlights the selected dependency and provides zoom
controls. The export menu links to the unchanged JSON and the full SVG/PNG
graph. The viewer uses `analysis/viewer-template.html`; the original baseline
viewer is preserved separately. Regenerate the report directly from JSON:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File analysis/render.ps1 `
  -JsonPath codeql-graph/provenance/extended-state.json
```

The original `example.ql`, CSV renderer and viewer are preserved.
`baseline.ql` is an exact copy of the original query.

## Standard-library audit and differences

| Mode           | Mechanism                                   | Interpretation                                                       |
| -------------- | ------------------------------------------- | -------------------------------------------------------------------- |
| baseline       | Original AST/variable references            | Syntactic dependence; no reaching definitions or matched calls       |
| standard-value | `DataFlow::Global`                          | Value-preserving flow to exact dependency elements                   |
| standard-taint | `TaintTracking::Global`                     | Also includes supported transformations                              |
| extended       | Standard taint, callback identity, barriers | Stops at React state slots and unknown calls                         |
| extended-state | Same analysis with state flow enabled       | Initial values and possible setter values distinguished by edge type |

The standard configurations add no custom steps or barriers. Extended queries
reuse standard assignment, property, parameter/return, import, JSX and state
flow. The custom identity step only connects `useCallback`/`useEffectEvent`'s
callback argument to the hook's returned identity.

A second confirmed gap appears in `usePersistentState`: a lazy initializer
captures an outer parameter, and standard flow can lose the relationship
between that parameter's input call and the hook's returned tuple. The
`lazy-state.tsx` fixture reproduces this independently of the application.
Extended export therefore checks ordinary argument/return call-site evidence
from CodeQL's public call inference. It rejects paths that enter the same
function through one invocation and return through another; `filteredPaths`
records the rejected source and both call sites. Standard controls retain
their original paths for comparison. This is a path-composition extension,
not a replacement for CodeQL's solver. Bound/reflective calls without ordinary
argument/return evidence retain the standard model's precision.

Extended configurations exclude initializer/updater function identities from
candidate origins, while preserving their captured and returned value flows.

The installed JavaScript pack was inspected at source commit
`1d123a2caa0e4e6256a49d963bfcbd51a01617e8`:

- `semmle/javascript/dataflow/DataFlow.qll` uses SSA local reaching definitions.
  Its header explicitly documents flow-insensitive captured variables.
- `semmle/javascript/frameworks/React.qll` models component/JSX props,
  `UseStateStep` (lines 583–612), lazy initializers, direct/functional setter
  values, current-state updater parameters, refs, context, and `UseMemoStep`
  (lines 718–730).
- `PreCallGraphStep.qll` integrates these existing React steps into ordinary
  flow and call inference. Their implementation was not duplicated.
- No `useCallback`/`useEffectEvent` identity model was found in that version.
  `Provenance.qll:callbackIdentity` is the separately marked extension.
- `codeql/dataflow` 2.1.12 supplies contextual `PathNode`, `flowPath`,
  path edges, and matched `subpaths(arg, parameter, return, out)`.

Primary references:
[global flow and taint](https://codeql.github.com/docs/codeql-language-guides/analyzing-data-flow-in-javascript-and-typescript/),
[React library documentation](https://codeql.github.com/docs/codeql-language-guides/codeql-library-for-javascript/),
[pinned React model](https://github.com/github/codeql/blob/1d123a2caa0e4e6256a49d963bfcbd51a01617e8/javascript/ql/lib/semmle/javascript/frameworks/React.qll).
Standard CodeQL mechanisms are dependencies, not claims of scientific novelty.

## JSON and composition contract

`<mode>.json` contains:

- `effects`: coordinates and `literal`, `empty`, `absent`, or
  `unsupported` array mode, including Effects without edges.
- `dependencies`: Effect ID, array index, exact expression, and entity ID.
  Repeated positions and `user` versus `user.id` remain distinct.
- `entities`: relative file, one-based UTF-16 coordinates with inclusive end,
  semantic kind, label, exact source text and source-based stable ID.
- `edges`: source → value → dependency → Effect direction, type, evidence
  coordinates, rule, status, provenance, and composition eligibility.
- `paths`: dependency ID, candidate source/role, ordered entity and edge IDs,
  stop reason and model status.
- `boundaries`, `diagnostics`, `limits`, approximation notes and `truncated`.
  `filteredPaths` separately records paths rejected by call-site matching.

Entity IDs use relative positions, kinds and descriptive labels. Edge/path IDs
hash source-based values. BQRS entity numbers are used only as temporary
references while enumerating paths. They are never output as stable program
IDs. Changing source coordinates changes identity. Arrays are sorted; timings
and database locations are isolated in `run.json`.

Origins include literals, object/array/function allocation sites, state slots,
and unknown calls. Parameters/properties are also exported as
`sourceRole: observation`: these expose intermediate interfaces/reads and do
not assert that no earlier source exists. Unknown calls are explicit boundaries.
A modeled path describes possible flow, not observed execution.

Only contextual edges from the same CodeQL configuration compose. Calls expand
through their exact `(arg, parameter, return, out)` tuples. Contextual nodes
remain distinct until a full path is enumerated; names and positions alone are
never used to join paths. Extended modes also match ordinary call entry and
return sites across captured parameters. The visual graph is the union of paths: use JSON paths
to inspect contexts rather than inventing new paths through that union.

Composable transitions include `value-flow`, `transformation`,
`property-read`, `call-argument`, `call-return`, `callback-identity`,
`state-initial`, `state-update`, and `state-update-functional`.
Allocations have distinct origin entity kinds. `effect-dependency`,
`hook-dependency` and `closure-capture` are non-composable annotations.
Capturing a variable does not prove that a function's identity changes.
DOT renders captures dashed and Hook declarations dotted.

## Scope and limits

Supported within the standard model's precision: reaching assignments and
conditional branches; arithmetic/string taint transformations; static properties
and destructuring; parameters, returns and imports; visible custom hooks;
React JSX inputs; `useMemo`; callback identities and capture annotations;
state, lazy initializers, direct and functional setter updates.
Setter history is limited to associations resolved by the standard React model;
setters passed through returned tuples or JSX callbacks may remain interface
boundaries rather than provide a complete update history.
React Effects are recognized by import origin, including named aliases,
namespace/default imports, while excluding local functions with the same name.

Initial state and setter updates have different transition types. The state
level records possible values, without inferring ordering of renders, Effects,
timers, promises, cancellations or updates. Unknown calls have an incoming
barrier; no custom all-arguments-to-result approximation is used.
Dynamic properties, reflection, proxies, missing bodies/imports, mutable aliases,
ref mutation and recursion can limit precision. Spread/holey/non-literal
dependency arrays retain the Effect but receive no invented element positions.

Default export budgets per dependency: depth 96, 64 distinct matched call-site
or summary-context keys,
128 paths and 50,000 exploration steps. Override with `-MaxDepth`,
`-MaxContexts`, `-MaxPaths`, `-MaxSteps`. A repeated contextual node terminates
a cyclic branch. Reached budgets yield diagnostics and `truncated: true`.
These are export bounds; standard CodeQL model/context/access-path
approximations still apply. `-Threads` and `-Ram` control CodeQL resources.

## Checks and comparison

The independent fixtures and positive/negative expectations are handwritten.
`export.test.ts` checks cycles, all budgets, matched call expansion, retained
empty Effects, annotation isolation, and stable output under BQRS renumbering.
`app-check.ts` checks the requested application cases and both state levels.

`check.ts` writes `comparison.json` with found, missing and forbidden links
for all modes. The unit is an Effect source position, dependency index and
origin expression position. Fixture literal labels are unique, so handwritten
expectations identify their source positions unambiguously.
The baseline adapter projects reachable variables onto their assigned
expressions; it adds no call/property reasoning. Its lack of standalone Effect
inventory is reported rather than scored using another analyzer's inventory.
Scores cover only explicit oracle assertions, not exhaustive real-world
precision/recall. An extended-state assertion failure exits with nonzero status.
