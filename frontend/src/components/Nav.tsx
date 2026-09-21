import { NavLink } from 'react-router-dom'
import './Nav.css'

export default function Nav() {
  return (
    <nav className="lsd-nav">
      <NavLink to="/about" className="lsd-nav__brand">
        Labor Supply &amp; Demand
      </NavLink>
      <div className="lsd-nav__links">
        <NavLink
          to="/" end
          className={({ isActive }) => `lsd-nav__link ${isActive ? 'lsd-nav__link--active' : ''}`}
        >
          Staffing
        </NavLink>
        <NavLink
          to="/people"
          className={({ isActive }) => `lsd-nav__link ${isActive ? 'lsd-nav__link--active' : ''}`}
        >
          People
        </NavLink>
        <NavLink
          to="/fulfillment"
          className={({ isActive }) => `lsd-nav__link ${isActive ? 'lsd-nav__link--active' : ''}`}
        >
          Fulfillment
        </NavLink>
        <NavLink
          to="/actuals"
          className={({ isActive }) => `lsd-nav__link ${isActive ? 'lsd-nav__link--active' : ''}`}
        >
          Actuals
        </NavLink>
      </div>
    </nav>
  )
}
