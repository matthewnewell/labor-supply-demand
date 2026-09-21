import { useMemo, useState } from 'react'
import { useAssign, useManagers, usePositions, useRoster, useUnassign } from '../api/hooks'
import type { Position, RosterPerson } from '../api/types'
import { num, shortDate, shortDateYear } from '../lib/dates'
import './StaffingPage.css'

const MANAGER_KEY = 'lsd:manager'
type StatusFilter = 'all' | 'open' | 'filled'

/** The functional manager's worklist: every position projects have asked for, and the person named
 * to it. A project asks for a generic resource ("a Machinist"); the manager answers with a NAME,
 * never a headcount. The picker offers only people whose labor category matches, with the
 * manager's own team first, and shows what each pick would do to that person's load. */
export default function StaffingPage() {
  const { data: managersData } = useManagers()
  const [storedManager, setStoredManager] = useState(() => {
    try {
      return window.localStorage.getItem(MANAGER_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const managers = managersData?.managers ?? []
  const managerId = storedManager || managers.find((m) => m.name === 'Alex Chen')?.id || ''
  function chooseManager(id: string) {
    setStoredManager(id)
    try {
      window.localStorage.setItem(MANAGER_KEY, id)
    } catch {
      /* not remembered */
    }
  }

  const { data: posData, isLoading } = usePositions()
  const { data: everyone } = useRoster()
  const { data: team } = useRoster(managerId || undefined)
  const teamIds = useMemo(() => new Set(managerId ? (team?.people ?? []).map((p) => p.id) : []), [team, managerId])

  const [project, setProject] = useState('')
  const [status, setStatus] = useState<StatusFilter>('open')
  const positions = posData?.positions ?? []
  const projects = [...new Set(positions.map((p) => p.project_name))].sort()

  const shown = positions.filter(
    (p) =>
      (!project || p.project_name === project) &&
      (status === 'all' || (status === 'open' ? p.unfilled_weeks > 0 : p.unfilled_weeks === 0)),
  )
  const grouped = useMemo(() => {
    const m = new Map<string, Position[]>()
    for (const p of shown) m.set(p.project_name, [...(m.get(p.project_name) ?? []), p])
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [shown])

  const totalOpen = positions.filter((p) => p.unfilled_weeks > 0).length

  return (
    <div className="staffing">
      <div className="staffing__head">
        <div>
          <h1>Staffing</h1>
          <p>
            Projects asked for these positions. Name a person to each — {totalOpen} of {positions.length} still have open weeks.
          </p>
        </div>
        <div className="staffing__controls">
          <label>
            <span>Staffing as</span>
            <select value={managerId} onChange={(e) => chooseManager(e.target.value)}>
              <option value="">Anyone</option>
              {managers.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name} · {m.team_size} people
                </option>
              ))}
            </select>
          </label>
          <label>
            <span>Project</span>
            <select value={project} onChange={(e) => setProject(e.target.value)}>
              <option value="">All projects</option>
              {projects.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
          <span className="staffing__seg">
            {(['open', 'all', 'filled'] as StatusFilter[]).map((s) => (
              <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>
                {s === 'open' ? 'Open' : s === 'all' ? 'All' : 'Filled'}
              </button>
            ))}
          </span>
        </div>
      </div>

      {(posData?.error || everyone?.error) && <div className="staffing__banner">{posData?.error ?? everyone?.error}</div>}
      {isLoading && <div className="staffing__empty">Loading…</div>}
      {!isLoading && grouped.length === 0 && <div className="staffing__empty">Nothing to show for this filter.</div>}

      {grouped.map(([name, list]) => {
        const filled = positions.filter((p) => p.project_name === name && p.unfilled_weeks === 0).length
        const total = positions.filter((p) => p.project_name === name).length
        return (
          <section key={name} className="staffing__project">
            <h2>
              {name}
              <span className="staffing__count">
                {filled}/{total} fully named
              </span>
            </h2>
            {list.map((p) => (
              <PositionRow
                key={p.id}
                position={p}
                weeks={posData?.weeks ?? []}
                thisWeek={posData?.this_week ?? ''}
                candidates={(everyone?.people ?? []).filter((c) => c.labor_category === p.category)}
                teamIds={teamIds}
                hasTeam={!!managerId}
              />
            ))}
          </section>
        )
      })}
    </div>
  )
}

function PositionRow({
  position: p,
  weeks,
  thisWeek,
  candidates,
  teamIds,
  hasTeam,
}: {
  position: Position
  weeks: string[]
  thisWeek: string
  candidates: RosterPerson[]
  teamIds: Set<string>
  hasTeam: boolean
}) {
  const assign = useAssign()
  const unassign = useUnassign()
  const [message, setMessage] = useState<{ kind: 'warn' | 'error'; text: string } | null>(null)

  // What naming this person would do to their load across the weeks of THIS position.
  const peakIfNamed = (c: RosterPerson) => {
    const cap = c.capacity_hours || 40
    const peak = Math.max(...Object.entries(p.weeks).map(([w, h]) => (c.load[w] ?? 0) + h))
    return Math.round((peak / cap) * 100)
  }
  const ordered = [...candidates].sort(
    (a, b) => Number(!teamIds.has(a.id)) - Number(!teamIds.has(b.id)) || peakIfNamed(a) - peakIfNamed(b) || a.name.localeCompare(b.name),
  )
  const openWeeks = Object.keys(p.cover).filter((w) => !p.cover[w]).sort()

  function name(person: RosterPerson) {
    setMessage(null)
    // A position that is partly covered is completed from its first open week on.
    const partly = p.assignments.length > 0 && openWeeks.length > 0
    assign.mutate(
      { position_id: p.id, person_id: person.id, ...(partly ? { start_date: openWeeks[0] } : {}) },
      {
        onSuccess: (a) => {
          if (a.overload?.length) {
            const peak = Math.max(...a.overload.map((o) => o.hours))
            setMessage({ kind: 'warn', text: `${person.name} is now over capacity in ${a.overload.length} week${a.overload.length === 1 ? '' : 's'} (peak ${num(peak)} h of ${num(person.capacity_hours || 40)}).` })
          }
        },
        onError: (e) => setMessage({ kind: 'error', text: e.message }),
      },
    )
  }

  const status = p.unfilled_weeks === 0 ? 'filled' : p.assignments.length === 0 ? 'open' : 'partial'
  return (
    <div className={`pos pos--${status}`}>
      <div className="pos__label">
        <strong>{p.label}</strong>
        <span>
          {p.wbs ? `WBS ${p.wbs} · ` : ''}
          {shortDate(p.first_week)} – {shortDate(p.last_week)} · {num(p.total_hours)} h
        </span>
      </div>

      <div className="strip" aria-hidden="true">
        {weeks.map((w) => {
          const h = p.weeks[w]
          if (!h) return <span key={w} className={`strip__cell${w === thisWeek ? ' strip__cell--now' : ''}`} />
          const named = !!p.cover[w]
          return (
            <span
              key={w}
              className={`strip__cell strip__cell--bar ${named ? 'strip__cell--named' : 'strip__cell--open'}${w === thisWeek ? ' strip__cell--now' : ''}`}
              style={{ height: Math.max(4, Math.min(h / 40, 1) * 24) }}
              title={`${shortDateYear(w)} · ${num(h)} h · ${p.cover[w] ?? 'nobody named'}`}
            />
          )
        })}
      </div>

      <div className="pos__status">
        <span className={`pill pill--${status}`}>{status === 'filled' ? 'Named' : status === 'open' ? 'Open' : `${Math.round(p.fill_pct)}% named`}</span>
        {p.unfilled_now_or_past > 0 && <span className="pos__flag">{p.unfilled_now_or_past} wk underway, nobody named</span>}
      </div>

      <div className="pos__names">
        {p.assignments.map((a) => (
          <span key={a.id} className="chip">
            {a.person_name}
            {(a.start_date || a.end_date) && (
              <em>
                {a.start_date ? shortDate(a.start_date) : ''}–{a.end_date ? shortDate(a.end_date) : ''}
              </em>
            )}
            <button onClick={() => unassign.mutate(a.id)} title="Remove from this position" aria-label={`Remove ${a.person_name}`}>
              ×
            </button>
          </span>
        ))}
      </div>

      <div className="pos__assign">
        {(status !== 'filled') && (
          <select
            value=""
            disabled={assign.isPending}
            onChange={(e) => {
              const person = candidates.find((c) => c.id === e.target.value)
              if (person) name(person)
            }}
          >
            <option value="">{ordered.length ? 'Name someone…' : `No ${p.category}s on the roster`}</option>
            {ordered.map((c) => {
              const pct = peakIfNamed(c)
              return (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {hasTeam && !teamIds.has(c.id) ? ' (other team)' : ''} — peak {pct}%{pct > 100 ? ' ⚠' : ''}
                </option>
              )
            })}
          </select>
        )}
      </div>

      {message && <div className={`pos__msg pos__msg--${message.kind}`}>{message.text}</div>}
    </div>
  )
}
