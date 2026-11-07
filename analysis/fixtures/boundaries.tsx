import { useEffect } from 'react'
import { opaque } from 'unavailable-fixture-module'
function recursive(value: string): string {
  return recursive(value)
}

export function Boundaries(flag: boolean) {
  const unknown = opaque('must-not-propagate')
  let cyclic = 'cycle-seed'
  while (flag) cyclic = cyclic + '-cycle'
  const recursion = recursive('recursive-input')
  useEffect(() => {}, [unknown, cyclic, recursion])
}
