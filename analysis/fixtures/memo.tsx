import { useEffect, useMemo, useCallback } from 'react'

export function Memo() {
  const captured = 'capture-origin'
  const memo = useMemo(() => captured + '-memo', [captured])
  const callback = useCallback(() => captured, [captured])
  useEffect(() => {}, [memo, callback])
}
