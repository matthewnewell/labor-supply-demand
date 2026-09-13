import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from './client'
import type { ActualLine, Commitment, DemandResponse } from './types'

// ── Demand (read-only proxy onto Good Plan) ─────────────────────────────────────────────────

export function useDemand(filters?: { project?: string; portfolio?: string }) {
  const params = new URLSearchParams()
  if (filters?.project) params.set('project', filters.project)
  if (filters?.portfolio) params.set('portfolio', filters.portfolio)
  const qs = params.toString()
  return useQuery({
    queryKey: ['demand', filters?.project ?? null, filters?.portfolio ?? null],
    queryFn: () => api.get<DemandResponse>(`/demand${qs ? `?${qs}` : ''}`),
    refetchInterval: 30_000,
  })
}

export function useProjects() {
  return useQuery({
    queryKey: ['projects'],
    queryFn: () => api.get<string[]>('/projects'),
  })
}

export function useRoles() {
  return useQuery({
    queryKey: ['roles'],
    queryFn: () => api.get<string[]>('/roles'),
  })
}

// ── Commitments ──────────────────────────────────────────────────────────────────────────────

export function useCommitments(filters?: { project?: string; role?: string }) {
  const params = new URLSearchParams()
  if (filters?.project) params.set('project', filters.project)
  if (filters?.role) params.set('role', filters.role)
  const qs = params.toString()
  return useQuery({
    queryKey: ['commitments', filters?.project ?? null, filters?.role ?? null],
    queryFn: () => api.get<Commitment[]>(`/commitments${qs ? `?${qs}` : ''}`),
  })
}

function useInvalidateCommitments() {
  const qc = useQueryClient()
  return () => {
    qc.invalidateQueries({ queryKey: ['commitments'] })
    qc.invalidateQueries({ queryKey: ['roles'] })
  }
}

export function useCreateCommitment() {
  const invalidate = useInvalidateCommitments()
  return useMutation({
    mutationFn: (data: {
      project: string
      portfolio?: string
      role: string
      fte: number
      start_date: string
      end_date: string
      assigned_to?: string
      note?: string
    }) => api.post<Commitment>('/commitments', data),
    onSuccess: invalidate,
  })
}

export function useUpdateCommitment() {
  const invalidate = useInvalidateCommitments()
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Omit<Commitment, 'id' | 'created_at'>> }) =>
      api.put<Commitment>(`/commitments/${id}`, data),
    onSuccess: invalidate,
  })
}

export function useDeleteCommitment() {
  const invalidate = useInvalidateCommitments()
  return useMutation({
    mutationFn: (id: string) => api.del(`/commitments/${id}`),
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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['actuals'] }),
  })
}
