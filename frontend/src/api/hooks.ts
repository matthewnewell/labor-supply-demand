import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type {
  ActualLine,
  Assignment,
  FulfillmentProject,
  Manager,
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

/** The people (from Org Charts) with their load. `managerId` = that functional manager's team. */
export function useRoster(managerId?: string) {
  return useQuery({
    queryKey: ['roster', managerId ?? 'all'],
    queryFn: () => api.get<RosterResponse>(`/roster${managerId ? `?manager_id=${encodeURIComponent(managerId)}` : ''}`),
    refetchInterval: 60_000,
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
