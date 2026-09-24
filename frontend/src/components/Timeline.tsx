import { useEffect, useMemo, useRef, useState } from 'react'
import { buildBuckets, bucketValue, windowSlice, type WindowMode, type Zoom } from '../lib/buckets'
import './Timeline.css'

const ZOOMS: Zoom[] = ['week', 'month', 'quarter', 'year']
const ZOOM_LABEL: Record<Zoom, string> = { week: 'Week', month: 'Month', quarter: 'Quarter', year: 'Year' }
const WINDOWS: WindowMode[] = ['backward', 'mixed', 'forward']
const WINDOW_LABEL: Record<WindowMode, string> = { backward: 'Backward', mixed: 'Mixed', forward: 'Forward' }

const KEY = 'lsd:timeline'

/** Zoom, window mode and paging — shared state (persisted) so Staffing and People stay on the
 * same view of time as you move between them, the same way they already share "scope". */
export function useTimelineControls() {
  const [state, setState] = useState<{ zoom: Zoom; window: WindowMode }>(() => {
    try {
      const raw = window.localStorage.getItem(KEY)
      if (raw) return JSON.parse(raw)
    } catch {
      /* default below */
    }
    return { zoom: 'month', window: 'mixed' }
  })
  const [page, setPage] = useState(0)

  function save(next: { zoom: Zoom; window: WindowMode }) {
    setState(next)
    setPage(0)
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next))
    } catch {
      /* not remembered */
    }
  }

  return {
    zoom: state.zoom,
    windowMode: state.window,
    page,
    setZoom: (zoom: Zoom) => save({ ...state, zoom }),
    setWindowMode: (windowMode: WindowMode) => save({ ...state, window: windowMode }),
    prev: () => setPage((p) => p - 1),
    next: () => setPage((p) => p + 1),
    toNow: () => setPage(0),
  }
}

export function TimelineControls({
  zoom,
  windowMode,
  page,
  onZoom,
  onWindow,
  onPrev,
  onNext,
  onNow,
}: {
  zoom: Zoom
  windowMode: WindowMode
  page: number
  onZoom: (z: Zoom) => void
  onWindow: (w: WindowMode) => void
  onPrev: () => void
  onNext: () => void
  onNow: () => void
}) {
  return (
    <div className="tl-controls">
      <span className="tl-controls__seg">
        {ZOOMS.map((z) => (
          <button key={z} className={zoom === z ? 'on' : ''} onClick={() => onZoom(z)}>
            {ZOOM_LABEL[z]}
          </button>
        ))}
      </span>
      <span className="tl-controls__seg">
        {WINDOWS.map((w) => (
          <button key={w} className={windowMode === w ? 'on' : ''} onClick={() => onWindow(w)}>
            {WINDOW_LABEL[w]}
          </button>
        ))}
      </span>
      <span className="tl-controls__pager">
        <button onClick={onPrev} title="Earlier">
          ‹
        </button>
        <button onClick={onNow} disabled={page === 0} title="Back to now">
          Now
        </button>
        <button onClick={onNext} title="Later">
          ›
        </button>
      </span>
    </div>
  )
}

export type SeriesKind = 'plan' | 'committed' | 'actual' | 'capacity'
export type Band = 'low' | 'mid' | 'over' | 'hard'

const SERIES_LABEL: Record<SeriesKind, string> = { plan: 'Demand', committed: 'Committed', actual: 'Actual', capacity: 'Capacity' }

/** Committed hours against capacity — the same 60%/100%/125% thresholds Good Plan already
 * flags a person-line with. Not monotonic on purpose: idle capacity is a "notice", not a danger,
 * so both tails (well under, moderately over) read as the same caution color; only seriously
 * over capacity is the alarm color. */
export function capacityBand(committed: number, capacity: number): Band | null {
  if (committed <= 0 || capacity <= 0) return null
  const r = committed / capacity
  if (r > 1.25) return 'hard'
  if (r > 1) return 'over'
  if (r > 0.6) return 'mid'
  return 'low'
}

/** Booked under this share of capacity counts as waiting for work (Good Plan's own "low" line). */
export const IDLE_RATIO = 0.6

/** Is this period, now or ahead, booked so lightly that the person (or team) is waiting for work? */
export function isIdle(booked: number, capacity: number): boolean {
  return capacity > 0 && booked / capacity < IDLE_RATIO
}

export interface TimelineRow {
  id: string
  label: string
  sublabel?: string
  series: Partial<Record<SeriesKind, Record<string, number>>>
  // A compact control in the label cell itself — Staffing's status button, which opens a
  // popover for naming/removing/Suggest-a-fit — so acting on a row costs no timeline width.
  // Omit for a row with nothing to do (People has none of these).
  labelExtra?: React.ReactNode
  // Week -> a short reason, when something about THAT week is worth flagging on the cell even
  // though it's not one of this row's own series — Staffing uses this for "the person named
  // here is over capacity that week," which is a fact about them, not about this position.
  flags?: Record<string, string>
  // Week -> whether the Committed bar that week is backed by someone within their own capacity
  // ('ok') or not ('over') — a position's own coverage can look identical whether the person
  // behind it is fine or already stretched thin elsewhere; this is what tells those two apart,
  // instead of a flat color that reads the same either way. Omit to keep Committed's plain
  // color (People bands it a different way, against its own capacity series).
  committedStatus?: Record<string, 'ok' | 'over'>
}

/** The shared axis: real calendar buckets at a chosen zoom, Plan/Committed/Actual kept as
 * visually distinct tracks (never collapsed into one fill, at any zoom) so a spike or a gap in
 * any one of them stays legible without hovering. One row per position (Staffing) or per person
 * (People) — same component, different data. */
export default function Timeline({
  weeks,
  thisWeek,
  rows,
  zoom,
  windowMode,
  page,
  seriesKinds,
  onRowClick,
  bandKind,
  bandTitle,
  bandLabels,
  bandLowColor,
  hideLowBand,
  committedLabel,
  idleSeries,
}: {
  weeks: string[]
  thisWeek: string
  rows: TimelineRow[]
  zoom: Zoom
  windowMode: WindowMode
  page: number
  seriesKinds: SeriesKind[]
  onRowClick?: (rowId: string) => void
  // When set, this series' bar is colored by capacityBand(itself, the row's `capacity` series)
  // instead of its own flat color — People colors Committed against Capacity this way; Staffing
  // leaves it unset, since its Committed is coverage of a position, not a person's capacity.
  bandKind?: SeriesKind
  // The band's wording is about the PAIR being compared, which differs by caller — a person's
  // own committed hours against their own capacity ("well committed") isn't the same claim as
  // aggregate demand against aggregate capacity ("comfortable"), even though the same thresholds
  // color both. Defaults to the committed-vs-capacity wording; a caller banding something else
  // (Team totals bands demand, not anyone's actual commitment) should override both.
  bandTitle?: string
  bandLabels?: { low: string; mid: string; hard: string }
  // The low/over band's own color, when the default yellow would collide with something else
  // on the same page — Team totals bands Demand and needed a color that doesn't read as the
  // same thing as People's own Committed band just below it.
  bandLowColor?: string
  // "Low" (well under capacity) is a real, useful fact about a PERSON — idle capacity worth
  // noticing. It isn't a useful fact about aggregate Demand — a quiet period isn't "awaiting
  // assignment", it just hasn't been asked for yet, and coloring it implied something wrong
  // that wasn't. Team totals sets this so a low period shows no bar at all, only Capacity.
  hideLowBand?: boolean
  // Committed reads as "Supply" on Staffing — the word "Committed" is right for a person's own
  // hours (People), but a position's coverage is better named the other half of demand/supply.
  committedLabel?: string
  // Mark every current or future period where this series is under IDLE_RATIO of capacity as
  // "awaiting assignment": keeping people booked is the functional manager's job, so a gap
  // ahead is shown, not left for someone to notice. Past periods can't be fixed and aren't marked.
  idleSeries?: SeriesKind
}) {
  const buckets = useMemo(() => buildBuckets(weeks, zoom, thisWeek), [weeks, zoom, thisWeek])
  const visible = useMemo(() => windowSlice(buckets, zoom, windowMode, page), [buckets, zoom, windowMode, page])
  const hasCommittedStatus = rows.some((r) => r.committedStatus)
  const nowRef = useRef<HTMLDivElement>(null)

  // The "now" column can exist in the visible window and still be scrolled off to the right —
  // a row's own horizontal scrollbar has no visual hint that there's more to see, so a narrower
  // window (Week's dense 12 columns especially) can look like it has no data at all when the
  // real activity just hasn't scrolled into view yet. Bring it on screen whenever the window
  // changes, instead of leaving that to be discovered.
  useEffect(() => {
    nowRef.current?.scrollIntoView({ inline: 'center', block: 'nearest' })
  }, [zoom, windowMode, page])

  if (visible.length === 0) {
    return <p className="tl-empty">Nothing in range.</p>
  }

  return (
    <div className="tl" style={bandLowColor ? ({ '--tl-band-low': bandLowColor } as React.CSSProperties) : undefined}>
      <div className="tl-grid" style={{ gridTemplateColumns: `var(--tl-label-w) repeat(${visible.length}, 1fr)` }}>
        <div className="tl-axis__spacer" />
        {visible.map((b) => (
          <div
            key={b.key}
            ref={b.isCurrent ? nowRef : undefined}
            className={`tl-axis__cell${b.isCurrent ? ' tl-axis__cell--now' : ''}`}
          >
            {b.label}
          </div>
        ))}

        {rows.map((row) => {
          const rowMax = Math.max(
            1,
            ...visible.flatMap((b) => seriesKinds.map((k) => bucketValue(row.series[k], b))),
          )
          return (
            <div className="tl-row" key={row.id}>
              <div
                className="tl-row__label"
                onClick={() => onRowClick?.(row.id)}
                role={onRowClick ? 'button' : undefined}
                tabIndex={onRowClick ? 0 : undefined}
              >
                <strong>{row.label}</strong>
                {row.sublabel && <span>{row.sublabel}</span>}
                {row.labelExtra}
              </div>
              {visible.map((b) => {
                const flagged = row.flags && b.weeks.filter((w) => row.flags![w])
                const flagTitle = flagged && flagged.length > 0 ? flagged.map((w) => row.flags![w]).join(' · ') : null
                const ahead = b.weeks.some((w) => w >= thisWeek)
                const cap = bucketValue(row.series.capacity, b)
                const booked = idleSeries ? bucketValue(row.series[idleSeries], b) : 0
                const idle = !!idleSeries && ahead && isIdle(booked, cap)
                return (
                  <div
                    key={b.key}
                    className={`tl-cell${b.isCurrent ? ' tl-cell--now' : ''}${idle ? ' tl-cell--idle' : ''}`}
                    title={idle ? `${row.label} · ${b.label} · awaiting assignment: ${Math.round(cap - booked)} h open of ${Math.round(cap)} h` : undefined}
                  >
                    {flagTitle && <span className="tl-cell__flag" title={flagTitle}>!</span>}
                    {seriesKinds.map((kind) => {
                      const v = bucketValue(row.series[kind], b)
                      const pct = Math.min(100, Math.round((v / rowMax) * 100))
                      const band = kind === bandKind ? capacityBand(v, bucketValue(row.series.capacity, b)) : null
                      // Committed's color says whether the person behind it is over capacity
                      // THAT period, when the caller knows — a fact about them, not this row's
                      // own numbers, so it can't come from capacityBand like the ratio bands do.
                      const status = kind === 'committed' && v > 0 && row.committedStatus
                        ? (b.weeks.some((w) => row.committedStatus![w] === 'over') ? 'over' : 'ok')
                        : null
                      const cls = status
                        ? `tl-bar tl-bar--status-${status}`
                        : band
                          ? `tl-bar tl-bar--band-${band}`
                          : `tl-bar tl-bar--${kind}`
                      const label = kind === 'committed' ? (committedLabel ?? SERIES_LABEL.committed) : SERIES_LABEL[kind]
                      const hidden = hideLowBand && band === 'low'
                      return (
                        <span
                          key={kind}
                          className={cls}
                          style={{ height: v > 0 && !hidden ? `${Math.max(6, pct)}%` : 0 }}
                          title={
                            v > 0 && !hidden
                              ? `${label} · ${b.label} · ${Math.round(v)} h${status === 'over' ? ' · person over capacity' : band ? ` · ${band}` : ''}`
                              : undefined
                          }
                        />
                      )
                    })}
                  </div>
                )
              })}
            </div>
          )
        })}
      </div>
      <div className="tl-legend">
        {idleSeries && <span className="tl-legend__item tl-legend__item--idle">Awaiting assignment</span>}
        {seriesKinds.map((k) =>
          k === bandKind ? (
            <span key={k} className="tl-legend__band">
              <b>{bandTitle ?? `${SERIES_LABEL[k]}, against capacity:`}</b>
              {!hideLowBand && (
                <span className="tl-legend__item tl-legend__item--band-low">{bandLabels?.low ?? 'Under or slightly over'}</span>
              )}
              <span className="tl-legend__item tl-legend__item--band-mid">{bandLabels?.mid ?? 'At capacity'}</span>
              <span className="tl-legend__item tl-legend__item--band-hard">{bandLabels?.hard ?? 'Over capacity'}</span>
            </span>
          ) : k === 'committed' && hasCommittedStatus ? (
            <span key={k} className="tl-legend__band">
              <b>{committedLabel ?? SERIES_LABEL.committed}, by the person's own capacity:</b>
              <span className="tl-legend__item tl-legend__item--status-ok">OK</span>
              <span className="tl-legend__item tl-legend__item--status-over">Person over capacity</span>
            </span>
          ) : (
            <span key={k} className={`tl-legend__item tl-legend__item--${k}`}>
              {k === 'committed' ? (committedLabel ?? SERIES_LABEL.committed) : SERIES_LABEL[k]}
            </span>
          ),
        )}
      </div>
    </div>
  )
}
