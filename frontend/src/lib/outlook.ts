/** The Outlook's arithmetic: which demand counts under the picked wins, how that sits against the
 * people each labor category has, and when a category runs short enough to hire. Pure functions
 * over the /api/outlook payload, so the page can recompute on every toggle. */

import type { OutlookCategory, OutlookProject, OutlookSeries } from '../api/types'

export const HOURS_PER_FTE = 40

/** What the operator assumes about a pursuit: we win it, we don't, or it counts by its P(Win). */
export type Outcome = 'won' | 'weighted' | 'lost'

/** A pursuit's default: weighted by P(Win), unless WinMax already says we aren't bidding. */
export function defaultOutcome(p: OutlookProject): Outcome {
  return p.pursuit?.status === 'no_bid' || p.pursuit?.status === 'lost' ? 'lost' : 'weighted'
}

/** How much of a project's plan counts as demand: awarded work always counts in full. */
export function weightOf(p: OutlookProject, outcome: Outcome | undefined): number {
  if (p.awarded) return 1
  const o = outcome ?? defaultOutcome(p)
  if (o === 'won') return 1
  if (o === 'lost') return 0
  return (p.pursuit?.p_win ?? 0) / 100
}

export type Outcomes = Record<string, Outcome>

/** Weekly demand per category (awarded plus each pursuit at its weight), across every project. */
export function demandByCategory(
  series: OutlookSeries[],
  projects: Map<string, OutlookProject>,
  outcomes: Outcomes,
): Map<string, Record<string, number>> {
  const out = new Map<string, Record<string, number>>()
  for (const s of series) {
    const p = projects.get(s.project_id)
    if (!p) continue
    const k = weightOf(p, outcomes[p.id])
    if (k === 0) continue
    const row = out.get(s.category) ?? {}
    for (const [w, h] of Object.entries(s.plan)) row[w] = (row[w] ?? 0) + h * k
    out.set(s.category, row)
  }
  return out
}

export interface HireNeed {
  category: string
  function: string
  headcount: number
  /** First week of the first shortfall that lasts at least SUSTAIN_WEEKS. */
  short_from: string
  /** Heads to add: the biggest sustained gap, in whole people. */
  heads: number
  peak_week: string
  hire_by: string
  /** hire_by is already behind us: hire now, or cover it with overtime/contractors meanwhile. */
  late: boolean
  /** The projects carrying the most demand in the short weeks, largest first. */
  drivers: { id: string; name: string; awarded: boolean; p_win: number | null; hours: number }[]
}

/** A dip over capacity for a week or two is overtime, not a hire. */
export const SUSTAIN_WEEKS = 4

function addWeeks(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`)
  d.setDate(d.getDate() + n * 7)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** Per category, from this week on: where demand stays above capacity for SUSTAIN_WEEKS or more,
 * how many people that takes, and when the hire has to start given the hiring lead time. */
export function hiringNeeds(
  weeks: string[],
  thisWeek: string,
  categories: OutlookCategory[],
  demand: Map<string, Record<string, number>>,
  series: OutlookSeries[],
  projects: Map<string, OutlookProject>,
  outcomes: Outcomes,
  leadWeeks: number,
): HireNeed[] {
  const ahead = weeks.filter((w) => w >= thisWeek)
  const needs: HireNeed[] = []
  for (const c of categories) {
    const row = demand.get(c.name)
    if (!row) continue
    const cap = c.capacity_hours
    let run: string[] = []
    const shortWeeks: string[] = []
    const flush = () => {
      if (run.length >= SUSTAIN_WEEKS) shortWeeks.push(...run)
      run = []
    }
    for (const w of ahead) {
      if ((row[w] ?? 0) > cap + 1e-6) run.push(w)
      else flush()
    }
    flush()
    if (shortWeeks.length === 0) continue

    let peak = shortWeeks[0]
    for (const w of shortWeeks) if ((row[w] ?? 0) > (row[peak] ?? 0)) peak = w
    // Round down small fractions: a tenth of a person over is overtime, not a hire.
    const heads = Math.max(1, Math.ceil(((row[peak] ?? 0) - cap) / HOURS_PER_FTE - 0.1))
    const hireBy = addWeeks(shortWeeks[0], -leadWeeks)

    const byProject = new Map<string, number>()
    const inShort = new Set(shortWeeks)
    for (const s of series) {
      if (s.category !== c.name) continue
      const p = projects.get(s.project_id)
      if (!p) continue
      const k = weightOf(p, outcomes[p.id])
      if (k === 0) continue
      let h = 0
      for (const [w, v] of Object.entries(s.plan)) if (inShort.has(w)) h += v * k
      if (h > 0) byProject.set(p.id, (byProject.get(p.id) ?? 0) + h)
    }
    const drivers = [...byProject.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([id, hours]) => {
        const p = projects.get(id)!
        return { id, name: p.name, awarded: p.awarded, p_win: p.pursuit?.p_win ?? null, hours }
      })

    needs.push({
      category: c.name,
      function: c.function,
      headcount: c.headcount,
      short_from: shortWeeks[0],
      heads,
      peak_week: peak,
      hire_by: hireBy,
      late: hireBy < thisWeek,
      drivers,
    })
  }
  return needs.sort((a, b) => a.hire_by.localeCompare(b.hire_by) || b.heads - a.heads)
}
