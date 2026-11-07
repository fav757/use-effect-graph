import { useEffect, useState } from 'react'

function useLocal(initial: string) {
  const [value, setValue] = useState(initial)
  useEffect(() => {}, [initial])
  return [value, setValue] as const
}

export function CustomHooks() {
  const [left] = useLocal('hook-left')
  const [right] = useLocal('hook-right')
  useEffect(() => {}, [left, right])
}
