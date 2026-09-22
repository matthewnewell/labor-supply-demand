/** A person named to (part of) a position. See backend/models.py. */
export interface Assignment {
  id: string
  position_id: string
  depot_project_id: string | null
  project_name: string
  category: string
  position_label: string
  person_id: string
  person_name: string
  start_date: string | null
  end_date: string | null
  note: string | null
}

/** A project's request for one person of a labor category (a Good Plan labor line), with who is
 * named to it. Read live from Good Plan; the assignments are this app's. */
export interface Position {
  id: string
  depot_project_id: string
  project_name: string
  portfolio_name: string | null
  phase: string | null
  category: string
  label: string
  wbs: string | null
  note: string | null
  /** ISO Monday -> requested hours */
  weeks: Record<string, number>
  total_hours: number
  first_week: string
  last_week: string
  assignments: Assignment[]
  /** ISO Monday -> name of who covers it, or null if nobody is named yet. */
  cover: Record<string, string | null>
  named_hours: number
  fill_pct: number
  unfilled_weeks: number
  unfilled_now_or_past: number
  unfilled_next_8_weeks: number
}

export interface PositionsResponse {
  positions: Position[]
  weeks: string[]
  error: string | null
  this_week: string
}

export interface RosterAssignment {
  id: string
  position_label: string
  project_name: string
  category: string
  start_date: string | null
  end_date: string | null
}

/** A person from Org Charts with the hours they're named to, week by week, across all projects. */
export interface RosterPerson {
  id: string
  name: string
  title: string
  department: string | null
  manager_id: string | null
  manager_name: string | null
  labor_category: string
  function: string | null
  capacity_hours: number
  load: Record<string, number>
  peak_pct: number
  over_weeks: number
  assignments: RosterAssignment[]
}

export interface RosterResponse {
  people: RosterPerson[]
  weeks: string[]
  error: string | null
  this_week: string
}

export interface Manager {
  id: string
  name: string
  title: string
  team_size: number
}

export interface FunctionRow {
  id: string
  name: string
  categories: string[]
  manager_id: string | null
  manager_name: string | null
  people_count: number
}

export interface FulfillmentBucket {
  positions: number
  positions_filled: number
  requested_hours: number
  named_hours: number
  requested_to_date: number
  named_to_date: number
  actual_to_date: number
}

export interface FulfillmentCategory extends FulfillmentBucket {
  category: string
}

export interface FulfillmentProject extends FulfillmentBucket {
  depot_project_id: string
  project_name: string
  phase: string | null
  categories: FulfillmentCategory[]
}

export interface OverloadWeek {
  week: string
  hours: number
  capacity: number
}

/** One row of real labor hours charged — mocked S4 data. */
export interface ActualLine {
  id: string
  employee: string
  role: string | null
  project: string
  portfolio: string | null
  charge_number: string | null
  period_start: string
  hours: number
  created_at: string
}
