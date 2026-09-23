import { useEffect, useMemo, useState } from 'react'
import { useActuals, useAssign, useFunctions, useMyScope, usePositions, useRoster, useUnassign } from '../api/hooks'
import { readPersonId } from '../lib/person'
import type { Position, RosterPerson } from '../api/types'
import { num, shortDate } from '../lib/dates'
import Timeline, { TimelineControls, useTimelineControls, type TimelineRow } from '../components/Timeline'
import './PeoplePage.css'

// Same key Staffing uses — the two pages share one "who am I looking at" scope, so switching
// tabs doesn't reset it. See StaffingPage.tsx for the full rationale.
const SCOPE_KEY = 'lsd:scope'
const MINE = '__mine__'
const ALL = '__all__'

/** The people a functional manager owns and what they're named to, on the same shared timeline
 * Staffing uses (see components/Timeline.tsx) — Committed load, what they've actually charged,
 * and capacity as a reference line, so a gap or an overload is visible without asking the
 * Agent. Opens on the manager's OWN function(s), same identity resolution as Staffing, since
 * "everyone" was the exact confusion this fixes: whose people are these, and are the idle ones
 * mine to worry about or someone else's. */
export default function PeoplePage() {
  const personId = readPersonId()
  const { data: myScopeData } = useMyScope(personId)
  const myFunctionNames = useMemo(() => (myScopeData?.functions ?? []).map((f) => f.name), [myScopeData])

  const { data: functionsData } = useFunctions()
  const functions = functionsData?.functions ?? []
  const [storedScope, setStoredScope] = useState(() => {
    try {
      return window.localStorage.getItem(SCOPE_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const scope = storedScope || MINE
  function chooseScope(value: string) {
    setStoredScope(value)
    try {
      window.localStorage.setItem(SCOPE_KEY, value)
    } catch {
      /* not remembered */
    }
  }
  useEffect(() => {
    if (!storedScope && myScopeData && myFunctionNames.length === 0) chooseScope(ALL)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myScopeData])

  const showAll = scope === ALL || (scope === MINE && !!myScopeData && myFunctionNames.length === 0)
  const activeFunctionNames = scope === MINE ? myFunctionNames : scope === ALL ? [] : [scope]
  const activeCategories = useMemo(
    () => new Set(functions.filter((f) => activeFunctionNames.includes(f.name)).flatMap((f) => f.categories)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [functions, activeFunctionNames.join(',')],
  )
  const rosterFunctionParam = activeFunctionNames.length > 0 ? activeFunctionNames.join(',') : undefined

  const { data, isLoading } = useRoster(undefined, rosterFunctionParam)
  const { data: posData } = usePositions()
  const { data: actualsData } = useActuals()
  const unassign = useUnassign()
  const [open, setOpen] = useState<string | null>(null)
  const tc = useTimelineControls()

  const people = data?.people ?? []
  const weeks = data?.weeks ?? []
  const thisWeek = data?.this_week ?? ''

  // Actuals are keyed by employee name, not person id — the same name-matched join this
  // ecosystem already relies on elsewhere (see Org Charts' demo_roster.py).
  const actualsByName = useMemo(() => {
    const m = new Map<string, Record<string, number>>()
    for (const row of actualsData ?? []) {
      const series = m.get(row.employee) ?? {}
      series[row.period_start] = (series[row.period_start] ?? 0) + row.hours
      m.set(row.employee, series)
    }
    return m
  }, [actualsData])

  // Every person's Function has one designated manager (see Org Charts) — not necessarily their
  // own reporting-line manager, which is why this is looked up by function name, not read off
  // the person.
  const functionManagerOf = useMemo(() => {
    const m = new Map<string, string | null>()
    for (const f of functionsData?.functions ?? []) m.set(f.name, f.manager_name)
    return m
  }, [functionsData])

  const groups = useMemo(() => {
    const m = new Map<string, RosterPerson[]>()
    for (const p of people) m.set(p.manager_name ?? 'No manager', [...(m.get(p.manager_name ?? 'No manager') ?? []), p])
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [people])

  const overCount = people.filter((p) => p.over_weeks > 0).length
  const idle = people.filter((p) => Object.keys(p.load).length === 0).length
  const openPerson = open ? people.find((p) => p.id === open) : undefined

  const positions = posData?.positions ?? []
  // Team totals: this scope's whole demand against this scope's whole capacity — moved here
  // from Allocations, since "is my team oversubscribed" is a supply-side question, and supply
  // is what this page is already about. Only meaningful for a bounded scope; "Everyone" mixes
  // capacity pools that were never meant to cover each other. The chart's own coloring (orange/
  // green/red) already says which period, if any, is a problem — no separate banner repeating
  // that in words, and deliberately no opposite "you need more work" alert either; a manager
  // reads the chart and decides, the tool doesn't lecture either direction.
  const teamRow = useMemo(() => {
    if (showAll) return null
    const inScope = positions.filter((p) => activeCategories.has(p.category))
    const plan: Record<string, number> = {}
    for (const p of inScope) {
      for (const [w, h] of Object.entries(p.weeks)) plan[w] = (plan[w] ?? 0) + h
    }
    const capacity: Record<string, number> = {}
    for (const w of weeks) capacity[w] = people.reduce((sum, c) => sum + (c.capacity_hours || 40), 0)
    return { row: { id: 'team', label: 'Team totals', series: { capacity, plan } } as TimelineRow }
  }, [positions, activeCategories, people, weeks, showAll])

  // What this person could be named to instead/in addition — same category, still open. A
  // simple "add" for now: it doesn't also end anything they're already on, so moving someone
  // off an overcommitted slot is still the separate, deliberate unassign below.
  function openPositionsFor(person: RosterPerson) {
    return positions.filter((p) => p.category === person.labor_category && p.unfilled_weeks > 0)
  }

  const headline = showAll ? 'Everyone' : activeFunctionNames.length > 0 ? activeFunctionNames.join(', ') : 'People'

  return (
    <div className="people">
      <div className="people__head">
        <div>
          <h1>{headline}</h1>
          <p>
            {people.length} people · {overCount} over-allocated · {idle} not named to anything yet.
            {!showAll && ' Everyone here is in this scope — nobody from another function.'} Hours are what each person is named
            to, summed across every project.
          </p>
        </div>
        <label className="people__pick">
          <span>Functional Area</span>
          <select value={scope} onChange={(e) => chooseScope(e.target.value)}>
            <option value={MINE}>
              {myFunctionNames.length > 0 ? `My people${myScopeData?.person_name ? ` — ${myScopeData.person_name}` : ''}` : 'My people'}
            </option>
            {(functionsData?.functions ?? []).map((f) => (
              <option key={f.name} value={f.name}>
                {f.name} · {f.manager_name ?? 'unassigned'} ({f.people_count})
              </option>
            ))}
            <option value={ALL}>Everyone</option>
          </select>
        </label>
      </div>
      {scope === MINE && myScopeData && myFunctionNames.length === 0 && (
        <div className="people__banner">
          {myScopeData.person_name
            ? `${myScopeData.person_name} isn't a functional manager on record, so this is everyone.`
            : "Couldn't tell who you are, so this is everyone — pick a function to narrow it."}
        </div>
      )}

      {data?.error && <div className="people__banner">{data.error}</div>}
      {isLoading && <div className="people__empty">Loading…</div>}

      {people.length > 0 && (
        <TimelineControls
          zoom={tc.zoom}
          windowMode={tc.windowMode}
          page={tc.page}
          onZoom={tc.setZoom}
          onWindow={tc.setWindowMode}
          onPrev={tc.prev}
          onNext={tc.next}
          onNow={tc.toNow}
        />
      )}

      {teamRow && (
        <section className="people__group-section people__team-totals">
          <h2 className="people__group-h2">Team totals</h2>
          <Timeline
            rows={[teamRow.row]}
            weeks={weeks}
            thisWeek={thisWeek}
            zoom={tc.zoom}
            windowMode={tc.windowMode}
            page={tc.page}
            seriesKinds={['capacity', 'plan']}
            bandKind="plan"
            bandTitle="Demand, against capacity:"
            bandLabels={{ low: '', mid: 'At capacity', hard: 'Over capacity' }}
            bandLowColor="var(--tl-orange)"
            hideLowBand
          />
        </section>
      )}

      {groups.map(([manager, list]) => {
        const rows: TimelineRow[] = list.map((p) => {
          const capacity: Record<string, number> = {}
          for (const w of weeks) capacity[w] = p.capacity_hours || 40
          const fnManager = p.function ? functionManagerOf.get(p.function) : null
          return {
            id: p.id,
            label: p.name,
            sublabel: `${p.function ?? p.labor_category}${fnManager ? ` · ${fnManager}` : ''}${p.peak_pct ? ` · peak ${p.peak_pct}%` : ''}`,
            series: { committed: p.load, actual: actualsByName.get(p.name), capacity },
          }
        })
        return (
          <section key={manager} className="people__group-section">
            <h2 className="people__group-h2">
              Reports to {manager}
              <span className="people__group-count">{list.length}</span>
            </h2>
            <Timeline
              rows={rows}
              weeks={weeks}
              thisWeek={thisWeek}
              zoom={tc.zoom}
              windowMode={tc.windowMode}
              page={tc.page}
              seriesKinds={['capacity', 'committed', 'actual']}
              bandKind="committed"
              onRowClick={(id) => setOpen(open === id ? null : id)}
            />
          </section>
        )
      })}

      {openPerson && (
        <div className="people__detail-panel">
          <h3>{openPerson.name}</h3>
          {openPerson.assignments.length === 0 ? (
            <span className="people__none">Not named to anything yet.</span>
          ) : (
            <div className="people__assign">
              {openPerson.assignments.map((a) => (
                <span key={a.id} className="chip">
                  {a.project_name} · {a.position_label}
                  {(a.start_date || a.end_date) && (
                    <em>
                      {a.start_date ? shortDate(a.start_date) : ''}–{a.end_date ? shortDate(a.end_date) : ''}
                    </em>
                  )}
                  <button
                    onClick={() => unassign.mutate(a.id)}
                    aria-label={`Remove ${a.position_label}`}
                    title="Take them off this position"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          <PersonReallocate person={openPerson} candidates={openPositionsFor(openPerson)} onAssigned={() => setOpen(openPerson.id)} />
        </div>
      )}
    </div>
  )
}

/** Name this person to a different open position, from their own row — the other half of
 * reallocating someone: unassign (above, the × on an existing chip) plus this. Doesn't also end
 * anything they're already on; deliberately not automatic, since deciding whether to pull them
 * off something else first is exactly the judgment call this page hands to a person, not code. */
function PersonReallocate({
  person,
  candidates,
  onAssigned,
}: {
  person: RosterPerson
  candidates: Position[]
  onAssigned: () => void
}) {
  const assign = useAssign()
  const [message, setMessage] = useState<{ kind: 'warn' | 'error'; text: string } | null>(null)

  if (candidates.length === 0) {
    return <p className="people__none">No open {person.labor_category} positions to name them to right now.</p>
  }

  return (
    <div className="people__reallocate">
      <span className="people__reallocate-label">Name them to something else:</span>
      <select
        value=""
        disabled={assign.isPending}
        onChange={(e) => {
          const pos = candidates.find((p) => p.id === e.target.value)
          if (!pos) return
          setMessage(null)
          assign.mutate(
            { position_id: pos.id, person_id: person.id },
            {
              onSuccess: (a) => {
                onAssigned()
                if (a.overload?.length) {
                  const peak = Math.max(...a.overload.map((o) => o.hours))
                  setMessage({ kind: 'warn', text: `That pushes ${person.name} over capacity in ${a.overload.length} week${a.overload.length === 1 ? '' : 's'} (peak ${num(peak)} h of ${num(person.capacity_hours || 40)}).` })
                }
              },
              onError: (e) => setMessage({ kind: 'error', text: e.message }),
            },
          )
        }}
      >
        <option value="">Open position…</option>
        {candidates.map((p) => (
          <option key={p.id} value={p.id}>
            {p.project_name} · {p.label}
          </option>
        ))}
      </select>
      {message && <div className={`people__msg people__msg--${message.kind}`}>{message.text}</div>}
    </div>
  )
}
