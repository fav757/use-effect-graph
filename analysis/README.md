# Effect provenance analyzer

Requires Node.js 24+, Graphviz, and CodeQL CLI 2.26.4 with
`codeql/javascript-all` **2.10.0**. The pack dependency is pinned.
Analysis does not execute application code, real APIs, application builds, or ESLint.

See [RESULTS.md](RESULTS.md) for the measured comparison, application checks,
tool versions, timings, and reproducibility results from this implementation.

See [migration verification](MIGRATION.md) for the infrastructure regression results.

Run from the repository root:

```sh
npm run typecheck:analysis
npm run typecheck:app
npm run typecheck:viewer
npm run test:analysis
npm run build:viewer
npm run analysis
node analysis/app-check.ts codeql-graph/provenance

npm run analysis -- \
  -SourceDirectory analysis/fixtures \
  -OutputDirectory codeql-graph/provenance-fixtures \
  -Expectations analysis/fixtures/expected.json
```

Install dependencies with `npm ci` first. `@types/node` targets Node 24 and is
locked in `package-lock.json`. `tsconfig.analysis.json` checks `analysis/*.ts`,
including the exporter and oracle tests, with strict checking and no emit.
Intentionally incomplete fixtures are excluded. The application check remains
limited to `src`; neither command runs a build or ESLint.

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
graph. The React viewer lives in `analysis/viewer/`; the baseline graph has a separate React entrypoint with its original styles. Regenerate the report directly from JSON:

```sh
npm run report -- \
  -JsonPath codeql-graph/provenance/extended-state.json
```

The original `example.ql` is unchanged; the CSV renderer and viewer are migrated to TypeScript and React.
`baseline.ql` is an exact copy of the original query.

## Offline viewer and packaging

`npm run build:viewer` builds both React viewers independently into
`analysis/viewer/dist`. It uses the existing Vite, React and TypeScript
dependencies. Rebuild only when viewer source changes; analysis never invokes a
viewer or application build. Run this command once before rendering reports.

`npm run report -- result.json` regenerates DOT with the unchanged `toDot`,
renders SVG/PNG with Graphviz, and packages the report without CodeQL.
`npm run report -- result.json --html` only repackages existing JSON/SVG;
`--dot-only` retains the former direct `render.ts` DOT-only operation.
`-JsonPath result.json` and `--json-path result.json` are also accepted.

The minimal `<mode>.html` loads `<mode>.data.js` synchronously before the
ordinary IIFE `viewer.js` bundle. `window.ANALYSIS_DATA` contains the complete,
unchanged JSON object; `window.REPORT_ASSETS` contains the original Graphviz
SVG and artifact stem. React renders the interface; SVG presentation is adapted
in one component without rebuilding graph geometry. CSS is separate in
`viewer.css`. There is no runtime JSON request, module script, HTML template
replacement, or server. Open the HTML directly under `file://`.

Copy HTML, data JS, viewer JS/CSS, JSON, SVG and PNG together to move a report.
Reports for multiple modes can share viewer JS/CSS in one output directory.
The baseline renderer uses corresponding `viewer-baseline.js`/`.css` assets
and `use-effects.data.js` with the same offline loading mechanism.

All existing runner option names/defaults remain available, including
single-dash PascalCase names; double-dash kebab-case aliases are accepted too.
Native child failures propagate their exit status. `run.json` retains analysis
metadata and omits the obsolete PowerShell version field;
the Node version remains recorded. Graphviz and the pinned CodeQL toolchain
remain external dependencies. Node 24+ is required. Shell continuation examples
use POSIX syntax; on Windows, use the same command on one line.

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

New exports use **schema 2.0.0**. Version 2 adds ordered contextual node labels
on paths, preserves call-summary grounds on edges, and exposes per-dependency
enumeration results in `searches`. Path/edge IDs have changed deliberately;
consumers must not reuse version-1 cached IDs. Source-based entity IDs remain
unchanged. The report renderer accepts versions 1 and 2; version-2 context and
budget evidence is shown in transition details and analysis notes. Independent
path checking requires version 2.

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
  ordered `contexts` (one CodeQL contextual label per node), stop reason and
  model status.
- `searches`: retained path count, whether the quota was filled, whether an
  additional admissible unique path was found, enumeration completeness, and
  consumed step/context budgets for each dependency.
- `boundaries`, `diagnostics`, `limits`, approximation notes and `truncated`.
  `filteredPaths` separately records unique source/call-site mismatch reports;
  it is not a count of all rejected raw routes.

Entity IDs use relative positions, kinds and descriptive labels. Edge/path IDs
hash source-based values. BQRS entity numbers are used only as temporary
references while enumerating paths. They are never output as stable program
IDs. Changing source coordinates changes identity. Arrays are sorted; timings
and database locations are isolated in `run.json`.

Two paths are equivalent only when they have the same dependency position,
ordered entity IDs, ordered contextual node labels, and ordered transitions.
Each transition includes its endpoints, type, evidence coordinates, rule,
provenance, matched call context (action, source-based call site and target
function position), and any call-summary grounds. Source role and stop reason
are derived from the common source entity and analysis mode. Different state
initial/update transitions, provenance, or meaningful call contexts therefore
remain different paths even when the entity sequence is identical.

Exact duplicate BQRS rows are normalized before traversal. Contextual nodes
remain separate during traversal; semantic path duplicates are merged only
after call-context validation. Stable neighborhood refinement orders otherwise
tied nodes without using BQRS numbers, including when budgets stop enumeration
early. It does not join graph nodes. Temporary entity numbers are used only
to follow BQRS relations and detect cycles. Path IDs hash the complete semantic
path key; edge IDs include their evidence and summary grounds. Boundary and
rejected-context records merge only identical records. Annotation reachability
is computed to a fixed point, independently of row order, and remains
non-composable.

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
a cyclic branch. Cycles are recorded as `bounded`; completeness refers to the
available graph under that cycle-cutting policy, not completeness of program
semantics.

Filling the unique-path quota alone does **not** imply truncation. Enumeration
continues only to establish exhaustion or find the first additional admissible
unique path. Equivalent duplicates and context-rejected candidates do not
consume the path quota. The lookahead still obeys depth, context and step
budgets; it never requires unbounded path enumeration.

- Exactly all available paths retained: `searches[].complete: true`, even if
  `pathLimitReached: true`; no `path-limit` diagnostic.
- One additional admissible unique path found and omitted:
  `additionalPathFound: true`, `complete: false`, `path-limit`, and
  `truncated: true`. No count of unvisited paths is claimed.
- Another budget stops the search before completeness can be established:
  `complete: false` and the actual `depth-limit`, `context-limit` or
  `step-limit` diagnostic. A path-limit diagnostic is not invented.

Step counts include attempted candidates, including semantic duplicates and
rejected contexts; exact duplicate table rows are removed first. Contexts count
distinct call-site/summary keys. Available graph enumeration can be complete
while external calls or interfaces still remain model boundaries.
These are export bounds; standard CodeQL model/context/access-path
approximations still apply. `-Threads` and `-Ram` control CodeQL resources.

## Checks and comparison

The independent fixtures and positive/negative expectations are handwritten.
`export.test.ts` checks cycles, all budgets, matched call expansion, retained
empty Effects, annotation isolation, and stable output under BQRS renumbering.
`app-check.ts` checks the requested application cases and both state levels.

`expected.json` retains its original per-file positive/negative source
assertions and adds `"$paths": "paths.expected.json"`, resolved relative to
that file. The companion path oracle has its own `schemaVersion: "1.0.0"`
and `required`, `forbidden`, and optional `annotations` arrays.

Each path case specifies an `id`, an Effect position, `dependencyIndex`, and a
source selector. Positions require `file`, `startLine`, and `startColumn`;
inclusive end coordinates are optional. Entity selectors can also constrain
`kind` and `expression`. Required cases specify `stopReason`, an optional
ordered `via` subsequence of intermediate entities, and ordered `transitions`.
Each transition must be an actual adjacent edge with matching `from`, `to`,
`type`, optional `rule`/`evidence`/`provenance`, and optional `callContext`
(`action`, call-site position, target function position). Checkpoints allow
additional SSA aliases without accepting arbitrary rewiring.

Every path with the selected Effect/index/source must satisfy a required case;
one good witness cannot hide a corrupted sibling. Forbidden cases reject any
matching route (or all routes from the selected source when no further
constraints are given). Annotation cases require exact source positions and
`composable: false`. All paths are also checked for endpoint agreement,
node/edge connectivity, contextual-label coverage, and absence of annotation
edges in value paths.

Native flow cases compare transition semantics and evidence across configurations;
they do not pin the incidental `CodeQL.<mode>` label. The callback extension
additionally pins its explicit `extension.react-callback-identity` rule.

The 10 required source-authored cases cover ordinary function calls, custom
hooks, captured lazy initializers, state initialization, direct/functional
setter updates and callback identity. Seven forbidden routes exclude crossed
invocations and captured-value identity provenance; two annotation assertions
keep lexical captures and declared Hook dependencies separate. Coordinates
were derived from fixture sources and the documented model, not accepted from
analyzer snapshots. `path-oracle.test.ts` deliberately corrupts transition
types, call contexts, intermediate connections and stop reasons while keeping
the source unchanged, and also checks source positions and Effect/index
selection.

`calls-left` and `calls-right` additionally pin the exact ordered `contexts`
labels for the pinned CodeQL library. Other experimental cases check contextual
label coverage only; their label contents and context-to-context transitions
are not independently validated. Unit tests also check corrupted label contents
and order against explicitly authored expectations. Fixture coordinate tests
check the expectations against the current TypeScript source syntax.

`check.ts` writes `comparison.json` with found, missing and forbidden links
for all modes. The unit is an Effect source position, dependency index and
origin expression position. Fixture literal labels are unique, so handwritten
expectations identify their source positions unambiguously.
The baseline adapter projects reachable variables onto their assigned
expressions; it adds no call/property reasoning. Its lack of standalone Effect
inventory is reported rather than scored using another analyzer's inventory.
Scores cover only explicit oracle assertions, not exhaustive real-world
precision/recall. `comparison.json.pathChecks` reports the independent path
oracle for each flow mode; the syntactic baseline has no comparable path
witnesses and is not path-scored. Any extended-state source, inventory or path
assertion failure exits with nonzero status.
