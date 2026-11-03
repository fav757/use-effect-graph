# Recorded verification

Measured on 2026-11-03 in this working copy. The demonstration application's
`src` files were unchanged. No application API, ESLint, or application build
was executed.

Tools: CodeQL CLI 2.26.4; `codeql/javascript-all` 2.10.0;
`codeql/dataflow` 2.1.12; Node.js 24.18.1; TypeScript 5.9.3;
PowerShell 5.1.26100.9711; Graphviz 15.1.1.

## Handwritten fixture oracle

The corpus contains 13 scenario files and one import helper, with 25 positive
and 16 negative origin assertions. Effect inventory and array modes are checked
separately.

| Variant                       | Found positive assertions | Missing positive assertions | Forbidden origins reported |
| ----------------------------- | ------------------------: | --------------------------: | -------------------------: |
| Preserved baseline projection |                         7 |                          18 |                          2 |
| Standard value flow           |                        21 |                           4 |                          2 |
| Standard taint flow           |                        25 |                           0 |                          2 |
| Extended state boundary       |                        18 |                           7 |                          0 |
| Extended state history        |                        25 |                           0 |                          0 |

The seven state-history assertions outside the boundary mode's scope account
for its missing positives. The four standard-value misses require value
transformations. These finite assertion counts are not exhaustive precision
or recall estimates.

The baseline's forbidden origins are a definition overwritten before the read
and a captured value incorrectly treated as callback identity provenance.
Both standard controls report the other invocation's initializer in the
lazy-state fixture. Extended call-site composition rejects those two paths
while retaining both correct initializers. Standard assignment, property,
argument/return, import, JSX, state and memo flow remain supplied by CodeQL.

Extended fixture output contains 22 Effects, 25 dependency positions, 59 paths,
and two recorded rejected call-context paths. No export budget was reached.
Additional checks passed for both state levels, functional updater transitions,
cycle termination, unknown-call boundaries, callback identity, annotation
isolation, and a depth limit exercised on the actual CodeQL fixture graph.

Detailed links: [comparison.json](../codeql-graph/provenance-fixtures/comparison.json).
Structural checks: [fixture-invariants.json](../codeql-graph/provenance-fixtures/fixture-invariants.json).

## Application

All seven assertions in `app-check.ts` passed:

- `debouncedQuery` paths include Users, useDebouncedValue, JSX input and App.
- `theme` retains `'light'`, excluding the other two hook initializers.
- `pageSize` retains `4`, excluding the other two hook initializers.
- `refreshSeconds` retains `10`, excluding the other two hook initializers.
- The separate `user?.id` entity is preserved.
- useOnlineStatus retains its empty-array Effect.
- State-boundary and state-history modes remain distinct.

Output contains 13 Effects, 22 dependency positions, 170 entities, 187 edges,
and 330 paths. Twelve mismatched call-context paths were rejected and recorded.
No export budget was reached. Model boundaries and cycle diagnostics remain
visible in JSON; no timer, request or render ordering is inferred.

[Graph viewer](../codeql-graph/provenance/extended-state.html),
[structured result](../codeql-graph/provenance/extended-state.json),
[application assertions](../codeql-graph/provenance/application-checks.json).

## Measured stage times

Seconds, with two CodeQL threads and a 6000 MB RAM budget per process.
Application and fixture pipelines ran concurrently. Query times include CLI,
compilation and cache effects; the extended queries were compiled during this
run. These measurements must not be interpreted as comparative solver
benchmarks.

| Stage                          | Application | Fixtures |
| ------------------------------ | ----------: | -------: |
| Extraction/database            |      15.923 |   17.171 |
| Inventory query                |      23.074 |   23.100 |
| Original baseline query        |       7.737 |    7.753 |
| Baseline comparison projection |      10.771 |   10.750 |
| Standard value query           |      11.545 |   11.334 |
| Standard taint query           |      14.045 |   13.247 |
| Extended boundary query        |      50.228 |   49.852 |
| Extended state query           |      54.605 |   54.464 |
| All BQRS decoding              |       4.458 |    4.881 |
| All JSON exports               |       0.744 |    0.688 |
| Graphviz/viewer                |       1.296 |    0.977 |
| Oracle comparison/invariants   |           — |    0.164 |
| Sum of recorded stages         |     194.426 |  194.381 |

Individual stages and input hashes are recorded in each output directory's
`run.json`. Default export budgets were depth 96, 64 distinct call-site/summary
keys, 128 paths and 50,000 exploration steps per dependency.

## Other verification and limits

- Seven exporter tests passed with `node --test analysis/export.test.ts`.
- Application TypeScript checking passed with
  `node node_modules/typescript/bin/tsc --project tsconfig.app.json --noEmit`.
- The baseline copy was checked byte-for-byte against `example.ql`.
- Extended application JSON was byte-identical when the final query was run
  against two independently created databases with identical source hashes.
  Standard-value fixture JSON was also byte-identical across databases.
  See [reproducibility.json](../codeql-graph/provenance/reproducibility.json).
- Graphviz generated DOT, SVG, PNG and standalone HTML for both corpora.
- Application build and ESLint were skipped under the working agreements.

The analysis is bounded may-flow analysis. Captured variables can remain
flow-insensitive outside the ordinary call-entry/return evidence checked here.
Setter histories cover associations resolved by the standard React model;
setters hidden behind returned tuples or JSX callbacks can stop at interface
observations rather than yield a complete update history. Dynamic properties,
reflection, missing bodies, mutable aliases and library models retain the
limitations described in [README.md](README.md). The report does not claim
complete state histories or runtime causality.

Generated files linked above are ignored by Git and recreated by the documented
pipeline. This report records the observed run; it is not a test oracle.
