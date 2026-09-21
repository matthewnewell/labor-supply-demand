import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useFulfillment } from '../api/hooks'
import type { FulfillmentBucket, FulfillmentProject } from '../api/types'
import { num } from '../lib/dates'
import './FulfillmentPage.css'

const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0)
const tone = (p: number, warnBelow = 90, badBelow = 75) => (p >= warnBelow ? 'ok' : p >= badBelow ? 'warn' : 'bad')

/** What each project asked for vs what it got: the hours requested in Good Plan, the hours covered
 * by a named person, and — up to today — the hours actually charged. A project often requests
 * labor and doesn't get all of it; this is where that shows. */
export default function FulfillmentPage() {
  const { data, isLoading } = useFulfillment()
  const projects = data?.projects ?? []

  return (
    <div className="fulfil">
      <div className="fulfil__head">
        <h1>Fulfillment</h1>
        <p>
          Requested is what the project's plan asks for. <strong>Named</strong> is how much of it has a person on it.{' '}
          <strong>Charged</strong> is what people actually booked to the project so far (from the S4 hours on the{' '}
          <Link to="/actuals">Actuals</Link> page).
        </p>
      </div>
      {data?.error && <div className="fulfil__banner">{data.error}</div>}
      {isLoading && <div className="fulfil__empty">Loading…</div>}
      {projects.map((p) => (
        <ProjectCard key={p.depot_project_id} project={p} />
      ))}
    </div>
  )
}

function Bar({ label, value, of, sub, tone: t }: { label: string; value: number; of: number; sub: string; tone: string }) {
  const width = Math.min(100, pct(value, of))
  return (
    <div className="bar">
      <div className="bar__top">
        <span>{label}</span>
        <strong className={`bar__pct bar__pct--${t}`}>{pct(value, of)}%</strong>
      </div>
      <div className="bar__track">
        <div className={`bar__fill bar__fill--${t}`} style={{ width: `${width}%` }} />
      </div>
      <div className="bar__sub">{sub}</div>
    </div>
  )
}

function ProjectCard({ project: p }: { project: FulfillmentProject }) {
  const [open, setOpen] = useState(p.phase !== 'pursuit')
  const named = pct(p.named_hours, p.requested_hours)
  const charged = pct(p.actual_to_date, p.requested_to_date)
  const pursuit = p.phase === 'pursuit'

  return (
    <section className="fcard">
      <div className="fcard__head">
        <div>
          <h2>{p.project_name}</h2>
          <span className={`fcard__phase${pursuit ? ' fcard__phase--pursuit' : ''}`}>{p.phase ?? '—'}</span>
          <span className="fcard__sub">
            {p.positions_filled} of {p.positions} positions fully named
          </span>
        </div>
        <button className="fcard__toggle" onClick={() => setOpen(!open)}>
          {open ? 'Hide categories ▴' : 'By category ▾'}
        </button>
      </div>

      <div className="fcard__bars">
        <Bar
          label="Named vs requested"
          value={p.named_hours}
          of={p.requested_hours}
          sub={`${num(p.named_hours)} of ${num(p.requested_hours)} h have a person on them`}
          tone={pursuit ? 'muted' : tone(named)}
        />
        <Bar
          label="Charged vs requested, to date"
          value={p.actual_to_date}
          of={p.requested_to_date}
          sub={p.requested_to_date > 0 ? `${num(p.actual_to_date)} of ${num(p.requested_to_date)} h asked for so far were worked` : 'Nothing was due yet'}
          tone={p.requested_to_date === 0 ? 'muted' : tone(charged)}
        />
      </div>

      {open && (
        <table className="ftable">
          <thead>
            <tr>
              <th>Labor category</th>
              <th className="num">Positions named</th>
              <th className="num">Requested</th>
              <th className="num">Named</th>
              <th className="num">Named %</th>
              <th className="num">Requested to date</th>
              <th className="num">Charged</th>
              <th className="num">Charged %</th>
            </tr>
          </thead>
          <tbody>
            {p.categories.map((c) => (
              <CategoryRow key={c.category} name={c.category} bucket={c} pursuit={pursuit} />
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

function CategoryRow({ name, bucket: c, pursuit }: { name: string; bucket: FulfillmentBucket; pursuit: boolean }) {
  const named = pct(c.named_hours, c.requested_hours)
  const charged = pct(c.actual_to_date, c.requested_to_date)
  return (
    <tr>
      <td className="ftable__name">{name}</td>
      <td className="num">
        {c.positions_filled}/{c.positions}
      </td>
      <td className="num">{num(c.requested_hours)}</td>
      <td className="num">{num(c.named_hours)}</td>
      <td className={`num ftable__pct ftable__pct--${pursuit ? 'muted' : tone(named)}`}>{named}%</td>
      <td className="num">{num(c.requested_to_date)}</td>
      <td className="num">{num(c.actual_to_date)}</td>
      <td className={`num ftable__pct ftable__pct--${c.requested_to_date === 0 ? 'muted' : tone(charged)}`}>{c.requested_to_date ? `${charged}%` : '—'}</td>
    </tr>
  )
}
