import { useEffect, useState } from 'react'
import { fetchActivity } from '../data/mockApi'
import type { Activity, ActivityKind, User } from '../types'
import styles from './ActivityFeed.module.css'

interface ActivityFeedProps {
  user: User | null
  autoRefresh: boolean
  refreshSeconds: number
}

export function ActivityFeed({
  user,
  autoRefresh,
  refreshSeconds,
}: ActivityFeedProps) {
  const [activity, setActivity] = useState<Activity[]>([])
  const [visibleActivity, setVisibleActivity] = useState<Activity[]>([])
  const [kind, setKind] = useState<ActivityKind | 'all'>('all')
  const [refreshVersion, setRefreshVersion] = useState(0)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    setKind('all')
    setActivity([])
    setLastUpdated(null)
  }, [user?.id])

  useEffect(() => {
    if (!user) return

    const controller = new AbortController()
    setIsLoading(true)

    void fetchActivity(user.id, controller.signal)
      .then((items) => {
        setActivity(items)
        setLastUpdated(new Date())
      })
      .catch((reason: unknown) => {
        if (!(reason instanceof DOMException && reason.name === 'AbortError')) {
          setActivity([])
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoading(false)
      })

    return () => controller.abort()
  }, [user, refreshVersion])

  useEffect(() => {
    setVisibleActivity(
      kind === 'all' ? activity : activity.filter((item) => item.kind === kind),
    )
  }, [activity, kind])

  useEffect(() => {
    if (!autoRefresh || !user) return
    const intervalId = window.setInterval(() => {
      setRefreshVersion((current) => current + 1)
    }, refreshSeconds * 1000)

    return () => window.clearInterval(intervalId)
  }, [autoRefresh, refreshSeconds, user])

  return (
    <section className={styles.panel} aria-labelledby="activity-title">
      <div className={styles.heading}>
        <div>
          <p className={styles.kicker}>Audit trail</p>
          <h2 id="activity-title">Recent activity</h2>
        </div>
        {user && (
          <button
            type="button"
            disabled={isLoading}
            onClick={() => setRefreshVersion((current) => current + 1)}
          >
            Refresh
          </button>
        )}
      </div>

      {!user ? (
        <div className={styles.empty}>
          <span aria-hidden="true">↖</span>
          <p>Select a person to inspect their activity.</p>
        </div>
      ) : (
        <>
          <div className={styles.profile}>
            <div>
              <strong>{user.name}</strong>
              <span>
                {user.role} · {user.team}
              </span>
            </div>
            <select
              aria-label="Activity type"
              value={kind}
              onChange={(event) =>
                setKind(event.target.value as ActivityKind | 'all')
              }
            >
              <option value="all">All events</option>
              <option value="login">Logins</option>
              <option value="profile">Profile</option>
              <option value="security">Security</option>
              <option value="export">Exports</option>
            </select>
          </div>

          {isLoading && activity.length === 0 ? (
            <p className={styles.loading}>Loading activity…</p>
          ) : (
            <ol className={styles.timeline}>
              {visibleActivity.map((item) => (
                <li key={item.id} data-kind={item.kind}>
                  <span aria-hidden="true" />
                  <div>
                    <strong>{item.description}</strong>
                    <time dateTime={item.occurredAt}>
                      {new Date(item.occurredAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                  </div>
                </li>
              ))}
            </ol>
          )}

          <p className={styles.updated}>
            {lastUpdated
              ? `Updated at ${lastUpdated.toLocaleTimeString()}`
              : 'Waiting for activity'}
            {autoRefresh && ` · refreshes every ${refreshSeconds}s`}
          </p>
        </>
      )}
    </section>
  )
}
