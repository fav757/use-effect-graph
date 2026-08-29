import { useEffect, useState } from 'react'
import { fetchUsers } from '../data/mockApi'
import { useDebouncedValue } from '../hooks/useDebouncedValue'
import type { User, UserStatus } from '../types'
import styles from './Users.module.css'

interface UsersProps {
  query: string
  status: UserStatus | 'all'
  pageSize: number
  selectedUserId: number | null
  onSelectUser: (user: User) => void
}

export function Users({
  query,
  status,
  pageSize,
  selectedUserId,
  onSelectUser,
}: UsersProps) {
  const debouncedQuery = useDebouncedValue(query, 300)
  const [users, setUsers] = useState<User[]>([])
  const [page, setPage] = useState(1)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setPage(1)
  }, [debouncedQuery, status, pageSize])

  useEffect(() => {
    const controller = new AbortController()
    setIsLoading(true)
    setError(null)

    void fetchUsers(debouncedQuery, status, controller.signal)
      .then(setUsers)
      .catch((reason: unknown) => {
        if (reason instanceof DOMException && reason.name === 'AbortError')
          return
        setError('The directory could not be loaded.')
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false)
      })

    return () => controller.abort()
  }, [debouncedQuery, status])

  const pageCount = Math.max(1, Math.ceil(users.length / pageSize))
  const visibleUsers = users.slice((page - 1) * pageSize, page * pageSize)

  return (
    <section className={styles.directory} aria-labelledby="directory-title">
      <div className={styles.heading}>
        <div>
          <p className={styles.kicker}>Directory</p>
          <h2 id="directory-title">People</h2>
        </div>
        <span>{isLoading ? 'Loading…' : `${users.length} results`}</span>
      </div>

      {error && <p className={styles.message}>{error}</p>}
      {!error && !isLoading && users.length === 0 && (
        <p className={styles.message}>No users match these filters.</p>
      )}

      <div className={styles.list} aria-busy={isLoading}>
        {visibleUsers.map((user) => (
          <button
            className={styles.user}
            data-selected={selectedUserId === user.id}
            key={user.id}
            type="button"
            onClick={() => onSelectUser(user)}
          >
            <span className={styles.avatar} aria-hidden="true">
              {user.name
                .split(' ')
                .map((part) => part[0])
                .join('')}
            </span>
            <span className={styles.identity}>
              <strong>{user.name}</strong>
              <small>{user.email}</small>
            </span>
            <span className={styles.metadata}>
              <small>{user.team}</small>
              <span data-status={user.status}>{user.status}</span>
            </span>
          </button>
        ))}
      </div>

      <footer className={styles.pagination}>
        <button
          type="button"
          disabled={page === 1}
          onClick={() => setPage((current) => current - 1)}
        >
          Previous
        </button>
        <span>
          Page {page} of {pageCount}
        </span>
        <button
          type="button"
          disabled={page === pageCount}
          onClick={() => setPage((current) => current + 1)}
        >
          Next
        </button>
      </footer>
    </section>
  )
}
