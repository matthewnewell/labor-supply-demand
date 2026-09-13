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
    title: 'Demand, read live',
    body: 'A project’s labor demand lives in Good Plan, not here. This app reads it live and never keeps its own copy — nothing to fall out of sync.',
  },
  {
    title: 'Committed, not just counted',
    body: 'A commitment can name a real person, or just reserve headcount on a shift until someone’s named to it. Both are honest states — neither pretends to be the other.',
  },
  {
    title: 'No fake precision',
    body: 'Demand and commitment lines sit side by side, by role — not summed into one coverage percentage that would claim more certainty than either side actually has.',
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
              See what every project is asking for, and commit real people or headcount against
              it — side by side, role by role.
            </p>
            <div className="splash-hero__actions">
              <Link className="lsd-btn lsd-btn--primary" to="/">Open the board</Link>
            </div>
          </header>

          <figure className="splash-figure">
            <div className="splash-mock">
              <div className="splash-mock__head">
                <span>Role</span>
                <span>Demand</span>
                <span>Committed</span>
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
