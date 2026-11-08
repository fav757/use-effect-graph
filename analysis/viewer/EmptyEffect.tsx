import type { Effect, Entity } from './types.ts'

export function EmptyEffect({
  effect,
  entity,
}: {
  effect: Effect
  entity?: Entity
}) {
  const [title, description] =
    effect.mode === 'empty'
      ? [
          'Empty dependency array',
          'This Effect declares no dependencies. It is retained in the report, with no dependency origins to trace.',
        ]
      : effect.mode === 'absent'
        ? [
            'No dependency array',
            'This Effect has no explicit dependency entries to analyze.',
          ]
        : [
            'Unsupported dependency array',
            'The dependency argument could not be interpreted as a fixed list. No element positions have been invented.',
          ]

  return (
    <div className="empty-state">
      <div className="empty-icon">
        {effect.mode === 'empty' ? '[ ]' : '···'}
      </div>

      <h3>{title}</h3>
      <p>{description}</p>

      <details className="source-code">
        <summary>View Effect source</summary>
        <pre>{entity?.expression ?? ''}</pre>
      </details>
    </div>
  )
}
