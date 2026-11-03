import { useEffect } from 'react'
function useIdentity(value: string) { return value }
function Child({ input }: { input: string }) {
  const value = useIdentity(input)
  useEffect(() => {}, [value])
  return <span>{value}</span>
}
export function Parent() { return <Child input="jsx-origin" /> }

