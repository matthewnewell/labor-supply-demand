import { useEffect, useMemo, useRef, useState } from 'react'
import { useOutlook } from '../api/hooks'
import type { OutlookProject, OutlookResponse } from '../api/types'
import { TimelineControls, useTimelineControls } from '../components/Timeline'
import { buildBuckets, bucketValue, windowSlice, type Bucket } from '../lib/buckets'
import { num, shortDateYear } from '../lib/dates'
import {
  HOURS_PER_FTE,
  SUSTAIN_WEEKS,
  defaultOutcome,
  demandByCategory,
  hiringNeeds,
  weightOf,
  type Outcome,
  type Outcomes,
} from '../lib/outlook'
import './OutlookPage.css'

/** The big picture for senior leadership: all the labor every project has planned (Good Plan),
 * how much of it has names on it, what was actually charged, and the people each category has,
 * by week, month, quarter or year. Pursuits count by the outcome the operator picks (won, lost,
 * or weighted by WinMax's P(Win)), and the page says which categories run short and when the
 * hire has to start. */

type SeriesKey = 'plan' | 'committed' | 'actual' | 'capacity'
const SERIES: { key: SeriesKey; label: string }[] = [
  { key: 'plan', label: 'Plan' },
  { key: 'committed', label: 'Committed' },
  { key: 'actual', label: 'Actual' },
  { key: 'capacity', label: 'Capacity' },
]

const STORE = 'lsd:outlook'

interface Saved {
  outcomes: Outcomes
  show: Record<SeriesKey, boolean>
  lead: number
  fn: string
  project: string
}

function load(): Saved {
  const base: Saved = {
    outcomes: {},
    show: { plan: true, committed: true, actual: true, capacity: true },
    lead: 12,
    fn: '',
    project: '',
  }
  try {
    const raw = window.localStorage.getItem(STORE)
    if (raw) return { ...base, ...JSON.parse(raw) }
  } catch {
    /* defaults */
  }
  return base
}

function pwinClass(p: number | null | undefined): string {
  if (p == null) return 'ol-pwin'
  if (p >= 60) return 'ol-pwin ol-pwin--good'
  if (p >= 40) return 'ol-pwin ol-pwin--mid'
  return 'ol-pwin ol-pwin--low'
}

const fte = (hours: number, weeks: number) => (weeks ? hours / (HOURS_PER_FTE * weeks) : 0)

export default function OutlookPage() {
  const { data, isLoading, error } = useOutlook()
  if (isLoading) return <div className="ol-page ol-page--msg">Loading the outlook…</div>
  if (error || !data) return <div className="ol-page ol-page--msg">Couldn't load the outlook: {String(error)}</div>
  return <Outlook data={data} />
}

function Outlook({ data }: { data: OutlookResponse }) {
  const tl = useTimelineControls()
  const [saved, setSaved] = useState<Saved>(load)
  const update = (patch: Partial<Saved>) =>
    setSaved((s) => {
      const next = { ...s, ...patch }
      try {
        window.localStorage.setItem(STORE, JSON.stringify(next))
      } catch {
        /* not remembered */
      }
      return next
    })

  const { outcomes, show, lead, fn } = saved
  const projectsById = useMemo(() => new Map(data.projects.map((p) => [p.id, p])), [data.projects])
  const project = saved.project ? projectsById.get(saved.project) ?? null : null
  const pursuits = data.projects.filter((p) => !p.awarded)
  const awarded = data.projects.filter((p) => p.awarded)

  // The function slicer narrows every number on the page to that function's labor categories.
  const cats = useMemo(
    () => data.categories.filter((c) => !fn || c.function === fn),
    [data.categories, fn],
  )
  const catNames = useMemo(() => new Set(cats.map((c) => c.name)), [cats])
  const capacityHours = cats.reduce((s, c) => s + c.capacity_hours, 0)
  const headcount = cats.reduce((s, c) => s + c.headcount, 0)

  const demand = useMemo(
    () => demandByCategory(data.series.filter((s) => catNames.has(s.category)), projectsById, outcomes),
    [data.series, catNames, projectsById, outcomes],
  )
  const needs = useMemo(
    () =>
      hiringNeeds(
        data.weeks, data.this_week, cats, demand,
        data.series.filter((s) => catNames.has(s.category)), projectsById, outcomes, lead,
      ),
    [data.weeks, data.this_week, cats, demand, data.series, catNames, projectsById, outcomes, lead],
  )

  // Chart series: the sliced projects (all, or the one picked) and the function's categories.
  const chart = useMemo(() => {
    const awardedPlan: Record<string, number> = {}
    const pursuitPlan: Record<string, number> = {}
    const committed: Record<string, number> = {}
    const actual: Record<string, number> = {}
    const add = (row: Record<string, number>, w: string, h: number) => (row[w] = (row[w] ?? 0) + h)
    for (const s of data.series) {
      if (!catNames.has(s.category)) continue
      if (project && s.project_id !== project.id) continue
      const p = projectsById.get(s.project_id)
      if (!p) continue
      const k = weightOf(p, outcomes[p.id])
      for (const [w, h] of Object.entries(s.plan)) {
        if (p.awarded) add(awardedPlan, w, h)
        else if (k > 0) add(pursuitPlan, w, h * k)
      }
      for (const [w, h] of Object.entries(s.committed)) add(committed, w, h)
      for (const [w, h] of Object.entries(s.actual)) add(actual, w, h)
    }
    return { awardedPlan, pursuitPlan, committed, actual }
  }, [data.series, catNames, project, projectsById, outcomes])

  const buckets = useMemo(() => buildBuckets(data.weeks, tl.zoom, data.this_week), [data.weeks, tl.zoom, data.this_week])
  const visible = useMemo(() => windowSlice(buckets, tl.zoom, tl.windowMode, tl.page), [buckets, tl.zoom, tl.windowMode, tl.page])

  // Short, per bucket: summed per category (a spare engineer doesn't cover a missing machinist).
  const shortOf = (b: Bucket) =>
    cats.reduce((sum, c) => {
      const d = fte(bucketValue(demand.get(c.name), b), b.weeks.length)
      return sum + Math.max(0, d - c.capacity_hours / HOURS_PER_FTE)
    }, 0)

  // Headline numbers: the next 12 months from this week.
  const year = data.weeks.filter((w) => w >= data.this_week).slice(0, 52)
  const yearBucket: Bucket = { key: 'next', label: '', weeks: year, isCurrent: false }
  const allAwarded: Record<string, number> = {}
  const allPursuit: Record<string, number> = {}
  for (const s of data.series) {
    if (!catNames.has(s.category)) continue
    const p = projectsById.get(s.project_id)
    if (!p) continue
    const k = weightOf(p, outcomes[p.id])
    for (const [w, h] of Object.entries(s.plan)) {
      if (p.awarded) allAwarded[w] = (allAwarded[w] ?? 0) + h
      else allPursuit[w] = (allPursuit[w] ?? 0) + h * k
    }
  }
  const awardedFte = fte(bucketValue(allAwarded, yearBucket), year.length)
  const pursuitFte = fte(bucketValue(allPursuit, yearBucket), year.length)
  const heads = needs.reduce((s, n) => s + n.heads, 0)
  const firstHire = needs[0]

  const setOutcome = (id: string, o: Outcome) => update({ outcomes: { ...outcomes, [id]: o } })
  const setAll = (o: Outcome | null) =>
    update({ outcomes: o ? Object.fromEntries(pursuits.map((p) => [p.id, o])) : {} })

  return (
    <div className="ol-page">
      <header className="ol-head">
        <div>
          <h1>Outlook</h1>
          <p>
            Every project's labor against the people we have — and who we'd need to hire if the pursuits come in.
          </p>
        </div>
        {data.errors.length > 0 && <div className="ol-warn">{data.errors.join(' ')}</div>}
      </header>

      <section className="ol-kpis">
        <Kpi label="Awarded work, next 12 months" value={`${num(awardedFte, 1)} FTE`} sub={`against ${headcount} people`} />
        <Kpi
          label="Pursuits, as you've picked them"
          value={`+${num(pursuitFte, 1)} FTE`}
          sub={`${pursuits.filter((p) => weightOf(p, outcomes[p.id]) > 0).length} of ${pursuits.length} pursuits counted`}
          tone="pursuit"
        />
        <Kpi
          label="People to hire"
          value={heads ? String(heads) : 'None'}
          sub={heads ? `across ${needs.length} labor categor${needs.length === 1 ? 'y' : 'ies'}` : 'capacity covers the demand'}
          tone={heads ? 'short' : 'ok'}
        />
        <Kpi
          label="First hire needed by"
          value={firstHire ? (firstHire.late ? 'Now' : firstHire.hire_by === data.this_week ? 'This week' : shortDateYear(firstHire.hire_by)) : '—'}
          sub={firstHire ? `${firstHire.category}, short from ${shortDateYear(firstHire.short_from)}` : `with a ${lead}-week hiring lead`}
          tone={firstHire?.late ? 'short' : undefined}
        />
      </section>

      <div className="ol-toolbar">
        <TimelineControls
          zoom={tl.zoom}
          windowMode={tl.windowMode}
          page={tl.page}
          onZoom={tl.setZoom}
          onWindow={tl.setWindowMode}
          onPrev={tl.prev}
          onNext={tl.next}
          onNow={tl.toNow}
        />
        <label className="ol-select">
          <span>Function</span>
          <select value={fn} onChange={(e) => update({ fn: e.target.value })}>
            <option value="">All functions</option>
            {data.functions.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>
        <label className="ol-select">
          <span>Project</span>
          <select value={saved.project} onChange={(e) => update({ project: e.target.value })}>
            <option value="">All projects</option>
            <optgroup label="Awarded">
              {awarded.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Pursuits">
              {pursuits.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                  {p.pursuit?.p_win != null ? ` (PWIN ${p.pursuit.p_win}%)` : ''}
                </option>
              ))}
            </optgroup>
          </select>
        </label>
        <span className="ol-toggles" role="group" aria-label="Series">
          {SERIES.map((s) => (
            <button
              key={s.key}
              className={`ol-toggle ol-toggle--${s.key}${show[s.key] ? ' on' : ''}`}
              aria-pressed={show[s.key]}
              onClick={() => update({ show: { ...show, [s.key]: !show[s.key] } })}
            >
              {s.label}
            </button>
          ))}
        </span>
      </div>

      <div className="ol-body">
        <div className="ol-main">
          <section className="ol-card">
            <div className="ol-card__head">
              <h2>
                {project ? project.name : 'All projects'}
                {fn ? ` · ${fn}` : ''}
              </h2>
              <span className="ol-card__note">Average FTE per {tl.zoom}</span>
            </div>
            <Chart
              buckets={visible}
              thisWeek={data.this_week}
              chart={chart}
              show={{ ...show, capacity: show.capacity && !project }}
              capacityFte={capacityHours / HOURS_PER_FTE}
              shortOf={project ? null : shortOf}
            />
            <Legend showCapacity={show.capacity && !project} />
            {project && show.capacity && (
              <p className="ol-card__foot">
                Capacity is shared across every project, so it's left off a single project's view. The hiring
                picture below still counts all of them.
              </p>
            )}
          </section>

          <section className="ol-card">
            <div className="ol-card__head">
              <h2>When to hire</h2>
              <label className="ol-lead">
                Hiring lead time
                <input
                  type="number"
                  min={0}
                  max={52}
                  value={lead}
                  onChange={(e) => update({ lead: Math.max(0, Math.min(52, Number(e.target.value) || 0)) })}
                />
                weeks
              </label>
            </div>
            <p className="ol-card__lede">
              Every awarded project plus the pursuits as picked on the right. A category counts as short when its
              demand stays above the people it has for {SUSTAIN_WEEKS}+ weeks running; shorter spikes are overtime.
            </p>
            <HiringTable needs={needs} thisWeek={data.this_week} projectsById={projectsById} onPick={(id) => update({ project: id })} />
          </section>
        </div>

        <aside className="ol-side">
          {project && (
            <ProjectCard
              project={project}
              outcome={outcomes[project.id] ?? defaultOutcome(project)}
              data={data}
              onOutcome={(o) => setOutcome(project.id, o)}
              onClose={() => update({ project: '' })}
            />
          )}

          <section className="ol-card">
            <div className="ol-card__head">
              <h2>Pursuits</h2>
            </div>
            <p className="ol-card__lede">Pick which ones we win. By default each counts at its P(Win).</p>
            <div className="ol-presets">
              <button onClick={() => setAll('lost')}>Awarded only</button>
              <button onClick={() => setAll(null)}>By P(Win)</button>
              <button onClick={() => setAll('won')}>Win them all</button>
            </div>
            <ul className="ol-plist">
              {pursuits.map((p) => (
                <PursuitRow
                  key={p.id}
                  project={p}
                  outcome={outcomes[p.id] ?? defaultOutcome(p)}
                  selected={project?.id === p.id}
                  onPick={() => update({ project: p.id })}
                  onOutcome={(o) => setOutcome(p.id, o)}
                />
              ))}
              {pursuits.length === 0 && <li className="ol-empty">No pursuits have a labor plan in Good Plan yet.</li>}
            </ul>
          </section>

          <section className="ol-card">
            <div className="ol-card__head">
              <h2>Awarded</h2>
            </div>
            <ul className="ol-plist">
              {awarded.map((p) => (
                <li key={p.id} className={`ol-prow${project?.id === p.id ? ' ol-prow--on' : ''}`}>
                  <button className="ol-prow__name" onClick={() => update({ project: p.id })}>
                    {p.name}
                  </button>
                  <span className="ol-prow__meta">
                    {shortDateYear(p.first_week)} – {shortDateYear(p.last_week)}
                    {p.open_positions > 0 && <span className="ol-open"> · {p.open_positions} open</span>}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  )
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'pursuit' | 'short' | 'ok' }) {
  return (
    <div className={`ol-kpi${tone ? ` ol-kpi--${tone}` : ''}`}>
      <span className="ol-kpi__label">{label}</span>
      <span className="ol-kpi__value">{value}</span>
      <span className="ol-kpi__sub">{sub}</span>
    </div>
  )
}

function OutcomeSwitch({ value, onChange, pwin }: { value: Outcome; onChange: (o: Outcome) => void; pwin: number | null }) {
  const opts: { o: Outcome; label: string; title: string }[] = [
    { o: 'won', label: 'Win', title: 'Count all of its plan' },
    { o: 'weighted', label: pwin != null ? `${pwin}%` : 'P(Win)', title: 'Count its plan at its P(Win)' },
    { o: 'lost', label: 'Lose', title: 'Leave it out' },
  ]
  return (
    <span className="ol-switch" role="group" aria-label="Outcome">
      {opts.map(({ o, label, title }) => (
        <button key={o} className={value === o ? `on ol-switch--${o}` : ''} title={title} aria-pressed={value === o} onClick={() => onChange(o)}>
          {label}
        </button>
      ))}
    </span>
  )
}

function PursuitRow({
  project,
  outcome,
  selected,
  onPick,
  onOutcome,
}: {
  project: OutlookProject
  outcome: Outcome
  selected: boolean
  onPick: () => void
  onOutcome: (o: Outcome) => void
}) {
  const pw = project.pursuit?.p_win ?? null
  return (
    <li className={`ol-prow${selected ? ' ol-prow--on' : ''}`}>
      <div className="ol-prow__top">
        <button className="ol-prow__name" onClick={onPick}>
          {project.name}
        </button>
        <span className={pwinClass(pw)} title="P(Win) from WinMax">
          {pw != null ? `PWIN ${pw}%` : 'No PWIN'}
        </span>
      </div>
      <div className="ol-prow__bottom">
        <span className="ol-prow__meta">
          Starts {shortDateYear(project.first_week)} · {num(project.plan_hours / HOURS_PER_FTE / 52, 1)} FTE-yr
          {project.pursuit?.status === 'no_bid' && <span className="ol-open"> · no-bid</span>}
        </span>
        <OutcomeSwitch value={outcome} onChange={onOutcome} pwin={pw} />
      </div>
    </li>
  )
}

function ProjectCard({
  project,
  outcome,
  data,
  onOutcome,
  onClose,
}: {
  project: OutlookProject
  outcome: Outcome
  data: OutlookResponse
  onOutcome: (o: Outcome) => void
  onClose: () => void
}) {
  const byCat = new Map<string, number>()
  let peakFte = 0
  const weekly: Record<string, number> = {}
  for (const s of data.series) {
    if (s.project_id !== project.id) continue
    let h = 0
    for (const [w, v] of Object.entries(s.plan)) {
      h += v
      weekly[w] = (weekly[w] ?? 0) + v
    }
    byCat.set(s.category, (byCat.get(s.category) ?? 0) + h)
  }
  for (const v of Object.values(weekly)) peakFte = Math.max(peakFte, v / HOURS_PER_FTE)
  const top = [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
  const p = project.pursuit

  return (
    <section className="ol-card ol-detail">
      <div className="ol-card__head">
        <span className={`ol-tag${project.awarded ? '' : ' ol-tag--pursuit'}`}>{project.awarded ? 'Awarded' : 'Pursuit'}</span>
        <button className="ol-x" onClick={onClose} aria-label="Back to all projects" title="Back to all projects">
          ×
        </button>
      </div>
      <h2 className="ol-detail__name">{project.name}</h2>
      <dl className="ol-detail__facts">
        {p?.customer && (
          <>
            <dt>Customer</dt>
            <dd>{p.customer}</dd>
          </>
        )}
        <dt>{project.awarded ? 'Phase' : 'Gate'}</dt>
        <dd className="ol-cap">{(project.awarded ? project.phase : p?.gate)?.replace(/_/g, ' ') ?? '—'}</dd>
        {p && (
          <>
            <dt>P(Win) / P(Go)</dt>
            <dd>
              <span className={pwinClass(p.p_win)}>{p.p_win ?? '—'}%</span> / {p.p_go ?? '—'}%
            </dd>
          </>
        )}
        <dt>Labor window</dt>
        <dd>
          {shortDateYear(project.first_week)} – {shortDateYear(project.last_week)}
        </dd>
        <dt>Planned labor</dt>
        <dd>
          {num(project.plan_hours)} h · peak {num(peakFte, 1)} FTE
        </dd>
        <dt>Positions</dt>
        <dd>
          {project.positions}
          {project.open_positions > 0 ? `, ${project.open_positions} with no one named` : ', all named'}
        </dd>
      </dl>
      {!project.awarded && (
        <div className="ol-detail__outcome">
          <span>In the outlook as</span>
          <OutcomeSwitch value={outcome} onChange={onOutcome} pwin={p?.p_win ?? null} />
        </div>
      )}
      {top.length > 0 && (
        <div className="ol-detail__cats">
          <span className="ol-detail__sub">Biggest asks</span>
          {top.map(([c, h]) => (
            <div key={c} className="ol-detail__cat">
              <span>{c}</span>
              <span>{num(h)} h</span>
            </div>
          ))}
        </div>
      )}
      <div className="ol-detail__links">
        {project.links.winmax && (
          <a className="lsd-btn lsd-btn--primary" href={project.links.winmax} target="_blank" rel="noreferrer">
            Open in WinMax
          </a>
        )}
        {project.links.reckon && (
          <a className="lsd-btn lsd-btn--primary" href={project.links.reckon} target="_blank" rel="noreferrer" title="Reckon has labor rates today; per-project views come later">
            Open in Reckon
          </a>
        )}
        <a className="lsd-btn lsd-btn--ghost" href={project.links.depot} target="_blank" rel="noreferrer">
          Project in Conway's Depot
        </a>
        <a className="lsd-btn lsd-btn--ghost" href={project.links.good_plan} target="_blank" rel="noreferrer">
          Labor plan in Good Plan
        </a>
      </div>
    </section>
  )
}

function HiringTable({
  needs,
  thisWeek,
  projectsById,
  onPick,
}: {
  needs: ReturnType<typeof hiringNeeds>
  thisWeek: string
  projectsById: Map<string, OutlookProject>
  onPick: (id: string) => void
}) {
  if (needs.length === 0) {
    return <div className="ol-empty ol-empty--ok">No category runs short. The people we have cover this outlook.</div>
  }
  return (
    <table className="ol-hire">
      <thead>
        <tr>
          <th>Labor category</th>
          <th className="num">Have</th>
          <th className="num">Hire</th>
          <th>Short from</th>
          <th>Hire by</th>
          <th>Driven by</th>
        </tr>
      </thead>
      <tbody>
        {needs.map((n) => (
          <tr key={n.category}>
            <td>
              <div className="ol-hire__cat">{n.category}</div>
              <div className="ol-hire__fn">{n.function}</div>
            </td>
            <td className="num">{n.headcount}</td>
            <td className="num ol-hire__heads">+{n.heads}</td>
            <td className="ol-hire__date">{shortDateYear(n.short_from)}</td>
            <td>
              <span className={`ol-hireby${n.late ? ' ol-hireby--late' : ''}`}>
                {n.late ? `Now (was ${shortDateYear(n.hire_by)})` : n.hire_by === thisWeek ? 'This week' : shortDateYear(n.hire_by)}
              </span>
            </td>
            <td className="ol-hire__drivers">
              {n.drivers.map((d) => (
                <button key={d.id} className="ol-driver" onClick={() => onPick(d.id)} title={`${num(d.hours)} h in the short weeks`}>
                  {projectsById.get(d.id)?.name ?? d.name}
                  {!d.awarded && d.p_win != null && <span className={pwinClass(d.p_win)}>{d.p_win}%</span>}
                </button>
              ))}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function Legend({ showCapacity }: { showCapacity: boolean }) {
  return (
    <div className="ol-legend">
      <span className="ol-legend__item ol-legend__item--awarded">Plan, awarded</span>
      <span className="ol-legend__item ol-legend__item--pursuit">Plan, pursuits (as picked)</span>
      <span className="ol-legend__item ol-legend__item--committed">Committed (named)</span>
      <span className="ol-legend__item ol-legend__item--actual">Actual (charged)</span>
      {showCapacity && <span className="ol-legend__item ol-legend__item--capacity">Capacity (people we have)</span>}
    </div>
  )
}

function useWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T>(null)
  const [w, setW] = useState(800)
  useEffect(() => {
    if (!ref.current) return
    setW(Math.max(320, Math.floor(ref.current.clientWidth)))
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, Math.floor(e.contentRect.width))))
    ro.observe(ref.current)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

function niceStep(max: number): number {
  const raw = max / 4
  const mag = 10 ** Math.floor(Math.log10(raw || 1))
  for (const m of [1, 2, 2.5, 5, 10]) if (raw <= m * mag) return m * mag
  return 10 * mag
}

function Chart({
  buckets,
  thisWeek,
  chart,
  show,
  capacityFte,
  shortOf,
}: {
  buckets: Bucket[]
  thisWeek: string
  chart: { awardedPlan: Record<string, number>; pursuitPlan: Record<string, number>; committed: Record<string, number>; actual: Record<string, number> }
  show: Record<SeriesKey, boolean>
  capacityFte: number
  shortOf: ((b: Bucket) => number) | null
}) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const H = 250
  const pad = { l: 40, r: 8, t: 10, b: 26 }
  const rows = buckets.map((b) => {
    const n = b.weeks.length
    return {
      b,
      awarded: fte(bucketValue(chart.awardedPlan, b), n),
      pursuit: fte(bucketValue(chart.pursuitPlan, b), n),
      committed: fte(bucketValue(chart.committed, b), n),
      // Actuals only exist up to now; a future bucket shows none rather than a zero bar.
      actual: b.weeks[0] <= thisWeek ? fte(bucketValue(chart.actual, b), n) : null,
      short: shortOf ? shortOf(b) : null,
    }
  })
  const maxY =
    Math.max(
      1,
      ...rows.map((r) =>
        Math.max(show.plan ? r.awarded + r.pursuit : 0, show.committed ? r.committed : 0, show.actual ? r.actual ?? 0 : 0),
      ),
      show.capacity ? capacityFte : 0,
    ) * 1.1
  const step = niceStep(maxY)
  const top = Math.ceil(maxY / step) * step
  const plotW = width - pad.l - pad.r
  const plotH = H - pad.t - pad.b
  const bw = plotW / Math.max(1, rows.length)
  const y = (v: number) => pad.t + plotH - (v / top) * plotH
  const bars = (['plan', 'committed', 'actual'] as const).filter((k) => show[k])
  const barW = Math.min(22, (bw * 0.72) / Math.max(1, bars.length))
  const ticks: number[] = []
  for (let v = 0; v <= top + 1e-9; v += step) ticks.push(v)

  return (
    <div className="ol-chart" ref={ref}>
      <svg width={width} height={H} role="img" aria-label="Labor by period, in FTE">
        <defs>
          <pattern id="ol-hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" className="ol-hatch-bg" />
            <line x1="0" y1="0" x2="0" y2="6" className="ol-hatch-line" strokeWidth="3" />
          </pattern>
        </defs>
        {rows.map((r, i) =>
          r.b.isCurrent ? <rect key="now" x={pad.l + i * bw} y={pad.t} width={bw} height={plotH} className="ol-now" /> : null,
        )}
        {ticks.map((v) => (
          <g key={v}>
            <line x1={pad.l} x2={width - pad.r} y1={y(v)} y2={y(v)} className="ol-grid" />
            <text x={pad.l - 6} y={y(v) + 4} className="ol-axis" textAnchor="end">
              {num(v, step < 1 ? 1 : 0)}
            </text>
          </g>
        ))}
        {rows.map((r, i) => {
          const cx = pad.l + i * bw + bw / 2
          const x0 = cx - (bars.length * barW) / 2
          return (
            <g key={r.b.key}>
              {bars.map((k, j) => {
                const x = x0 + j * barW + 1
                const w = barW - 2
                if (k === 'plan') {
                  const tip = `${r.b.label}: plan ${num(r.awarded + r.pursuit, 1)} FTE (awarded ${num(r.awarded, 1)}, pursuits ${num(r.pursuit, 1)})`
                  return (
                    <g key={k}>
                      <title>{tip}</title>
                      <rect x={x} y={y(r.awarded)} width={w} height={y(0) - y(r.awarded)} className="ol-bar--awarded" />
                      <rect x={x} y={y(r.awarded + r.pursuit)} width={w} height={y(0) - y(r.pursuit)} fill="url(#ol-hatch)" className="ol-bar--pursuit" />
                    </g>
                  )
                }
                const v = k === 'committed' ? r.committed : r.actual
                if (v == null) return null
                return (
                  <rect key={k} x={x} y={y(v)} width={w} height={y(0) - y(v)} className={`ol-bar--${k}`}>
                    <title>{`${r.b.label}: ${k} ${num(v, 1)} FTE`}</title>
                  </rect>
                )
              })}
              <text x={cx} y={H - 8} className={`ol-axis${r.b.isCurrent ? ' ol-axis--now' : ''}`} textAnchor="middle">
                {r.b.label}
              </text>
            </g>
          )
        })}
        {show.capacity && capacityFte > 0 && (
          <g>
            <line x1={pad.l} x2={width - pad.r} y1={y(capacityFte)} y2={y(capacityFte)} className="ol-capacity" />
            <text x={width - pad.r - 4} y={y(capacityFte) - 5} className="ol-axis ol-axis--cap" textAnchor="end">
              {num(capacityFte, 0)} people
            </text>
          </g>
        )}
      </svg>
      {shortOf && (
        <div className="ol-short" style={{ paddingLeft: pad.l, paddingRight: pad.r }}>
          <span className="ol-short__label" style={{ width: pad.l }} title="People short, summed per labor category">
            Short
          </span>
          {rows.map((r) => (
            <span key={r.b.key} className={`ol-short__cell${(r.short ?? 0) >= 0.5 ? ' ol-short__cell--on' : ''}`}>
              {(r.short ?? 0) >= 0.5 ? `−${num(r.short ?? 0, 1)}` : '·'}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
