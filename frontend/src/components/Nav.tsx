import { AppHeader, tabClass } from '@conways/drawer'
import { NavLink } from 'react-router-dom'

/** The ecosystem's shared header (@conways/drawer's AppHeader): back to where you came from in
 * Conway's Depot, the app and its tabs, and the "viewing as" user menu. The Outlook has no tab
 * of its own: it's the app's home, reached through the brand. */
export default function Nav() {
  return (
    <AppHeader
      brand={
        <NavLink to="/" className="ch-brand">
          Labor Supply &amp; Demand
        </NavLink>
      }
    >
      <NavLink to="/people" className={({ isActive }) => tabClass(isActive)}>
        People
      </NavLink>
      <NavLink to="/allocations" className={({ isActive }) => tabClass(isActive)}>
        Allocations
      </NavLink>
      <NavLink to="/fulfillment" className={({ isActive }) => tabClass(isActive)}>
        Fulfillment
      </NavLink>
    </AppHeader>
  )
}
