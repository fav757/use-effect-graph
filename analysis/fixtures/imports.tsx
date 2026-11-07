import React, { useEffect as effect } from 'react'
import * as Namespace from 'react'

export function Imports() {
  effect(() => {}, ['alias-origin'])
  Namespace.useEffect(() => {}, ['namespace-origin'])
  React.useEffect(() => {}, ['default-origin'])
  function useEffect(callback: () => void, deps: unknown[]) {
    callback()
    return deps
  }
  useEffect(() => {}, ['local-fake'])
}
