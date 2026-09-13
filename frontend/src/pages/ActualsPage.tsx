import { useMemo, useState } from 'react'
import { useActuals, useImportActuals } from '../api/hooks'
import './ActualsPage.css'

const HEADER_MAP: Record<string, string> = {
  employee: 'employee', name: 'employee',
  role: 'role', title: 'role',
  project: 'project',
  portfolio: 'portfolio',
  'charge number': 'charge_number', 'charge_number': 'charge_number', charge: 'charge_number',
  period: 'period_start', 'period start': 'period_start', 'period_start': 'period_start',
  week: 'period_start', date: 'period_start',
  hours: 'hours', hrs: 'hours',
}

type Row = Record<string, string>

/** Turns pasted, tab- or comma-separated text (first row = headers) into import rows — same
 * on-demand-pull convention as DWMP/DWMO: paste what the S4 report gave you. Mocked for now;
 * a real S4 extract would land here the same shape. */
function parseExtract(text: string): { rows: Row[]; unknownColumns: string[] } {
  const lines = text.trim().split(/\r?\n/).filter((l) => l.trim())
  if (lines.length < 2) return { rows: [], unknownColumns: [] }

  const delim = lines[0].includes('\t') ? '\t' : ','
  const headers = lines[0].split(delim).map((h) => h.trim().toLowerCase())
  const unknownColumns: string[] = []
  const fields = headers.map((h) => {
    const mapped = HEADER_MAP[h]
    if (!mapped) unknownColumns.push(h)
    return mapped
  })

  const rows: Row[] = []
  for (const line of lines.slice(1)) {
    const cells = line.split(delim)
    const row: Row = {}
    fields.forEach((field, i) => {
      if (field && cells[i] !== undefined) row[field] = cells[i].trim()
    })
    if (row.employee && row.project && row.period_start && row.hours) rows.push(row)
  }
  return { rows, unknownColumns }
}

export default function ActualsPage() {
  const [text, setText] = useState('')
  const [sourceLabel, setSourceLabel] = useState('S4 labor extract')
  const importActuals = useImportActuals()
  const { data: actuals } = useActuals()

  const { rows, unknownColumns } = useMemo(() => parseExtract(text), [text])

  function handleImport() {
    if (rows.length === 0) return
    importActuals.mutate(
      { source_label: sourceLabel.trim() || undefined, rows },
      { onSuccess: () => setText('') },
    )
  }

  const sorted = useMemo(
    () => [...(actuals ?? [])].sort((a, b) => b.period_start.localeCompare(a.period_start)),
    [actuals],
  )

  return (
    <div className="actuals-page">
      <div className="actuals-page__inner">
        <h1 className="actuals-page__title">Import actuals</h1>
        <p className="actuals-page__hint">
          Paste real labor hours the way they'd come out of S4 — employee, role, project, charge
          number, the period, and hours — one row per charge, with a header row. Tab- or
          comma-separated both work. Mocked for now; a real S4 extract would land here the same
          shape.
        </p>

        <label className="actuals-page__field">
          <span>Source label</span>
          <input value={sourceLabel} onChange={(e) => setSourceLabel(e.target.value)} />
        </label>

        <label className="actuals-page__field">
          <span>Paste extract</span>
          <textarea
            className="actuals-page__textarea"
            rows={8}
            placeholder={'Employee\tRole\tProject\tCharge Number\tPeriod\tHours\nPriya Nair\tMechanical Engineer\tDemo: Bracket Assembly Program\tCN-4471-10\t2026-09-01\t40'}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>

        {text.trim() && (
          <div className="actuals-page__preview">
            <p>
              {rows.length} row{rows.length === 1 ? '' : 's'} recognized
              {unknownColumns.length > 0 && <> · ignored columns: {unknownColumns.join(', ')}</>}
            </p>
            {rows.length > 0 && (
              <table className="import-preview-table">
                <thead>
                  <tr><th>Employee</th><th>Role</th><th>Project</th><th>Period</th><th>Hours</th></tr>
                </thead>
                <tbody>
                  {rows.slice(0, 8).map((r, i) => (
                    <tr key={i}>
                      <td>{r.employee}</td><td>{r.role ?? ''}</td><td>{r.project}</td>
                      <td>{r.period_start}</td><td>{r.hours}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {rows.length > 8 && <p className="actuals-page__more">…and {rows.length - 8} more</p>}
          </div>
        )}

        <button
          className="lsd-btn lsd-btn--primary"
          disabled={rows.length === 0 || importActuals.isPending}
          onClick={handleImport}
        >
          {importActuals.isPending ? 'Importing…' : `Import ${rows.length || ''} row${rows.length === 1 ? '' : 's'}`}
        </button>

        <section className="actuals-page__history">
          <h2 className="actuals-page__history-title">Recorded actuals</h2>
          {sorted.length === 0 ? (
            <p className="actuals-page__empty">None yet.</p>
          ) : (
            <table className="actuals-table">
              <thead>
                <tr>
                  <th>Employee</th><th>Role</th><th>Project</th><th>Charge #</th>
                  <th>Period</th><th className="actuals-table__num">Hours</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((a) => (
                  <tr key={a.id}>
                    <td>{a.employee}</td>
                    <td>{a.role ?? ''}</td>
                    <td>{a.project}</td>
                    <td className="actuals-table__mono">{a.charge_number ?? ''}</td>
                    <td>{a.period_start}</td>
                    <td className="actuals-table__num">{a.hours}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </div>
  )
}
