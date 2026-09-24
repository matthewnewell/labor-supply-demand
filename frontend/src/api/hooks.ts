import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type {
  ActualLine,
  Assignment,
  FulfillmentProject,
  FunctionRow,
  Manager,
  OutlookResponse,
  OverloadWeek,
  PositionsResponse,
  RosterResponse,
} from './types'

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => api.get<{ status: string; ai_configured: boolean }>('/health'),
    staleTime: 60_000,
  })
}

// ── Positions (Good Plan's requests) and who is named to them ────────────────────────────────

export function usePositions() {
  return useQuery({
    queryKey: ['positions'],
    queryFn: () => api.get<PositionsResponse>('/positions'),
    refetchInterval: 60_000,
  })
}

export function useManagers() {
  return useQuery({
    queryKey: ['managers'],
    queryFn: () => api.get<{ managers: Manager[]; error: string | null }>('/managers'),
    staleTime: 60_000,
  })
}

/** The people (from Org Charts) with their load. `managerId` = a reporting-line manager's team;
 * `functionName` = everyone whose category rolls up into that Function — the cut a Functional
 * Manager actually assigns from. */
export function useRoster(managerId?: string, functionName?: string) {
  const params = new URLSearchParams()
  if (managerId) params.set('manager_id', managerId)
  if (functionName) params.set('function', functionName)
  const qs = params.toString()
  return useQuery({
    queryKey: ['roster', managerId ?? 'all', functionName ?? 'all'],
    queryFn: () => api.get<RosterResponse>(`/roster${qs ? `?${qs}` : ''}`),
    refetchInterval: 60_000,
  })
}

/** The functional taxonomy — one Function per named discipline, each with its designated
 * manager. What "Staffing as" scopes to now, instead of an arbitrary manager pick. */
export function useFunctions() {
  return useQuery({
    queryKey: ['functions'],
    queryFn: () => api.get<{ functions: FunctionRow[]; error: string | null }>('/functions'),
    staleTime: 60_000,
  })
}

/** What the Staffing page should open to for whoever launched it — their own Function(s), by
 * name, resolved from the Depot person_id the Launchpad hands over. Empty is normal (not a
 * functional manager, or nobody's identified) and just means "start on the wide view instead." */
export function useMyScope(personId: string | undefined) {
  return useQuery({
    queryKey: ['my-scope', personId ?? 'none'],
    queryFn: () => api.get<{ person_name: string | null; functions: FunctionRow[] }>(`/my-scope?person_id=${encodeURIComponent(personId ?? '')}`),
    enabled: !!personId,
    staleTime: 60_000,
  })
}

/** A one-shot Agent opinion on a single open position — "who could fill this without creating a
 * gap or overlap for them" — surfaced inline on the Staffing page instead of a chat round-trip. */
export function useSuggest() {
  return useMutation({
    mutationFn: (positionId: string) => api.post<{ reply: string; error?: string }>(`/positions/${positionId}/suggest`, {}),
  })
}

export function useFulfillment() {
  return useQuery({
    queryKey: ['fulfillment'],
    queryFn: () => api.get<{ projects: FulfillmentProject[]; error: string | null; this_week: string }>('/fulfillment'),
    refetchInterval: 60_000,
  })
}

/** An assignment changes positions, the roster's load, and fulfillment all at once. */
function useInvalidateStaffing() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['positions'] })
    qc.invalidateQueries({ queryKey: ['roster'] })
    qc.invalidateQueries({ queryKey: ['fulfillment'] })
  }
}

export function useAssign() {
  const invalidate = useInvalidateStaffing()
  return useMutation({
    mutationFn: (data: { position_id: string; person_id: string; start_date?: string; end_date?: string; note?: string }) =>
      api.post<Assignment & { overload: OverloadWeek[] }>('/assignments', data),
    onSuccess: invalidate,
  })
}

export function useUnassign() {
  const invalidate = useInvalidateStaffing()
  return useMutation({
    mutationFn: (id: string) => api.del(`/assignments/${id}`),
    onSuccess: invalidate,
  })
}

// ── Actuals ──────────────────────────────────────────────────────────────────────────────────

export function useActuals(filters?: { project?: string; employee?: string }) {
  const params = new URLSearchParams()
  if (filters?.project) params.set('project', filters.project)
  if (filters?.employee) params.set('employee', filters.employee)
  const qs = params.toString()
  return useQuery({
    queryKey: ['actuals', filters?.project ?? null, filters?.employee ?? null],
    queryFn: () => api.get<ActualLine[]>(`/actuals${qs ? `?${qs}` : ''}`),
  })
}

export function useImportActuals() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: { source_label?: string; rows: Record<string, string>[] }) =>
      api.post<ActualLine[]>('/actuals/import', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['actuals'] })
      qc.invalidateQueries({ queryKey: ['fulfillment'] })
    },
  })
}

// ── Outlook: the big picture ──────────────────────────────────────────────────────────────────

export function useOutlook() {
  return useQuery({
    queryKey: ['outlook'],
    queryFn: () => api.get<OutlookResponse>('/outlook'),
    refetchInterval: 60_000,
  })
}
