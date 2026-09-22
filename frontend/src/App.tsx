import { DepotBackBar, DrawerLayout } from '@conways/drawer'
import { Route, Routes } from 'react-router-dom'
import { useHealth, usePositions } from './api/hooks'
import Nav from './components/Nav'
import { readPersonId } from './lib/person'
import FulfillmentPage from './pages/FulfillmentPage'
import PeoplePage from './pages/PeoplePage'
import SplashPage from './pages/SplashPage'
import StaffingPage from './pages/StaffingPage'
import './App.css'

const DEPOT_URL = 'http://localhost:8090'

/** Shared chrome for every operational page, inside the ecosystem's shared Agent | Journal drawer
 * (@conways/drawer). The Agent is this app's own: it reads the whole staffing picture (open
 * positions, over-allocated people, who has room) and suggests names. The Journal is person-scoped
 * — it opens on the person's own notes, with a picker for any project. */
function Layout({ children }: { children: React.ReactNode }) {
  const { data: health } = useHealth()
  const { data: positions } = usePositions()
  const personId = readPersonId()

  // Projects for the Journal's picker: every project that has asked for labor.
  const projects = [
    ...new Map(
      (positions?.positions ?? []).map((p) => [p.depot_project_id, { id: p.depot_project_id, name: p.project_name }]),
    ).values(),
  ].sort((a, b) => a.name.localeCompare(b.name))

  return (
    <div className="app-layout">
      <Nav />
      <DrawerLayout
        storageKey="lsd:drawer"
        scrollMain={false}
        agent={{
          chatUrl: '/api/chat',
          aiConfigured: health?.ai_configured ?? false,
          intro: 'Ask about staffing — who is over-allocated, which positions are still open, who has room for one.',
          starters: [
            'Which open positions are most urgent?',
            'Who is over-allocated, and by how much?',
            'Who could fill the open Radar machinist positions?',
          ],
        }}
        journal={{ depotUrl: DEPOT_URL, personId, projects }}
      >
        <div className="app-layout__body">{children}</div>
      </DrawerLayout>
    </div>
  )
}

export default function App() {
  return (
    <>
      <DepotBackBar />
      <Routes>
        <Route path="/about" element={<SplashPage />} />
        <Route path="/" element={<Layout><StaffingPage /></Layout>} />
        <Route path="/people" element={<Layout><PeoplePage /></Layout>} />
        <Route path="/fulfillment" element={<Layout><FulfillmentPage /></Layout>} />
      </Routes>
    </>
  )
}
