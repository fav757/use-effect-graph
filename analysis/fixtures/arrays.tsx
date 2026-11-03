import { useEffect } from 'react'
export function Arrays(deps: string[]) {
  useEffect(() => {}, [])
  useEffect(() => {})
  useEffect(() => {}, deps)
  useEffect(() => {}, [...deps])
  useEffect(() => {}, [,])
}

