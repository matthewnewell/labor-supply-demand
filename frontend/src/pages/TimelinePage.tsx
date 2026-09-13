import { useMemo } from 'react'
import { useCommitments } from '../api/hooks'
import type { Commitment } from '../api/types'
import { barStyle, computeBounds, computeUtilization, monthTicks, pct, utilizationTone } from '../lib/timeline'
import './TimelinePage.css'

// A small fixed palette, assigned to projects by first-seen order — enough distinct projects
// to tell bars apart without needing a real color-per-project setting anywhere.
const PALETTE = ['#a21caf', '#0e7490', '#b45309', '#16a34a', '#4f46e5', '#be123c']

function useProjectColors(commitments: Commitment[]) {
  return useMemo(() => {
    const colors = new Map<string, string>()
    for (const c of commitments) {
      if (!colors.has(c.project)) colors.set(c.project, PALETTE[colors.size % PALETTE.length])
    }
    return colors
  }, [commitments])
}

/** Every committed person's calendar, all projects at once — the one view that can actually
 * answer "how committed is this person" and "where are two commitments stepping on each
 * other." Grouped by `assigned_to`; headcount-only commitments (no name yet) get their own
 * section by role, with bars but no utilization strip — there's no one calendar to sum against
 * until someone's actually named to them. */
export default function TimelinePage() {
  const { data: commitments, isLoading } = useCommitments()
  const projectColors = useProjectColors(commitments ?? [])

  const bounds = useMemo(() => computeBounds(commitments ?? []), [commitments])
  const ticks = useMemo(() => monthTicks(bounds), [bounds])

  const { people, unassigned } = useMemo(() => {
    const people = new Map<string, Commitment[]>()
    const unassigned = new Map<string, Commitment[]>()
    for (const c of commitments ?? []) {
      const bucket = c.assigned_to ? people : unassigned
      const key = c.assigned_to ?? c.role
      if (!bucket.has(key)) bucket.set(key, [])
      bucket.get(key)!.push(c)
    }
    return { people, unassigned }
  }, [commitments])

  if (isLoading) return <div className="timeline-page__loading">Loading…</div>

  return (
    <div className="timeline-page">
      <div className="timeline-page__inner">
        <header className="timeline-page__header">
          <h1 className="timeline-page__title">Timeline</h1>
          <div className="timeline-legend">
            {[...projectColors.entries()].map(([project, color]) => (
              <span className="timeline-legend__item" key={project}>
                <span className="timeline-legend__swatch" style={{ background: color }} />
                {project}
              </span>
            ))}
          </div>
        </header>

        <div className="timeline-grid">
          <div className="timeline-ruler">
            <div className="timeline-ruler__spacer" />
            <div className="timeline-ruler__track">
              {ticks.map((t) => (
                <span className="timeline-ruler__tick" key={t.time} style={{ left: `${pct(t.time, bounds)}%` }}>
                  {t.label}
                </span>
              ))}
            </div>
          </div>

          {people.size === 0 && unassigned.size === 0 && (
            <p className="timeline-page__empty">No commitments yet.</p>
          )}

          {[...people.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, lines]) => {
            const segments = computeUtilization(lines, bounds)
            return (
              <section className="timeline-person" key={name}>
                <div className="timeline-person__label">
                  <span className="timeline-person__name">{name}</span>
                </div>
                <div className="timeline-person__track">
                  <div className="util-strip">
                    {segments.map((s, i) => (
                      <div
                        key={i}
                        className={`util-strip__seg util-strip__seg--${utilizationTone(s.fte)}`}
                        style={{ left: `${pct(s.start, bounds)}%`, width: `${pct(s.end, bounds) - pct(s.start, bounds)}%` }}
                        title={`${s.fte.toFixed(2)} FTE`}
                      >
                        {pct(s.end, bounds) - pct(s.start, bounds) > 4 ? `${s.fte.toFixed(2)}` : ''}
                      </div>
                    ))}
                  </div>
                  {lines.map((c) => (
                    <div className="timeline-bar-row" key={c.id}>
                      <div
                        className="timeline-bar"
                        style={{ ...barStyle(c, bounds), background: projectColors.get(c.project) }}
                        title={`${c.project} — ${c.fte} FTE, ${c.start_date} → ${c.end_date}`}
                      >
                        <span className="timeline-bar__label">{c.role} · {c.fte} FTE</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )
          })}

          {unassigned.size > 0 && (
            <section className="timeline-unassigned">
              <h2 className="timeline-unassigned__title">Unassigned headcount</h2>
              {[...unassigned.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([role, lines]) => (
                <div className="timeline-person" key={role}>
                  <div className="timeline-person__label">
                    <span className="timeline-person__name">{role}</span>
                  </div>
                  <div className="timeline-person__track">
                    {lines.map((c) => (
                      <div className="timeline-bar-row" key={c.id}>
                        <div
                          className="timeline-bar timeline-bar--unassigned"
                          style={{ ...barStyle(c, bounds), background: projectColors.get(c.project) }}
                          title={`${c.project} — ${c.fte} FTE, ${c.start_date} → ${c.end_date}`}
                        >
                          <span className="timeline-bar__label">{c.project} · {c.fte} FTE</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
