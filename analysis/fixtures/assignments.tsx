import { useEffect } from 'react'
export function Assignments() {
  const first = 'assignment-origin'
  const second = first
  const third = second
  useEffect(() => {}, [third, third])
}

