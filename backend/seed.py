"""
Demo staffing — a functional manager's world, built from the OTHER apps' live data: the positions
projects have asked for in Good Plan, and the people on the roster in Org Charts. Because ids only
exist once those apps are seeded, this can't be a fixed table; `apply_demo_staffing()` reads both
and names people to positions, deliberately leaving it messy the way real staffing is:

  - most execution positions are named; the last position of each larger category is still open,
    and Radar's late machinist ramp-up has nobody yet (asked for, not got);
  - Sam Ortiz is the Program Manager on all three execution projects (as in the Depot), so his
    load runs over 1.0 FTE; Bruno Castillo is named to two mechanical positions at once, so he
    is double-booked for weeks;
  - the Coastal recompete is a pursuit: only its Program Manager is named;
  - hours actually charged over the last six weeks run a little under or over what was requested,
    and Radar's machinists charge well under — they were pulled elsewhere.

Idempotent in the sense that it REPLACES all assignments and actuals each time (demo data): safe to
re-run after Good Plan or Org Charts is re-seeded, which is when the old ids stop matching.
Run automatically at startup only if there are no assignments and both apps answer; otherwise by
hand: backend/refresh_demo.py.
"""

from datetime import date, timedelta

from charge_numbers import CHARGE_BASE
from db import db
from models import ActualLine, Assignment
import good_plan_client
import org_client
from staffing_math import this_monday

# (project, position label) -> person, where the story needs a specific name
_FORCED = {
    ("Bracket Assembly Project", "Program Manager"): "Sam Ortiz",
    ("Nacelle Fairing Retrofit", "Program Manager"): "Sam Ortiz",
    ("Radar Housing Production", "Program Manager"): "Sam Ortiz",
    ("Prospect: Coastal Patrol Recompete", "Program Manager #1"): "Tobias Ehrlich",
    ("Bracket Assembly Project", "Mechanical Engineer #1"): "Bruno Castillo",
    ("Radar Housing Production", "Mechanical Engineer #1"): "Bruno Castillo",
}
_FACTORS = [1.0, 0.95, 1.05, 0.9, 1.0, 0.85]


def apply_demo_staffing() -> dict:
    positions, gp_error = good_plan_client.fetch_positions()
    roster, org_error = org_client.fetch_roster()
    if gp_error or org_error or not positions or not roster:
        return {"skipped": gp_error or org_error or "no positions or roster yet"}

    managers, _ = org_client.fetch_managers()
    alex = next((m for m in managers if m["name"] == "Alex Chen"), None)
    alex_team = {p["id"] for p in org_client.fetch_roster(alex["id"])[0]} if alex else set()
    by_name = {p["name"]: p for p in roster}

    # Each category's pool, Alex Chen's own team first (he is the demo functional manager).
    pools: dict[str, list[dict]] = {}
    for p in sorted(roster, key=lambda p: (p["id"] not in alex_team, p["name"])):
        pools.setdefault(p["labor_category"], []).append(p)

    counts: dict[tuple[str, str], int] = {}
    for pos in positions:
        counts[(pos["depot_project_id"], pos["category"])] = counts.get((pos["depot_project_id"], pos["category"]), 0) + 1

    Assignment.query.delete()
    ActualLine.query.delete()
    seen: dict[tuple[str, str], int] = {}
    used: dict[str, int] = {}  # positions each person has been named to so far
    made = []
    order = sorted(positions, key=lambda p: (p.get("phase") == "pursuit", p["project_name"], p["category"], p["label"]))
    for pos in order:
        key = (pos["depot_project_id"], pos["category"])
        k, n = seen.get(key, 0), counts[key]
        seen[key] = k + 1

        forced = _FORCED.get((pos["project_name"], pos["label"]))
        if forced is None:
            if pos.get("phase") == "pursuit":
                continue  # a bid isn't staffed yet
            if n >= 3 and k == n - 1:
                continue  # the last position of a big category is still open
            if pos["project_name"] == "Radar Housing Production" and pos["category"] == "Machinist" and k >= 4:
                continue  # the late machinist ramp-up: asked for, nobody named yet
        person = by_name.get(forced) if forced else None
        if person is None:
            pool = pools.get(pos["category"])
            if not pool:
                continue
            # The least-loaded matching person (ties keep the pool order, Alex's team first), so
            # the only over-allocation left is the deliberate kind above.
            person = min(pool, key=lambda p: (used.get(p["id"], 0), pool.index(p)))
        used[person["id"]] = used.get(person["id"], 0) + 1
        a = Assignment(
            position_id=pos["id"], depot_project_id=pos["depot_project_id"], project_name=pos["project_name"],
            category=pos["category"], position_label=pos["label"], person_id=person["id"], person_name=person["name"],
        )
        db.session.add(a)
        made.append((a, pos))

    # Hours actually charged over the last six completed weeks, close to (but not exactly) the request.
    last_done = this_monday() - timedelta(weeks=1)
    first = this_monday() - timedelta(weeks=6)
    actuals = 0
    for i, (a, pos) in enumerate(made):
        base = CHARGE_BASE.get(pos["project_name"])
        if base is None:
            continue
        for j, (week, hours) in enumerate(sorted(pos["weeks"].items())):
            monday = date.fromisoformat(week)
            if not (first <= monday <= last_done):
                continue
            factor = 0.7 if (pos["project_name"] == "Radar Housing Production" and pos["category"] == "Machinist") else _FACTORS[(i + j) % len(_FACTORS)]
            db.session.add(ActualLine(
                employee=a.person_name, role=pos["category"], project=pos["project_name"],
                portfolio=pos.get("portfolio_name"), charge_number=f"{base}-{(pos.get('wbs') or '0').replace('.', '')}",
                period_start=monday, hours=round(hours * factor, 1),
            ))
            actuals += 1
    db.session.commit()
    return {"assignments": len(made), "actual_rows": actuals, "positions": len(positions), "open_positions": len(positions) - len(made)}


def seed_if_empty():
    """Best-effort at startup: if there are no assignments yet and both Good Plan and Org Charts
    answer, build the demo. If either is still starting, do nothing — refresh_demo.py does it."""
    if Assignment.query.first() is not None:
        return
    try:
        apply_demo_staffing()
    except Exception:  # noqa: BLE001 — a seed must never stop the app from starting
        db.session.rollback()
