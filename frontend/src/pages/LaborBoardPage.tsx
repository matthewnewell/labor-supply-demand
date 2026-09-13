import { useMemo, useState } from 'react'
import {
  useCommitments,
  useCreateCommitment,
  useDeleteCommitment,
  useDemand,
  useProjects,
  useRoles,
} from '../api/hooks'
import type { Commitment, DemandLine } from '../api/types'
import './LaborBoardPage.css'

/** Demand (read live from Good Plan) and committed supply (owned here), grouped by role so the
 * two sit side by side and a functional manager can compare them directly. Deliberately no
 * computed "% covered" number — summing FTE across lines with different, possibly-overlapping
 * date ranges would claim a precision neither side of this comparison actually has, the same
 * "no fake precision" rule Good Plan itself follows for demand alone. The raw lines, grouped,
 * are the honest thing; a person does the comparing. */
export default function LaborBoardPage() {
  const [project, setProject] = useState('')
  const { data: projects } = useProjects()
  const { data: roles } = useRoles()
  const { data: demandResp, isLoading: demandLoading } = useDemand({ project: project || undefined })
  const { data: commitments, isLoading: commitmentsLoading } = useCommitments({ project: project || undefined })
  const deleteCommitment = useDeleteCommitment()

  const [composing, setComposing] = useState<string | null>(null) // role being composed for, or null

  const byRole = useMemo(() => {
    const roleSet = new Set<string>()
    const demandByRole = new Map<string, DemandLine[]>()
    const commitByRole = new Map<string, Commitment[]>()

    for (const d of demandResp?.lines ?? []) {
      roleSet.add(d.role)
      if (!demandByRole.has(d.role)) demandByRole.set(d.role, [])
      demandByRole.get(d.role)!.push(d)
    }
    for (const c of commitments ?? []) {
      roleSet.add(c.role)
      if (!commitByRole.has(c.role)) commitByRole.set(c.role, [])
      commitByRole.get(c.role)!.push(c)
    }

    return [...roleSet].sort().map((role) => ({
      role,
      demand: demandByRole.get(role) ?? [],
      committed: commitByRole.get(role) ?? [],
    }))
  }, [demandResp, commitments])

  const loading = demandLoading || commitmentsLoading

  return (
    <div className="labor-board">
      <div className="labor-board__inner">
        <header className="labor-board__header">
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">All projects</option>
            {(projects ?? []).map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
        </header>

        {demandResp?.error && (
          <p className="labor-board__error">
            {demandResp.error} Showing committed supply only until it's reachable again.
          </p>
        )}

        {loading && <p className="labor-board__empty">Loading…</p>}

        {!loading && byRole.length === 0 && (
          <p className="labor-board__empty">Nothing demanded or committed yet.</p>
        )}

        {byRole.map(({ role, demand, committed }) => (
          <section className="role-section" key={role}>
            <h2 className="role-section__title">{role}</h2>
            <div className="role-section__columns">
              <div className="role-column">
                <div className="role-column__label">Demand <span>(from Good Plan)</span></div>
                {demand.length === 0 ? (
                  <p className="role-column__empty">None</p>
                ) : (
                  <ul className="line-list">
                    {demand.map((d) => (
                      <li className="line-card" key={d.id}>
                        <div className="line-card__top">
                          <span className="line-card__fte">{d.fte} FTE</span>
                          <span className="line-card__project">{d.project}</span>
                        </div>
                        <div className="line-card__dates">{d.start_date} → {d.end_date}</div>
                        {d.note && <div className="line-card__note">{d.note}</div>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              <div className="role-column">
                <div className="role-column__label">Committed</div>
                {committed.length === 0 ? (
                  <p className="role-column__empty">None</p>
                ) : (
                  <ul className="line-list">
                    {committed.map((c) => (
                      <li className="line-card line-card--committed" key={c.id}>
                        <div className="line-card__top">
                          <span className="line-card__fte">{c.fte} FTE</span>
                          <span className="line-card__project">{c.project}</span>
                          <button
                            className="line-card__delete"
                            title="Remove this commitment"
                            onClick={() => deleteCommitment.mutate(c.id)}
                          >
                            ✕
                          </button>
                        </div>
                        <div className="line-card__dates">{c.start_date} → {c.end_date}</div>
                        <div className="line-card__assigned">
                          {c.assigned_to ?? <em>headcount reserved, not yet named</em>}
                        </div>
                        {c.note && <div className="line-card__note">{c.note}</div>}
                      </li>
                    ))}
                  </ul>
                )}
                {composing === role ? (
                  <CommitForm
                    role={role}
                    defaultProject={project}
                    projects={projects ?? []}
                    onDone={() => setComposing(null)}
                  />
                ) : (
                  <button className="lsd-btn lsd-btn--ghost role-column__add" onClick={() => setComposing(role)}>
                    + Commit
                  </button>
                )}
              </div>
            </div>
          </section>
        ))}

        {composing === '__new__' ? (
          <CommitForm role="" defaultProject={project} projects={projects ?? []} roles={roles ?? []} onDone={() => setComposing(null)} />
        ) : (
          <button className="lsd-btn lsd-btn--primary labor-board__add-new" onClick={() => setComposing('__new__')}>
            + Commit to a new role
          </button>
        )}
      </div>
    </div>
  )
}

function CommitForm({
  role,
  defaultProject,
  projects,
  roles,
  onDone,
}: {
  role: string
  defaultProject: string
  projects: string[]
  roles?: string[]
  onDone: () => void
}) {
  const createCommitment = useCreateCommitment()
  const [form, setForm] = useState({
    project: defaultProject, portfolio: '', role, fte: '1',
    start_date: '', end_date: '', assigned_to: '', note: '',
  })

  function submit() {
    const fte = parseFloat(form.fte)
    if (!form.project.trim() || !form.role.trim() || !form.start_date || !form.end_date || !(fte > 0)) return
    createCommitment.mutate(
      {
        project: form.project.trim(),
        portfolio: form.portfolio.trim() || undefined,
        role: form.role.trim(),
        fte,
        start_date: form.start_date,
        end_date: form.end_date,
        assigned_to: form.assigned_to.trim() || undefined,
        note: form.note.trim() || undefined,
      },
      { onSuccess: onDone },
    )
  }

  return (
    <div className="commit-form">
      <div className="commit-form__row">
        <input
          list="lsd-projects"
          placeholder="Project"
          value={form.project}
          onChange={(e) => setForm((f) => ({ ...f, project: e.target.value }))}
        />
        <datalist id="lsd-projects">
          {projects.map((p) => <option key={p} value={p} />)}
        </datalist>
        {!role && (
          <>
            <input
              list="lsd-roles"
              placeholder="Role"
              value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
            />
            <datalist id="lsd-roles">
              {(roles ?? []).map((r) => <option key={r} value={r} />)}
            </datalist>
          </>
        )}
        <input
          type="number" min="0.05" step="0.05"
          value={form.fte}
          onChange={(e) => setForm((f) => ({ ...f, fte: e.target.value }))}
        />
      </div>
      <div className="commit-form__row">
        <input type="date" value={form.start_date} onChange={(e) => setForm((f) => ({ ...f, start_date: e.target.value }))} />
        <input type="date" value={form.end_date} onChange={(e) => setForm((f) => ({ ...f, end_date: e.target.value }))} />
        <input
          placeholder="Assigned to (optional — leave blank for headcount only)"
          value={form.assigned_to}
          onChange={(e) => setForm((f) => ({ ...f, assigned_to: e.target.value }))}
        />
      </div>
      <input
        placeholder="Note (optional)"
        value={form.note}
        onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
      />
      <div className="commit-form__actions">
        <button className="lsd-btn lsd-btn--primary" onClick={submit} disabled={createCommitment.isPending}>
          {createCommitment.isPending ? 'Committing…' : 'Commit'}
        </button>
        <button className="lsd-btn lsd-btn--ghost" onClick={onDone}>Cancel</button>
      </div>
      {createCommitment.isError && (
        <p className="commit-form__error">{(createCommitment.error as Error)?.message ?? 'Could not add that commitment.'}</p>
      )}
    </div>
  )
}
