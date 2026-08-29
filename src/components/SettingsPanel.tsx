import { useEffect, useState } from 'react'
import styles from './SettingsPanel.module.css'

interface SettingsPanelProps {
  theme: 'light' | 'dark'
  pageSize: number
  refreshSeconds: number
  autoRefresh: boolean
  canAutoRefresh: boolean
  onThemeChange: (theme: 'light' | 'dark') => void
  onPageSizeChange: (size: number) => void
  onRefreshSecondsChange: (seconds: number) => void
  onAutoRefreshChange: (enabled: boolean) => void
}

export function SettingsPanel({
  theme,
  pageSize,
  refreshSeconds,
  autoRefresh,
  canAutoRefresh,
  onThemeChange,
  onPageSizeChange,
  onRefreshSecondsChange,
  onAutoRefreshChange,
}: SettingsPanelProps) {
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen])

  return (
    <aside className={styles.settings} data-open={isOpen}>
      <button
        className={styles.toggle}
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        {isOpen ? 'Close settings' : 'Dashboard settings'}
      </button>

      {isOpen && (
        <div className={styles.controls}>
          <label>
            Theme
            <select
              value={theme}
              onChange={(event) =>
                onThemeChange(event.target.value as 'light' | 'dark')
              }
            >
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          <label>
            Results per page
            <select
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
            >
              <option value={3}>3</option>
              <option value={4}>4</option>
              <option value={6}>6</option>
            </select>
          </label>
          <label>
            Refresh interval
            <select
              value={refreshSeconds}
              onChange={(event) =>
                onRefreshSecondsChange(Number(event.target.value))
              }
            >
              <option value={5}>5 seconds</option>
              <option value={10}>10 seconds</option>
              <option value={30}>30 seconds</option>
            </select>
          </label>
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={autoRefresh}
              disabled={!canAutoRefresh}
              onChange={(event) => onAutoRefreshChange(event.target.checked)}
            />
            Auto-refresh activity
          </label>
        </div>
      )}
    </aside>
  )
}
