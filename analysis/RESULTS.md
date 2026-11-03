# Verification after the export fixes

This replaces the earlier implementation report. All figures below were
rechecked on 2026-11-03 after reviewing commit `3b7490c`. Earlier measurements
were not reused. Independent complete pipelines per corpus created fresh CodeQL
databases. The React application and baseline query were not modified.

Tools: CodeQL CLI 2.26.4, JavaScript pack 2.10.0, Node.js 24.18.1,
TypeScript 5.9.3, @types/node 24.19.2, PowerShell 5.1.26100.9711,
Graphviz 15.1.1. New exports use JSON schema **2.0.0**.

## Fixes

Path equivalence includes dependency position, ordered entities and contextual
labels, transition types, evidence, rules, provenance, call contexts and summary
grounds. Different initial/update edges and contexts survive; equivalent
duplicates merge. Stable graph ordering also controls selection under budgets.

Filling the path quota no longer implies truncation. Bounded lookahead proves
exhaustion, confirms one additional admissible unique path, or reports the
actual depth/context/step budget preventing completion. Duplicate and rejected
candidates do not consume the unique-path quota. `searches` exposes the outcome.

Source-authored path oracles pin Effect/source coordinates, dependency index,
ordered checkpoints, adjacent typed transitions, evidence, call sites and stop
reasons. Every route from a selected source must satisfy its case. Captures
and Hook declarations remain non-composable annotations.

## Executed checks

| Check                                  | Result                                                                    |
| -------------------------------------- | ------------------------------------------------------------------------- |
| `npm run test:analysis`                | 29 tests passed                                                           |
| `npm run typecheck:analysis`           | Passed with strict checking, including analyzer tests                     |
| `npm run typecheck:app`                | Passed                                                                    |
| Fresh CodeQL fixture source assertions | 25/25 positives found; none of 16 forbidden origins reported              |
| Independent path oracle                | 19/19 passed: 10 required, 7 forbidden, 2 annotations                     |
| Corruption of real CodeQL paths        | Type, context and intermediate connection rejected with unchanged sources |
| Fresh `app-check.ts`                   | All 7 application checks passed                                           |
| Schema-2 browser checks                | 22 passed, no runtime errors, desktop/mobile included                     |
| Reproducibility                        | All 8 mode/corpus JSON files byte-identical across independent databases  |
| Full pipeline process status           | Exit code 0 for both corpora, captured with separate stdout/stderr        |
| Scope/whitespace checks                | Passed; React source and baseline unchanged                               |

Regression tests cover counts below/equal/above quota, duplicates,
context-rejected candidates, all other traversal budgets, summary grounds,
annotation ordering, shuffles and BQRS renumbering. A 1,000-candidate test
confirms stopping after the first additional admissible unique route.
Oracle tests also corrupt evidence coordinates and stop reasons, check source
positions independently of text, and verify Effect/index selection.

Application checks retain debouncedQuery flow through Users/custom hook/JSX,
separate theme/pageSize/refreshSeconds initializers, preserve user?.id, retain
useOnlineStatus's empty Effect, and distinguish the two state levels.
Browser checks include contextual evidence and exact-quota display without a
false truncation warning.

Application build, ESLint and real application APIs were not run under the
working agreements.

## Fresh comparison

Source assertions are unchanged. Path-case totals include missing features
and forbidden routes, not just spurious origins.

| Mode                         | Found positives | Missing | Forbidden origins | Path cases satisfied |
| ---------------------------- | --------------: | ------: | ----------------: | -------------------: |
| Original baseline projection |               7 |      18 |                 2 |      Not path-scored |
| Standard value               |              21 |       4 |                 2 |              13 / 19 |
| Standard taint               |              25 |       0 |                 2 |              14 / 19 |
| Extended state boundary      |              18 |       7 |                 0 |              12 / 19 |
| Extended state history       |              25 |       0 |                 0 |              19 / 19 |

The seven state-history cases are outside boundary mode's scope. Standard
controls still mix the two captured lazy initializers and lack the custom
callback identity rule. The baseline reports an overwritten definition and
captured-value callback identity provenance.

Fresh extended fixture output: 22 Effects, 25 dependency positions, 152 entities,
146 edges, 59 paths and 2 distinct mismatch reports. All 25 dependency searches
completed; no result was truncated.

Fresh extended application output: 13 Effects, 22 dependency positions,
170 entities, 187 edges and 330 paths. All 22 searches completed without
truncation. Six distinct source/call-site mismatch reports remain after
merging identical diagnostic records; these do not count all rejected raw
routes.

[Source/path comparison](../codeql-graph/provenance-fixtures/comparison.json),
[real-route mutation checks](../codeql-graph/provenance-fixtures/mutation-checks.json),
[application checks](../codeql-graph/provenance/application-checks.json),
[report viewer](../codeql-graph/provenance/extended-state.html).

## New stage measurements

Seconds from repeated fresh-database runs: two CodeQL threads, 6000 MB RAM,
both corpora running concurrently, compiled-query caches available.
These are observations, not comparative solver benchmarks.

| Stage                     | Application | Fixtures |
| ------------------------- | ----------: | -------: |
| Extraction/database       |      15.211 |   17.187 |
| Inventory query           |      21.396 |   20.682 |
| Original baseline query   |       6.193 |    6.075 |
| Baseline projection query |      10.334 |   10.204 |
| Standard value query      |      11.432 |   11.276 |
| Standard taint query      |      14.353 |   13.381 |
| Extended boundary query   |      11.653 |   11.671 |
| Extended state query      |      11.844 |   11.553 |
| All BQRS decoding         |       4.374 |    4.731 |
| All JSON exports          |       0.744 |    0.815 |
| Graphviz/report           |       1.613 |    1.474 |
| Fixture comparison        |           — |    0.167 |
| Sum of recorded stages    |     109.147 |  109.216 |

Each output directory's `run.json` records individual measurements, input
hashes, configuration and database location. Defaults remain depth 96,
64 call-site/summary keys, 128 retained paths and 50,000 traversal steps per
dependency.

## Reproducibility and remaining limits

[reproducibility.json](../codeql-graph/provenance/reproducibility.json) records
both database locations, identical source hashes, eight byte-identical JSON
digests and the final oracle digest. Timings and database paths are excluded
from compared graph JSON. IDs depend on source positions, model labels and
pinned tools; stability across arbitrary CodeQL versions is not claimed.

The oracle verifies selected source-authored scenarios plus structural
integrity of every exported fixture path, not semantic correctness for every
JavaScript program. CodeQL may-flow, captured variables, unresolved calls,
mutable aliases and setter associations retain the model limitations in
[README.md](README.md). Complete enumeration does not establish complete
runtime state histories or execution ordering.

Linked generated artifacts are ignored by Git. The documented pipeline
recreates analysis outputs. This report records executed checks and is not a
test oracle.
