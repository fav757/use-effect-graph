import { useEffect, useState } from 'react'

function useLazy(initial: string) {
  const [value] = useState(() => initial)
  return [value] as const
}

export function LazyStates() {
  const [left] = useLazy('lazy-left')
  const [right] = useLazy('lazy-right')
  useEffect(() => {}, [left, right])
}
