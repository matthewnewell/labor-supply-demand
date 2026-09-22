import { NavLink } from 'react-router-dom'
import { useMyScope } from '../api/hooks'
import { readPersonId } from '../lib/person'
import './Nav.css'

/** Who the Launchpad says you are, and what that means here — every other app in the ecosystem
 * shows this top-right (Depot's own persona switcher); LSD never did, which left "whose seat am
 * I in" answered only by which Function happened to be selected. Read-only here (LSD has no
 * persona switcher of its own — see lib/person.ts), so it's a plain badge, not a dropdown. */
function WhoAmI() {
  const personId = readPersonId()
  const { data } = useMyScope(personId)
  if (!personId || !data?.person_name) return null
  const functionNames = data.functions.map((f) => f.name)
  return (
    <div className="lsd-nav__whoami" title={personId}>
      <span className="lsd-nav__whoami-avatar">{data.person_name.charAt(0)}</span>
      <span className="lsd-nav__whoami-text">
        <strong>{data.person_name}</strong>
        <em>{functionNames.length > 0 ? functionNames.join(', ') : 'Not a functional manager'}</em>
      </span>
    </div>
  )
}

export default function Nav() {
  return (
    <nav className="lsd-nav">
      <NavLink to="/about" className="lsd-nav__brand">
        Labor Supply &amp; Demand
      </NavLink>
      <div className="lsd-nav__links">
        <NavLink
          to="/people"
          className={({ isActive }) => `lsd-nav__link ${isActive ? 'lsd-nav__link--active' : ''}`}
        >
          People
        </NavLink>
        <NavLink
          to="/" end
          className={({ isActive }) => `lsd-nav__link ${isActive ? 'lsd-nav__link--active' : ''}`}
        >
          Allocations
        </NavLink>
        <NavLink
          to="/fulfillment"
          className={({ isActive }) => `lsd-nav__link ${isActive ? 'lsd-nav__link--active' : ''}`}
        >
          Fulfillment
        </NavLink>
      </div>
      <WhoAmI />
    </nav>
  )
}
