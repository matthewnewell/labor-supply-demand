import { useEffect, useMemo, useRef, useState } from 'react'
import { useActuals, useAssign, useFunctions, useMyScope, usePositions, useRoster, useSuggest, useUnassign } from '../api/hooks'
import { readPersonId } from '../lib/person'
import type { Position, RosterPerson } from '../api/types'
import { num, shortDateYear } from '../lib/dates'
import Timeline, { TimelineControls, useTimelineControls, type TimelineRow } from '../components/Timeline'
import './StaffingPage.css'

const SCOPE_KEY = 'lsd:scope'
// "My people" — whichever Function(s) the launching person manages, resolved server-side from
// the Depot person_id. "All functions" is a deliberate, explicit opt-in to the wide view — the
// default for a manager should never be the whole company's open positions (see PositionRow's
// own note on why: a project asks for a category, not a person, and a manager only ever answers
// for their own).
const MINE = '__mine__'
const ALL = '__all__'
type StatusFilter = 'all' | 'open' | 'filled'

/** The functional manager's worklist: every position projects have asked for, and the person named
 * to it. A project asks for a generic resource ("a Machinist"); the manager answers with a NAME,
 * never a headcount. Opens on the manager's OWN function(s) — not the whole company's open
 * positions — with an explicit "All functions" to browse wider. The assign picker is never
 * further restricted beyond that: a position's category already limits who can fill it to people
 * in that same category, company-wide, which is the correct pool regardless of who's viewing. */
export default function StaffingPage() {
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
  // If "my people" resolves to nobody (not a functional manager on record, or identity didn't
  // resolve) once we actually know that, fall back to the wide view rather than an empty page —
  // but only as a one-time default, never overriding a scope the person picked themselves.
  useEffect(() => {
    if (!storedScope && myScopeData && myFunctionNames.length === 0) chooseScope(ALL)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myScopeData])

  const showAll = scope === ALL || (scope === MINE && !!myScopeData && myFunctionNames.length === 0)
  const activeFunctionNames = scope === MINE ? myFunctionNames : scope === ALL ? [] : [scope]
  const activeFunctions = functions.filter((f) => activeFunctionNames.includes(f.name))
  const activeCategories = new Set(activeFunctions.flatMap((f) => f.categories))
  const rosterFunctionParam = activeFunctionNames.length > 0 ? activeFunctionNames.join(',') : undefined

  const { data: posData, isLoading } = usePositions()
  const { data: everyone } = useRoster()
  const { data: team } = useRoster(undefined, rosterFunctionParam)
  const teamIds = useMemo(() => new Set(rosterFunctionParam ? (team?.people ?? []).map((p) => p.id) : []), [team, rosterFunctionParam])
  const { data: actualsData } = useActuals()
  // Actuals have no position_id — they're rolled up by (project, category, week) instead, which
  // is exactly the grain a position's own demand is at, so the two line up on the timeline.
  const actualsByKey = useMemo(() => {
    const m = new Map<string, Record<string, number>>()
    for (const row of actualsData ?? []) {
      const key = `${row.project}|${row.role ?? ''}`
      const series = m.get(key) ?? {}
      series[row.period_start] = (series[row.period_start] ?? 0) + row.hours
      m.set(key, series)
    }
    return m
  }, [actualsData])
  const tc = useTimelineControls()

  const [project, setProject] = useState('')
  const [status, setStatus] = useState<StatusFilter>('all')
  const positions = posData?.positions ?? []
  const inScope = useMemo(
    () => (showAll ? positions : positions.filter((p) => activeCategories.has(p.category))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [positions, showAll, activeFunctionNames.join(',')],
  )
  const projects = [...new Set(inScope.map((p) => p.project_name))].sort()

  const shown = inScope.filter(
    (p) =>
      (!project || p.project_name === project) &&
      (status === 'all' || (status === 'open' ? p.unfilled_weeks > 0 : p.unfilled_weeks === 0)),
  )
  const grouped = useMemo(() => {
    const m = new Map<string, Position[]>()
    for (const p of shown) m.set(p.project_name, [...(m.get(p.project_name) ?? []), p])
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [shown])

  const totalOpen = inScope.filter((p) => p.unfilled_weeks > 0).length

  const personById = useMemo(() => new Map((everyone?.people ?? []).map((c) => [c.id, c])), [everyone])

  // A position's own committed hours don't say whether the PERSON behind them is stretched thin
  // — that depends on everything else they're on. Flags the weeks where they're over capacity,
  // so "Bob is only overcommitted in February" shows up right on his row, not just in People.
  function overcommitFlags(p: Position): Record<string, string> {
    const flags: Record<string, string> = {}
    for (const a of p.assignments) {
      const person = personById.get(a.person_id)
      if (!person) continue
      const cap = person.capacity_hours || 40
      for (const w of Object.keys(p.weeks)) {
        if ((person.load[w] ?? 0) > cap) flags[w] = `${person.name} is over capacity this week`
      }
    }
    return flags
  }

  const headline = showAll
    ? 'All functions'
    : activeFunctions.length === 1
      ? activeFunctions[0].name
      : activeFunctions.length > 1
        ? `${myScopeData?.person_name ?? 'My'}'s teams`
        : 'Staffing'
  const headlineSub = showAll
    ? `${inScope.length} position${inScope.length === 1 ? '' : 's'} across every function`
    : activeFunctions.length > 0
      ? activeFunctions.length === 1
        ? `${activeFunctions[0].manager_name ? `${activeFunctions[0].manager_name} · ` : ''}${activeFunctions[0].people_count} ${activeFunctions[0].people_count === 1 ? 'person' : 'people'}`
        : `${activeFunctions.map((f) => f.name).join(', ')} · ${activeFunctions.reduce((n, f) => n + f.people_count, 0)} people`
      : undefined

  return (
    <div className="staffing">
      <div className="staffing__head">
        <div>
          <h1>
            {headline}
            {headlineSub && <span className="staffing__subtitle">{headlineSub}</span>}
          </h1>
          <p>
            Projects asked for these positions. Name a person to each — {totalOpen} of {inScope.length} still have open weeks.
          </p>
        </div>
        <div className="staffing__controls">
          <label>
            <span>Scope</span>
            <select value={scope} onChange={(e) => chooseScope(e.target.value)}>
              <option value={MINE}>
                {myFunctionNames.length > 0
                  ? `My people${myScopeData?.person_name ? ` — ${myScopeData.person_name}` : ''}`
                  : 'My people'}
              </option>
              {functions.map((f) => (
                <option key={f.name} value={f.name}>
                  {f.name} — {f.manager_name ?? 'unassigned'} ({f.people_count})
                </option>
              ))}
              <option value={ALL}>All functions</option>
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
            {(['all', 'open', 'filled'] as StatusFilter[]).map((s) => (
              <button key={s} className={status === s ? 'on' : ''} onClick={() => setStatus(s)}>
                {s === 'open' ? 'Open' : s === 'all' ? 'All' : 'Filled'}
              </button>
            ))}
          </span>
        </div>
      </div>
      {scope === MINE && myScopeData && myFunctionNames.length === 0 && (
        <div className="staffing__banner">
          {myScopeData.person_name
            ? `${myScopeData.person_name} isn't a functional manager on record, so this is everything.`
            : "Couldn't tell who you are, so this is everything — pick a function to narrow it."}
        </div>
      )}

      {(posData?.error || everyone?.error) && <div className="staffing__banner">{posData?.error ?? everyone?.error}</div>}
      {isLoading && <div className="staffing__empty">Loading…</div>}
      {!isLoading && grouped.length === 0 && <div className="staffing__empty">Nothing to show for this filter.</div>}

      {grouped.length > 0 && (
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

      {grouped.map(([name, list]) => {
        const filled = inScope.filter((p) => p.project_name === name && p.unfilled_weeks === 0).length
        const total = inScope.filter((p) => p.project_name === name).length
        const timelineRows: TimelineRow[] = list.map((p) => {
          const committed: Record<string, number> = {}
          for (const [w, h] of Object.entries(p.weeks)) if (p.cover[w]) committed[w] = h
          // Once someone's named, the row is about them doing the role, not the abstract slot.
          const names = [...new Set(p.assignments.map((a) => a.person_name))]
          return {
            id: p.id,
            label: names.length > 0 ? `${names.join(' & ')}, ${p.label}` : p.label,
            sublabel: p.wbs ? `WBS ${p.wbs}` : undefined,
            series: { plan: p.weeks, committed, actual: actualsByKey.get(`${p.project_name}|${p.category}`) },
            flags: overcommitFlags(p),
            labelExtra: (
              <PositionStatusButton
                position={p}
                candidates={(everyone?.people ?? []).filter((c) => c.labor_category === p.category)}
                teamIds={teamIds}
                hasTeam={!showAll}
              />
            ),
          }
        })
        return (
          <section key={name} className="staffing__project">
            <h2>
              {name}
              <span className="staffing__count">
                {filled}/{total} fully named
              </span>
            </h2>
            <Timeline
              rows={timelineRows}
              weeks={posData?.weeks ?? []}
              thisWeek={posData?.this_week ?? ''}
              zoom={tc.zoom}
              windowMode={tc.windowMode}
              page={tc.page}
              seriesKinds={['plan', 'committed', 'actual']}
            />
          </section>
        )
      })}
    </div>
  )
}

/** The whole "do something about this position" surface, collapsed to one button that sits in
 * the row's own label cell — Name, Remove, and Suggest a fit all live in the popover it opens,
 * instead of a permanent column eating into the timeline's width. */
function PositionStatusButton({
  position: p,
  candidates,
  teamIds,
  hasTeam,
}: {
  position: Position
  candidates: RosterPerson[]
  teamIds: Set<string>
  hasTeam: boolean
}) {
  const assign = useAssign()
  const unassign = useUnassign()
  const suggest = useSuggest()
  const [open, setOpen] = useState(false)
  const [message, setMessage] = useState<{ kind: 'warn' | 'error'; text: string } | null>(null)
  const [suggestion, setSuggestion] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [open])

  // Two different numbers, shown as both so neither reads as the other: what they're at right
  // now (today's real committed load, nothing to do with this position), and what naming them
  // here would push their worst overlapping week to. "Peak" alone was ambiguous about which.
  const cap = (c: RosterPerson) => c.capacity_hours || 40
  const currentPct = (c: RosterPerson) => Math.round((Math.max(0, ...Object.values(c.load)) / cap(c)) * 100)
  const peakIfNamed = (c: RosterPerson) => {
    const peak = Math.max(...Object.entries(p.weeks).map(([w, h]) => (c.load[w] ?? 0) + h))
    return Math.round((peak / cap(c)) * 100)
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
    <div className="pos-status" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button type="button" className={`pill pill--${status} pos-status__trigger`} onClick={() => setOpen((o) => !o)}>
        {status === 'filled' ? 'Named' : status === 'open' ? 'Open' : `${Math.round(p.fill_pct)}%`}
        {p.unfilled_now_or_past > 0 && ' ⚠'}
      </button>

      {open && (
        <div className="pos-popover">
          {p.unfilled_now_or_past > 0 && <div className="pos__flag">{p.unfilled_now_or_past} wk underway, nobody named</div>}

          {p.assignments.length > 0 && (
            <div className="pos__names">
              {p.assignments.map((a) => (
                <span key={a.id} className="chip">
                  {a.person_name}
                  {(a.start_date || a.end_date) && (
                    <em>
                      {a.start_date ? shortDateYear(a.start_date) : ''}–{a.end_date ? shortDateYear(a.end_date) : ''}
                    </em>
                  )}
                  <button onClick={() => unassign.mutate(a.id)} title="Remove from this position" aria-label={`Remove ${a.person_name}`}>
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}

          {status !== 'filled' && (
            <div className="pos__assign">
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
                  const now = currentPct(c)
                  const then = peakIfNamed(c)
                  return (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {hasTeam && !teamIds.has(c.id) ? ' (other team)' : ''} — {now}% now → {then}% if named{then > 100 ? ' ⚠' : ''}
                    </option>
                  )
                })}
              </select>
              <button
                type="button"
                className="pos__suggest-btn"
                disabled={suggest.isPending}
                onClick={() => {
                  setSuggestion(null)
                  suggest.mutate(p.id, {
                    onSuccess: (r) => setSuggestion(r.error ?? r.reply),
                    onError: (e) => setSuggestion(e.message),
                  })
                }}
              >
                {suggest.isPending ? 'Asking the Agent…' : '✨ Suggest a fit'}
              </button>
            </div>
          )}

          {suggestion && <div className="pos__suggestion">{suggestion}</div>}
          {message && <div className={`pos__msg pos__msg--${message.kind}`}>{message.text}</div>}
        </div>
      )}
    </div>
  )
}
