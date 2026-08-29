import type { ChangeEvent } from 'react'
import styles from './QueryInput.module.css'

interface QueryInputProps {
  query: string
  onQueryChange: (query: string) => void
}

export function QueryInput({ query, onQueryChange }: QueryInputProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onQueryChange(event.target.value)
  }

  return (
    <label className={styles.queryInput}>
      Search users
      <input
        type="search"
        value={query}
        onChange={handleChange}
        placeholder="Enter a name"
      />
    </label>
  )
}
