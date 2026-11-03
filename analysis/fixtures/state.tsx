import { useEffect, useState } from 'react'
export function State() {
  const [value, setValue] = useState('state-initial')
  useEffect(() => { setValue('state-next') }, [])
  useEffect(() => { setValue(previous => previous + '-suffix') }, [])
  useEffect(() => {}, [value])
}

