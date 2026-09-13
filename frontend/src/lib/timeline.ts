import type { Commitment } from '../api/types'

const DAY_MS = 24 * 60 * 60 * 1000

function toTime(iso: string): number {
  return new Date(`${iso}T00:00:00Z`).getTime()
}

function fromTime(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** The visible window: every commitment's own range, padded a week on each side so a bar never
 * touches the very edge. Computed from the data, not a fixed "today ± N" guess, so it always
 * fits whatever's actually committed. */
export function computeBounds(commitments: Commitment[]): { start: number; end: number } {
  if (commitments.length === 0) {
    const now = Date.now()
    return { start: now - 30 * DAY_MS, end: now + 60 * DAY_MS }
  }
  let start = Infinity
  let end = -Infinity
  for (const c of commitments) {
    start = Math.min(start, toTime(c.start_date))
    end = Math.max(end, toTime(c.end_date))
  }
  return { start: start - 7 * DAY_MS, end: end + 7 * DAY_MS + DAY_MS }
}

export function pct(time: number, bounds: { start: number; end: number }): number {
  return ((time - bounds.start) / (bounds.end - bounds.start)) * 100
}

/** Left/width % for one commitment's bar within the given bounds. `end_date` is inclusive, so
 * the bar extends through the end of that day. */
export function barStyle(c: Commitment, bounds: { start: number; end: number }) {
  const left = pct(toTime(c.start_date), bounds)
  const right = pct(toTime(c.end_date) + DAY_MS, bounds)
  return { left: `${left}%`, width: `${Math.max(right - left, 0.4)}%` }
}

/** First-of-month tick marks within the bounds, for the timeline's header ruler. */
export function monthTicks(bounds: { start: number; end: number }): { time: number; label: string }[] {
  const ticks: { time: number; label: string }[] = []
  const d = new Date(bounds.start)
  d.setUTCDate(1)
  d.setUTCHours(0, 0, 0, 0)
  if (d.getTime() < bounds.start) d.setUTCMonth(d.getUTCMonth() + 1)
  while (d.getTime() <= bounds.end) {
    ticks.push({
      time: d.getTime(),
      label: d.toLocaleDateString(undefined, { month: 'short', year: '2-digit', timeZone: 'UTC' }),
    })
    d.setUTCMonth(d.getUTCMonth() + 1)
  }
  return ticks
}

export interface UtilizationSegment {
  start: number
  end: number
  fte: number
}

/** One person's total commitment across time, computed exactly (not bucketed into arbitrary
 * weeks/months) — the timeline between any two consecutive commitment start/end dates has a
 * constant total FTE, so that's the real resolution of this number. A single person's own
 * commitments are the one case in this app where summing FTE across lines is honest, not fake
 * precision: unlike a role's demand, a person genuinely has one calendar, so more than 1.0 FTE
 * of it committed at once is a real conflict, not a manufactured total (see LaborBoardPage's
 * own note on why demand is never summed the same way). */
export function computeUtilization(commitments: Commitment[], bounds: { start: number; end: number }): UtilizationSegment[] {
  const breakpoints = new Set<number>([bounds.start, bounds.end])
  for (const c of commitments) {
    breakpoints.add(Math.max(toTime(c.start_date), bounds.start))
    breakpoints.add(Math.min(toTime(c.end_date) + DAY_MS, bounds.end))
  }
  const sorted = [...breakpoints].sort((a, b) => a - b)

  const segments: UtilizationSegment[] = []
  for (let i = 0; i < sorted.length - 1; i++) {
    const segStart = sorted[i]
    const segEnd = sorted[i + 1]
    if (segEnd <= segStart) continue
    const mid = (segStart + segEnd) / 2
    let fte = 0
    for (const c of commitments) {
      if (toTime(c.start_date) <= mid && toTime(c.end_date) + DAY_MS > mid) fte += c.fte
    }
    // Merge with the previous segment if the total didn't actually change — breakpoints come
    // from every commitment's edges, not just this person's, so adjacent segments often agree.
    const prev = segments[segments.length - 1]
    if (prev && Math.abs(prev.fte - fte) < 1e-9) {
      prev.end = segEnd
    } else {
      segments.push({ start: segStart, end: segEnd, fte })
    }
  }
  return segments
}

export function utilizationTone(fte: number): 'idle' | 'ok' | 'over' {
  if (fte <= 0) return 'idle'
  if (fte > 1.0001) return 'over'
  return 'ok'
}

export { fromTime, toTime }
