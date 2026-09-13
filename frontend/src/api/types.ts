/** One line of labor demand — read live from Good Plan, not owned here. Same shape as Good
 * Plan's own DemandLine, minus `note`'s guaranteed presence (it's whatever Good Plan sends). */
export interface DemandLine {
  id: string
  project: string
  portfolio: string | null
  role: string
  fte: number
  start_date: string
  end_date: string
  note: string | null
  created_at: string
}

export interface DemandResponse {
  lines: DemandLine[]
  error: string | null
}

/** One line of committed supply — the actual record this app owns. See backend/models.py. */
export interface Commitment {
  id: string
  project: string
  portfolio: string | null
  role: string
  fte: number
  start_date: string
  end_date: string
  assigned_to: string | null
  note: string | null
  created_at: string
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
