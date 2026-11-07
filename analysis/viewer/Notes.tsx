import { Icon } from './Icon.tsx'
import type { Dependency, Effect, Result } from './types.ts'
import { reasons } from './utils.ts'
export function Notes({
  data,
  effect,
  dependency,
}: {
  data: Result
  effect: Effect
  dependency?: Dependency
}) {
  const search = data.searches?.find(
    (item) => item.dependencyId === dependency?.id,
  )
  const boundaries = data.boundaries.filter(
    (boundary) => boundary.dependencyId === dependency?.id,
  )
  const diagnostics = data.diagnostics.filter(
    (item) =>
      item.dependencyId === dependency?.id || item.dependencyId === effect.id,
  )
  const filtered = (data.filteredPaths ?? []).filter(
    (item) => item.dependencyId === dependency?.id,
  )
  const reasonList = [...new Set(boundaries.map((boundary) => boundary.reason))]
  return (
    <details className="notes">
      <summary>
        <Icon name="info" /> Boundaries &amp; analysis notes
        {filtered.length > 0 &&
          ` · ${filtered.length} call-context mismatch reports`}
      </summary>
      <div className="notes-content">
        {search?.pathLimitReached && (
          <p>
            {search.complete
              ? `All ${search.retainedPaths} available paths were retained, exactly filling the path quota.`
              : search.additionalPathFound
                ? 'At least one additional admissible unique path was omitted by the path quota.'
                : 'The path quota was filled; another budget prevented proving that enumeration is complete.'}
          </p>
        )}
        {reasonList.map((reason) => (
          <p key={reason}>
            <b>{reason.replaceAll('-', ' ')}.</b> {reasons[reason] ?? ''}
          </p>
        ))}
        {diagnostics.map((item, index) => (
          <p key={index}>
            {item.reason.replaceAll('-', ' ')} · {item.status}
          </p>
        ))}
        {filtered.length > 0 && (
          <p>
            {filtered.length} source/call-site mismatch reports were recorded.
            Candidates with different function entry and return call sites were
            excluded.
          </p>
        )}
        <p>
          Paths describe possible value flow. They do not infer the order of
          renders, timers, or state updates.
        </p>
      </div>
    </details>
  )
}
