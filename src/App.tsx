import { useEffect, useState } from 'react'
import { ActivityFeed } from './components/ActivityFeed'
import { QueryInput } from './components/QueryInput'
import { SettingsPanel } from './components/SettingsPanel'
import { Users } from './components/Users'
import { useOnlineStatus } from './hooks/useOnlineStatus'
import { usePersistentState } from './hooks/usePersistentState'
import type { User, UserStatus } from './types'
import styles from './App.module.css'

function App() {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<UserStatus | 'all'>('all')
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [pageSize, setPageSize] = usePersistentState('dashboard-page-size', 4)
  const [theme, setTheme] = usePersistentState<'light' | 'dark'>(
    'dashboard-theme',
    'light',
  )
  const [refreshSeconds, setRefreshSeconds] = usePersistentState(
    'dashboard-refresh-seconds',
    10,
  )
  const [autoRefresh, setAutoRefresh] = useState(true)
  const isOnline = useOnlineStatus()

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    const subject = selectedUser ? selectedUser.name : 'User search'
    document.title = query ? `${subject} · ${query}` : `${subject} · Dashboard`
  }, [query, selectedUser])

  useEffect(() => {
    if (!isOnline) {
      setAutoRefresh(false)
    }
  }, [isOnline])

  const handleQueryChange = (nextQuery: string) => {
    setQuery(nextQuery)
  }

  return (
    <main className={styles.app}>
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>Operations workspace</p>
          <h1>User activity dashboard</h1>
          <p className={styles.subtitle}>
            Search the directory and inspect recent account events.
          </p>
        </div>
        <div className={styles.connection} data-online={isOnline}>
          <span aria-hidden="true" />
          {isOnline ? 'Online' : 'Offline'}
        </div>
      </header>

      <section className={styles.toolbar} aria-label="Directory filters">
        <QueryInput query={query} onQueryChange={handleQueryChange} />
        <label>
          Account status
          <select
            value={status}
            onChange={(event) =>
              setStatus(event.target.value as UserStatus | 'all')
            }
          >
            <option value="all">All accounts</option>
            <option value="active">Active</option>
            <option value="invited">Invited</option>
            <option value="suspended">Suspended</option>
          </select>
        </label>
      </section>

      <div className={styles.layout}>
        <Users
          query={query}
          status={status}
          pageSize={pageSize}
          selectedUserId={selectedUser?.id ?? null}
          onSelectUser={setSelectedUser}
        />
        <ActivityFeed
          user={selectedUser}
          autoRefresh={autoRefresh && isOnline}
          refreshSeconds={refreshSeconds}
        />
      </div>

      <SettingsPanel
        theme={theme}
        pageSize={pageSize}
        refreshSeconds={refreshSeconds}
        autoRefresh={autoRefresh}
        canAutoRefresh={isOnline}
        onThemeChange={setTheme}
        onPageSizeChange={setPageSize}
        onRefreshSecondsChange={setRefreshSeconds}
        onAutoRefreshChange={setAutoRefresh}
      />
    </main>
  )
}

export default App
