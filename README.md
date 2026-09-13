# Labor Supply & Demand

Where a functional/resource manager sees labor demand rolled up across every project — read
live from Good Plan — and commits real people or headcount against it. Staffing only, the
organizational counterpart to Good Plan's own project-side demand.

## The idea

**Not a general organizational dashboard.** This was originally sketched under the working name
"Big Plan" — renamed once the org-level rollup job got carved out to Reckon (the future
project-execution dashboard, which scales from a single project's view up to a portfolio-wide
one on the same underlying data). This app does exactly one thing: staffing supply and demand.

**No local copy of demand — it's read live from Good Plan.** This is the first app in this
ecosystem whose core loop depends on another app's live API rather than the usual "tied only by
a plain-text project label" convention. It's still read-only and still no shared database — just
an HTTP call (`good_plan_client.py`) to Good Plan's own `GET /api/demand`, same trust model
Reckon will use for its own cross-app reads. If Good Plan isn't running, the board says so
plainly and falls back to showing committed supply alone, rather than pretending demand is zero.

**Commitment mirrors demand's shape on purpose.** A `Commitment` is a role/FTE/date range, same
as Good Plan's `DemandLine` — plus `assigned_to`, which can name a real person or be left blank
("headcount reserved, not yet named to an individual"). Both are honest, distinct states.

**No fake precision.** Demand and commitment lines for a role sit side by side, not summed into
one "% covered" number — that would claim a certainty about overlapping date ranges neither side
actually has. A person does the comparing; the board just makes it easy to see.

**Actuals are mocked S4 data, owned here.** Real hours an employee charged, per project and
charge number — a paste-in import, same convention as DWMP/DWMO's `/import` pages. This is the
labor half of what Reckon will eventually read for its ACWP calculation; owned here rather than
duplicated, since this is the natural place real headcount/hours land.

## Stack

Same as the rest of this ecosystem — Flask + SQLAlchemy + SQLite backend, React + TypeScript +
Vite frontend. `httpx` added specifically for the Good Plan read.

## Running locally

```bash
# backend (Good Plan should also be running at :8093 for demand to show up)
cd backend
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python app.py            # :8098, seeds demo commitments + actuals on first run

# frontend (separate terminal)
cd frontend
npm install
npm run dev                        # :5184, proxies /api to :8098
```

`GOOD_PLAN_URL` env var overrides where the demand read points (default
`http://localhost:8093`).

## Data model

- **Commitment** — `project`/`portfolio`, `role`, `fte`, `start_date`/`end_date`,
  `assigned_to` (nullable), `note`. The only supply record this app owns.
- **ActualLine** — `employee`, `role`, `project`/`portfolio`, `charge_number`, `period_start`,
  `hours`. One independent fact per row — no matching/merging logic, unlike DWMP/DWMO's
  evolving order/part lines.
- No `DemandLine` table — demand is always read live from Good Plan.

## API surface Reckon will use

Same convention as everywhere else — Reckon reads this app's `/api/actuals` (labor ACWP) the
way it reads Good Plan's `/api/demand` (BCWS) and Scope Manager's `/api/scope-items` (BCWP).
Never writes back.

## Status

v1 — the labor board (demand read live from Good Plan, commitments grouped by role alongside
it, add/delete), and an actuals import page with a paste-in mocked S4 extract. Seeded with
commitments and actuals across the same two demo projects Good Plan already declares demand
for — deliberately an incomplete supply picture (some roles fully committed to a named person,
some headcount-only, some under-committed, Quality Inspector on both projects entirely
uncommitted) so the board shows a real gap, not a solved puzzle.
