import { Link } from 'react-router-dom'
import Nav from '../components/Nav'
import './SplashPage.css'

const ROWS = [
  { role: 'Program Manager', demand: 0.25, committed: 0.25 },
  { role: 'Systems Engineer', demand: 1.0, committed: 0.5 },
  { role: 'Machinist', demand: 2.0, committed: 2.0 },
  { role: 'Quality Inspector', demand: 0.5, committed: 0 },
]

const FEATURES = [
  {
    title: 'Named, never just counted',
    body: 'A project asks for a generic resource — a machinist, an engineer. A functional manager answers with a name from the org chart. Headcount alone never counts as covered.',
  },
  {
    title: 'The whole person, across projects',
    body: 'Each person’s load is summed over every position they’re named to and held against their capacity — so a double-booked engineer shows up before it becomes a problem.',
  },
  {
    title: 'Asked for vs. got',
    body: 'Requested hours, hours with a name on them, and hours actually charged sit side by side — so a project that asked for labor and didn’t get it is visible, not assumed.',
  },
]

export default function SplashPage() {
  return (
    <div className="splash-page">
      <Nav />
      <div className="splash-page__scroll">
        <div className="splash-page__content">
          <header className="splash-hero">
            <h1 className="splash-hero__title">Labor Supply &amp; Demand</h1>
            <p className="splash-hero__sub">
              See what every project is asking for, and name the people who fill it — then see
              what each project actually got.
            </p>
            <div className="splash-hero__actions">
              <Link className="lsd-btn lsd-btn--primary" to="/">Open staffing</Link>
            </div>
          </header>

          <figure className="splash-figure">
            <div className="splash-mock">
              <div className="splash-mock__head">
                <span>Role</span>
                <span>Requested</span>
                <span>Named</span>
              </div>
              {ROWS.map((r) => (
                <div className="splash-mock__row" key={r.role}>
                  <span className="splash-mock__role">{r.role}</span>
                  <span className="splash-mock__fte splash-mock__fte--demand">{r.demand} FTE</span>
                  <span className={`splash-mock__fte splash-mock__fte--committed${r.committed === 0 ? ' splash-mock__fte--gap' : ''}`}>
                    {r.committed} FTE
                  </span>
                </div>
              ))}
            </div>
          </figure>

          <div className="splash-grid">
            {FEATURES.map((f) => (
              <div key={f.title} className="splash-card">
                <div className="splash-card__heading">{f.title}</div>
                <p className="splash-card__body">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
