import { useEffect } from 'react'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import styles from './Users.module.css'

interface UsersProps {
  query: string
}

function fetchUsers(query: string): Promise<void> {
  console.log(`Fetching users for query: ${query}`)
  return Promise.resolve()
}

export function Users({ query }: UsersProps) {
  const debouncedQuery = useDebouncedValue(query, 300)

  useEffect(() => {
    void fetchUsers(debouncedQuery)
  }, [debouncedQuery])

  return (
    <p className={styles.usersStatus}>
      Current debounced query: {debouncedQuery || 'None'}
    </p>
  )
}
