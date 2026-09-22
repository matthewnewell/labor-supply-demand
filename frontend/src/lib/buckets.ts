/** Turns the app's native weekly data into buckets at a chosen zoom level, and picks which
 * buckets are visible — the shared timeline math behind both Staffing and People. Aggregation
 * only ever sums hours within a bucket; nothing here invents data at a coarser grain. */

export type Zoom = 'week' | 'month' | 'quarter' | 'year'
export type WindowMode = 'backward' | 'forward' | 'mixed'

export interface Bucket {
  key: string
  label: string
  weeks: string[]
  isCurrent: boolean
}

// How many buckets sit in the visible window at each zoom, before paging.
const VISIBLE_COUNT: Record<Zoom, number> = { week: 12, month: 12, quarter: 8, year: 6 }

function mondayDate(iso: string): Date {
  return new Date(`${iso}T00:00:00`)
}

function quarterOf(d: Date): number {
  return Math.floor(d.getMonth() / 3) + 1
}

/** The bucket key a given week belongs to, and a short label for its header cell. */
function keyAndLabel(iso: string, zoom: Zoom): { key: string; label: string } {
  const d = mondayDate(iso)
  if (zoom === 'week') {
    return { key: iso, label: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }
  }
  if (zoom === 'month') {
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    return { key, label: d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }) }
  }
  if (zoom === 'quarter') {
    const q = quarterOf(d)
    return { key: `${d.getFullYear()}-Q${q}`, label: `Q${q} '${String(d.getFullYear()).slice(2)}` }
  }
  return { key: `${d.getFullYear()}`, label: `${d.getFullYear()}` }
}

/** Groups every week in `weeks` into ordered buckets at `zoom`, flagging whichever bucket holds
 * `thisWeek` (the "now" marker every zoom level keeps). */
export function buildBuckets(weeks: string[], zoom: Zoom, thisWeek: string): Bucket[] {
  const byKey = new Map<string, Bucket>()
  const nowKey = thisWeek ? keyAndLabel(thisWeek, zoom).key : null
  for (const w of weeks) {
    const { key, label } = keyAndLabel(w, zoom)
    const existing = byKey.get(key)
    if (existing) existing.weeks.push(w)
    else byKey.set(key, { key, label, weeks: [w], isCurrent: key === nowKey })
  }
  return [...byKey.values()].sort((a, b) => a.weeks[0].localeCompare(b.weeks[0]))
}

/** Sums a weekly {date: hours} series over one bucket's weeks. */
export function bucketValue(series: Record<string, number> | undefined, bucket: Bucket): number {
  if (!series) return 0
  return bucket.weeks.reduce((sum, w) => sum + (series[w] ?? 0), 0)
}

/** The visible slice of buckets for a window mode, plus paging: `page` 0 is the default window
 * anchored on "now" (backward ends at now, forward starts at now, mixed centers on it); each
 * step of `page` shifts the whole window by one screen's worth of buckets, so paging never
 * changes which buckets exist, only which stretch is on screen. */
export function windowSlice(buckets: Bucket[], zoom: Zoom, mode: WindowMode, page: number): Bucket[] {
  const count = VISIBLE_COUNT[zoom]
  const nowIdx = buckets.findIndex((b) => b.isCurrent)
  const anchor = nowIdx === -1 ? buckets.length - 1 : nowIdx
  let start: number
  if (mode === 'forward') start = anchor
  else if (mode === 'backward') start = anchor - (count - 1)
  else start = anchor - Math.floor(count / 2)
  start += page * count
  const clampedStart = Math.max(0, Math.min(start, Math.max(0, buckets.length - count)))
  return buckets.slice(clampedStart, clampedStart + count)
}
