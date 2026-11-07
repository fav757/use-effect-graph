import { Icon } from './Icon.tsx'
import type { Effect, Result } from './types.ts'
import { basename, compact, depsFor, modeName } from './utils.ts'

export function visibleEffects(data: Result, search: string) {
  return data.effects.filter((effect) =>
    `${effect.location.file} ${effect.mode} ${depsFor(data, effect)
      .map((dep) => dep.expression)
      .join(' ')}`
      .toLowerCase()
      .includes(search.trim().toLowerCase()),
  )
}

export function Navigation({
  data,
  visible,
  selected,
  search,
  onSearch,
  onSelect,
}: {
  data: Result
  visible: Effect[]
  selected?: Effect
  search: string
  onSearch: (value: string) => void
  onSelect: (effect: Effect) => void
}) {
  const groups = new Map<string, Effect[]>()

  for (const effect of visible) {
    groups.set(effect.location.file, [
      ...(groups.get(effect.location.file) ?? []),
      effect,
    ])
  }

  return (
    <aside className="sidebar" aria-label="Effect navigation">
      <div className="brand">
        <span className="brand-mark">
          <Icon name="layers" />
        </span>
        <span>
          effect<span style={{ fontWeight: 400, color: '#8f9aaf' }}>graph</span>
          <small> / </small>
        </span>
      </div>
      <div className="sidebar-heading">
        PROJECT EFFECTS <span className="counter">{data.effects.length}</span>
      </div>
      <div className="search">
        <Icon name="search" />
        <label className="sr-only" htmlFor="search">
          Search Effects by file or dependency
        </label>
        <input
          id="search"
          type="search"
          placeholder="Find an effect…"
          autoComplete="off"
          value={search}
          onChange={(event) => onSearch(event.target.value)}
        />
      </div>
      <nav className="effect-list" aria-label="Effects grouped by source file">
        {[...groups].map(([file, effects]) => (
          <div className="file-group" key={file}>
            <div className="file-name" title={file}>
              <Icon name="file" />
              <span>{basename(file)}</span>
            </div>
            {effects.map((effect) => {
              const deps = depsFor(data, effect)
              return (
                <button
                  className={`nav-effect ${effect === selected ? 'active' : ''}`}
                  key={effect.id}
                  aria-current={effect === selected ? 'true' : undefined}
                  onClick={() => onSelect(effect)}
                >
                  <span className="nav-title">
                    useEffect{' '}
                    <span className="nav-line">
                      L{effect.location.startLine}
                    </span>
                  </span>
                  <span className="nav-deps">
                    {deps.length
                      ? `[${deps.map((dep) => compact(dep.expression, 30)).join(', ')}]`
                      : effect.mode === 'empty'
                        ? '[] · empty dependencies'
                        : effect.mode === 'absent'
                          ? 'No dependency array'
                          : 'Unsupported dependency array'}
                  </span>
                </button>
              )
            })}
          </div>
        ))}
        {!visible.length && (
          <div className="no-results">No matching Effects</div>
        )}
      </nav>
      <div className="sidebar-bottom">
        <span className="status-dot" />
        <span>{modeName(data.mode)}</span>
      </div>
    </aside>
  )
}
