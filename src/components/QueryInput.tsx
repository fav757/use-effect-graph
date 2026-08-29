import type { ChangeEvent } from 'react'

interface QueryInputProps {
  query: string
  onQueryChange: (query: string) => void
}

export function QueryInput({ query, onQueryChange }: QueryInputProps) {
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    onQueryChange(event.target.value)
  }

  return (
    <label className="query-input">
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
