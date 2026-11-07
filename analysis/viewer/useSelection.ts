import { useEffect, useState } from 'react'
import type { Effect, Result } from './types.ts'
import { depsFor } from './utils.ts'

export function useSelection(data: Result) {
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
  const effect = data.effects.find((item) => item.id === selection.effectId)
  const dependencies = effect ? depsFor(data, effect) : []
  const dependency =
    dependencies.find((item) => item.index === selection.index) ??
    dependencies[0]
  useEffect(() => {
    if (!effect) return
    const hash = new URLSearchParams({
      effect: effect.id,
      dependency: String(dependency?.index ?? 0),
    })

    // Replacing the URL can be restricted for local files; a hash still provides the same deep link.
    try {
      history.replaceState(null, '', '#' + hash.toString())
    } catch {
      location.hash = hash.toString()
    }
  }, [effect, dependency?.index])
  const select = (next: Effect | undefined, index = 0) =>
    setSelection({ effectId: next?.id, index })
  return { effect, dependencies, dependency, select }
}
