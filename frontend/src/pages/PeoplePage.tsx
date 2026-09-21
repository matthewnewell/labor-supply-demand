import { useMemo, useState } from 'react'
import { useManagers, useRoster, useUnassign } from '../api/hooks'
import type { RosterPerson } from '../api/types'
import { num, shortDate, shortDateYear } from '../lib/dates'
import './PeoplePage.css'

/** Utilization band for a week's named hours against capacity: the same yellow above 1.0 and red
 * above 1.25 that Good Plan uses on a person-line. */
function band(hours: number, capacity: number): string {
  if (hours <= 0) return 'none'
  const r = hours / capacity
  return r > 1.25 + 1e-6 ? 'hard' : r > 1 + 1e-6 ? 'over' : r > 0.6 ? 'mid' : 'low'
}

/** The people a functional manager owns and what they're named to, week by week, across every
 * project. This is the org view (grouped by who they report to) and the over-allocation view (a
 * person's load summed over all their positions) in one. */
export default function PeoplePage() {
  const { data: managersData } = useManagers()
  const [managerId, setManagerId] = useState('')
  const { data, isLoading } = useRoster(managerId || undefined)
  const unassign = useUnassign()
  const [open, setOpen] = useState<string | null>(null)

  const people = data?.people ?? []
  const weeks = data?.weeks ?? []
  const thisWeek = data?.this_week ?? ''

  const groups = useMemo(() => {
    const m = new Map<string, RosterPerson[]>()
    for (const p of people) m.set(p.manager_name ?? 'No manager', [...(m.get(p.manager_name ?? 'No manager') ?? []), p])
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [people])

  const overCount = people.filter((p) => p.over_weeks > 0).length
  const idle = people.filter((p) => Object.keys(p.load).length === 0).length

  return (
    <div className="people">
      <div className="people__head">
        <div>
          <h1>People</h1>
          <p>
            {people.length} people · {overCount} over-allocated · {idle} not named to anything yet. Hours are what each person is
            named to, summed across every project.
          </p>
        </div>
        <label className="people__pick">
          <span>Team</span>
          <select value={managerId} onChange={(e) => setManagerId(e.target.value)}>
            <option value="">Everyone</option>
            {(managersData?.managers ?? []).map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} · {m.team_size} people
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="people__legend">
        <span>Load vs capacity:</span>
        <i className="heat heat--low">≤60%</i>
        <i className="heat heat--mid">≤100%</i>
        <i className="heat heat--over">over 100%</i>
        <i className="heat heat--hard">over 125%</i>
      </div>

      {data?.error && <div className="people__banner">{data.error}</div>}
      {isLoading && <div className="people__empty">Loading…</div>}

      <div className="people__scroll">
        <table className="people__table">
          <thead>
            <tr>
              <th className="people__name">Person</th>
              <th>Peak</th>
              {weeks.map((w, i) => (
                <th key={w} className={`people__wk${w === thisWeek ? ' people__wk--now' : ''}`}>
                  {i % 4 === 0 ? shortDate(w) : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {groups.map(([manager, list]) => (
              <GroupRows
                key={manager}
                manager={manager}
                people={list}
                weeks={weeks}
                thisWeek={thisWeek}
                open={open}
                setOpen={setOpen}
                onRemove={(id) => unassign.mutate(id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function GroupRows({
  manager,
  people,
  weeks,
  thisWeek,
  open,
  setOpen,
  onRemove,
}: {
  manager: string
  people: RosterPerson[]
  weeks: string[]
  thisWeek: string
  open: string | null
  setOpen: (id: string | null) => void
  onRemove: (assignmentId: string) => void
}) {
  return (
    <>
      <tr className="people__group">
        <td colSpan={2 + weeks.length}>
          <span>Reports to {manager}</span>
          <em>{people.length}</em>
        </td>
      </tr>
      {people.map((p) => (
        <PersonRows key={p.id} person={p} weeks={weeks} thisWeek={thisWeek} open={open === p.id} toggle={() => setOpen(open === p.id ? null : p.id)} onRemove={onRemove} />
      ))}
    </>
  )
}

function PersonRows({
  person: p,
  weeks,
  thisWeek,
  open,
  toggle,
  onRemove,
}: {
  person: RosterPerson
  weeks: string[]
  thisWeek: string
  open: boolean
  toggle: () => void
  onRemove: (assignmentId: string) => void
}) {
  const cap = p.capacity_hours || 40
  return (
    <>
      <tr className={`people__row${open ? ' people__row--open' : ''}`} onClick={toggle}>
        <td className="people__name">
          <strong>{p.name}</strong>
          <span>
            {p.labor_category}
            {cap !== 40 ? ` · ${num(cap)} h/wk` : ''}
          </span>
        </td>
        <td className={`people__peak people__peak--${p.peak_pct > 125 ? 'hard' : p.peak_pct > 100 ? 'over' : 'ok'}`}>{p.peak_pct ? `${p.peak_pct}%` : '—'}</td>
        {weeks.map((w) => {
          const h = p.load[w] ?? 0
          return (
            <td key={w} className={`people__cell heat heat--${band(h, cap)}${w === thisWeek ? ' people__cell--now' : ''}`} title={h ? `${shortDateYear(w)} · ${num(h)} h of ${num(cap)}` : undefined}>
              {h ? num(h) : ''}
            </td>
          )
        })}
      </tr>
      {open && (
        <tr className="people__detail">
          <td colSpan={2 + weeks.length}>
            {p.assignments.length === 0 ? (
              <span className="people__none">Not named to anything yet.</span>
            ) : (
              <div className="people__assign">
                {p.assignments.map((a) => (
                  <span key={a.id} className="chip">
                    {a.project_name} · {a.position_label}
                    {(a.start_date || a.end_date) && (
                      <em>
                        {a.start_date ? shortDate(a.start_date) : ''}–{a.end_date ? shortDate(a.end_date) : ''}
                      </em>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        onRemove(a.id)
                      }}
                      aria-label={`Remove ${a.position_label}`}
                      title="Take them off this position"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  )
}
