import { useEffect } from 'react'

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function first(value: string, unused: string) {
  return value
}

export function Calls() {
  const left = first('left-origin', 'unused-left')
  const right = first('right-origin', 'unused-right')
  useEffect(() => {}, [left, right])
}
