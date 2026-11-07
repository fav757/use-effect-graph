import { useEffect } from 'react'
import { imported } from './imports-helper'

export function CrossFile() {
  const value = imported('import-origin', 'import-unused')
  useEffect(() => {}, [value])
}
