import { useEffect } from 'react'

export function Arrays(deps: string[]) {
  useEffect(() => {}, [])
  useEffect(() => {})
  useEffect(() => {}, deps)
  useEffect(() => {}, [...deps])
  // eslint-disable-next-line no-sparse-arrays
  useEffect(() => {}, [,])
}
