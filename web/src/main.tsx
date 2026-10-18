import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
import { boot } from '@/lib/api'
import { setHouseholdTz } from '@/lib/time'
import { App } from './App'
import { BootScreen } from './components/BootScreen'

const root = createRoot(document.getElementById('root')!)
const standalone = location.pathname.startsWith('/c/')

if (standalone) {
  // The aide check-in page needs no household data and no app chrome.
  root.render(
    <StrictMode>
      <App initial={null} />
    </StrictMode>,
  )
} else {
  root.render(<BootScreen />)
  boot().then((initial) => {
    setHouseholdTz(initial.household.timezone)
    root.render(
      <StrictMode>
        <App initial={initial} />
      </StrictMode>,
    )
  })
}
