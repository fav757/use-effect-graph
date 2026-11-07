import { useEffect } from 'react'

export function Properties() {
  const user = { id: 'id-origin', name: 'name-origin' }
  const { id } = user
  useEffect(() => {}, [user, user.id, id])
}

