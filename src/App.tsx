import { useState } from 'react'
import './App.css'
import { QueryInput } from './components/QueryInput'
import { Users } from './components/Users'

function App() {
  const [query, setQuery] = useState('')

  const handleQueryChange = (nextQuery: string) => {
    setQuery(nextQuery)
  }

  return (
    <main className="app">
      <h1>User search</h1>
      <QueryInput query={query} onQueryChange={handleQueryChange} />
      <Users query={query} />
    </main>
  )
}

export default App
