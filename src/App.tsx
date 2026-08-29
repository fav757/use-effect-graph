import { useState } from 'react'
import { QueryInput } from './components/QueryInput'
import { Users } from './components/Users'
import styles from './App.module.css'

function App() {
  const [query, setQuery] = useState('')

  const handleQueryChange = (nextQuery: string) => {
    setQuery(nextQuery)
  }

  return (
    <main className={styles.app}>
      <h1>User search</h1>
      <QueryInput query={query} onQueryChange={handleQueryChange} />
      <Users query={query} />
    </main>
  )
}

export default App
