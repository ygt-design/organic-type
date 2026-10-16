import { useEffect, useState } from 'react'
import Exploration from './features/exploration/Exploration.jsx'

// Old links used `#exploration/<mode>`; strip that prefix so they still open the
// right mode (Exploration then rewrites the URL to the short form).
const viewFromHash = (hash) => hash.replace(/^#(exploration\/?)?/, '')

function App() {
  const [view, setView] = useState(() => viewFromHash(window.location.hash))

  useEffect(() => {
    const onHashChange = () => setView(viewFromHash(window.location.hash))
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  return (
    <main>
      <Exploration view={view} />
    </main>
  )
}

export default App
