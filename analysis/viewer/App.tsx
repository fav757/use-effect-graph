import { useState } from 'react'
import { Navigation, visibleEffects } from './Navigation.tsx'
import { ReportHeader } from './ReportHeader.tsx'
import { EffectPanel } from './EffectPanel.tsx'
import { Icon } from './Icon.tsx'
import { useSelection } from './useSelection.ts'
import type { ReportAssets, Result } from './types.ts'
import { modeName } from './utils.ts'

export function App({ data, assets }: { data: Result; assets: ReportAssets }) {
  const [search, setSearch] = useState('')
  const selection = useSelection(data)
  const visible = visibleEffects(data, search)
  return (
    <div className="app">
      <Navigation
        data={data}
        visible={visible}
        selected={selection.effect}
        search={search}
        onSearch={(value) => {
          setSearch(value)
          const next = visibleEffects(data, value)
          if (!next.includes(selection.effect!)) selection.select(next[0])
        }}
        onSelect={selection.select}
      />

      <main className="workspace">
        <ReportHeader data={data} stem={assets.stem} />

        {selection.effect ? (
          <EffectPanel
            data={data}
            svg={assets.svg}
            effect={selection.effect}
            dependencies={selection.dependencies}
            dependency={selection.dependency}
            onDependency={(index) => selection.select(selection.effect, index)}
          />
        ) : (
          <div className="empty-workspace">
            No matching Effects. Try another file or dependency.
          </div>
        )}

        <footer className="footer">
          <span>
            <Icon name="check" />
            {modeName(data.mode)} <span style={{ color: '#d0d5df' }}>·</span>{' '}
            Sources and paths from your analysis
          </span>

          <a href={`./${encodeURIComponent(assets.stem)}.json`} download>
            View analysis data ↗
          </a>
        </footer>
      </main>
    </div>
  )
}
