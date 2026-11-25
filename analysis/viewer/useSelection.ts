import { useEffect, useMemo, useState } from 'react'
import type { Effect, Result } from './types.ts'
import { depsFor } from './utils.ts'

export function useSelection(data: Result, view: 'graph' | 'traces') {
  const [selection, setSelection] = useState<{
    effectId: string | undefined
    index: number
  }>(() => {
    const hash = new URLSearchParams(location.hash.slice(1))
    return {
      effectId:
        data.effects.find((effect) => effect.id === hash.get('effect'))?.id ??
        data.effects[0]?.id,
      index: Number(hash.get('dependency')) || 0,
    }
  })

  const effect = useMemo(
    () => data.effects.find((item) => item.id === selection.effectId),
    [data, selection.effectId],
  )

  const dependencies = useMemo(
    () => (effect ? depsFor(data, effect) : []),
    [data, effect],
  )

  const dependency = useMemo(
    () =>
      dependencies.find((item) => item.index === selection.index) ??
      dependencies[0],
    [dependencies, selection.index],
  )

  const select = (next: Effect | undefined, index = 0) =>
    setSelection({ effectId: next?.id, index })

  useEffect(() => {
    if (!effect) return

    const current = new URLSearchParams(location.hash.slice(1))
    if (view === 'graph' && !current.has('effect')) return

    const hash = new URLSearchParams({
      effect: effect.id,
      dependency: String(dependency?.index ?? 0),
    })

    if (view === 'graph') hash.set('view', 'graph')

    // Replacing the URL can be restricted for local files; a hash still provides the same deep link.
    try {
      history.replaceState(null, '', '#' + hash.toString())
    } catch {
      location.hash = hash.toString()
    }
  }, [effect, dependency?.index, view])

  return { effect, dependencies, dependency, select }
}
