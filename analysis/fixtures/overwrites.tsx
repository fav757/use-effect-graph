import { useEffect } from 'react'

export function Overwrites(flag: boolean) {
  // eslint-disable-next-line no-useless-assignment
  let unconditional = 'discarded-origin'
  unconditional = 'current-origin'

  let conditional = 'before-branch'
  if (flag) conditional = 'inside-branch'

  useEffect(() => {}, [unconditional, conditional])
}
