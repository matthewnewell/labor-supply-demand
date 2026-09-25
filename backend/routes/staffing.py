import os
from datetime import date, timedelta

from flask import Blueprint, jsonify, request

import depot_client
import good_plan_client
import org_client
from charge_numbers import charge_number_for
from db import db
from models import ActualLine, Assignment
from staffing_math import (
    assignment_weeks,
    monday_of,
    overload,
    person_load,
    position_stats,
    this_monday,
)

bp = Blueprint("staffing", __name__, url_prefix="/api")

FRONTEND_BASE_URL = os.environ.get("FRONTEND_BASE_URL", "http://localhost:5184")


def _date(value, field):
    if value in (None, ""):
        return None
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        raise ValueError(f"{field} must be an ISO date (YYYY-MM-DD)")


def _by_position(assignments) -> dict[str, list[Assignment]]:
    out: dict[str, list[Assignment]] = {}
    for a in assignments:
        out.setdefault(a.position_id, []).append(a)
    return out


def _week_range(positions: list[dict]) -> list[str]:
    """Every Monday from the earliest to the latest week any position has hours."""
    if not positions:
        return []
    first = date.fromisoformat(min(p["first_week"] for p in positions))
    last = date.fromisoformat(max(p["last_week"] for p in positions))
    weeks, d = [], first
    while d <= last:
        weeks.append(d.isoformat())
        d += timedelta(weeks=1)
    return weeks


# ── positions: what projects asked for, and who is named to it ───────────────────────────────
@bp.get("/positions")
def list_positions():
    """Good Plan's positions, each with the people named to it and how much of it is covered.
    `?project_id=` (a Depot project id) limits to one project. Unfilled positions are the point:
    a project asked for someone and nobody has been named yet."""
    positions, error = good_plan_client.fetch_positions(request.args.get("project_id"))
    by_pos = _by_position(Assignment.query.all())
    out = []
    for p in positions:
        assigned = sorted(by_pos.get(p["id"], []), key=lambda a: a.start_date or date.min)
        out.append({
            **p,
            "assignments": [a.to_dict() for a in assigned],
            **position_stats(p, assigned),
        })
    return jsonify({"positions": out, "weeks": _week_range(positions), "error": error, "this_week": this_monday().isoformat()})


# ── roster: the people, their load, and what they're named to ────────────────────────────────
@bp.get("/managers")
def list_managers():
    managers, error = org_client.fetch_managers()
    return jsonify({"managers": managers, "error": error})


@bp.get("/functions")
def list_functions():
    """The functional taxonomy, passed through from Org Charts — what the Staffing page scopes
    itself to (a Function and its designated manager), instead of an arbitrary manager pick."""
    functions, error = org_client.fetch_functions()
    return jsonify({"functions": functions, "error": error})


@bp.get("/my-scope")
def my_scope():
    """What the Staffing page should open to for the person who launched it — their OWN
    function(s), not an arbitrary pick or the whole company's open positions. `person_id` is a
    Depot persona id (see lib/person.ts on the frontend); resolved to a name, then matched
    against Org Charts' Function managers by that name (see depot_client's own doc comment for
    why it's name, not id). A manager can own more than one Function (Alex Chen owns two) —
    returns all of them. Empty `functions` is a normal answer (not a functional manager, or
    Org Charts/Depot didn't answer), and the frontend falls back to browsing everything."""
    person_id = request.args.get("person_id")
    if not person_id:
        return jsonify({"person_name": None, "functions": []})
    name = depot_client.fetch_person_name(person_id)
    if not name:
        return jsonify({"person_name": None, "functions": []})
    functions, _error = org_client.fetch_functions()
    mine = [f for f in functions if f.get("manager_name") == name]
    return jsonify({"person_name": name, "functions": mine})


@bp.get("/my-charges")
def my_charges():
    """What an individual is supposed to charge to, over time, and what they actually charged —
    for the Launchpad's own drawer tile (a person's answer, not a manager's). Same identity
    resolution as /my-scope, one step further: the resolved name has to also BE a roster
    person (an individual contributor with a labor category), not just a Function's manager —
    most of the six Depot personas are managers with no Assignment of their own, so an empty
    result here is a normal, expected answer for them, not a broken one."""
    person_id = request.args.get("person_id")
    name = depot_client.fetch_person_name(person_id) if person_id else None
    if not name:
        return jsonify({"person_name": None, "assignments": [], "actuals": []})

    person = org_client.fetch_person_by_name(name)
    positions, _gp_error = good_plan_client.fetch_positions()
    wbs_by_position = {p["id"]: p.get("wbs") for p in positions}

    assignments = []
    if person:
        rows = Assignment.query.filter_by(person_id=person["id"]).order_by(Assignment.project_name).all()
        for a in rows:
            assignments.append({
                **a.to_dict(),
                "charge_number": charge_number_for(a.project_name, wbs_by_position.get(a.position_id)),
            })

    actuals = [
        a.to_dict()
        for a in ActualLine.query.filter_by(employee=name).order_by(ActualLine.period_start.desc()).limit(20).all()
    ]
    return jsonify({"person_name": name, "assignments": assignments, "actuals": actuals})


@bp.get("/roster")
def roster():
    """People from Org Charts (`?function=` = that Function's people; `?manager_id=` = a
    reporting-line manager's team) with their weekly load across every project and what they're
    named to. This is the org view and the over-allocation view in one: load above capacity is
    flagged."""
    people, error = org_client.fetch_roster(
        request.args.get("manager_id"), request.args.get("category"), request.args.get("function"),
    )
    positions, gp_error = good_plan_client.fetch_positions()
    by_id = {p["id"]: p for p in positions}
    ids = {p["id"] for p in people}
    assignments = Assignment.query.filter(Assignment.person_id.in_(ids)).all() if ids else []
    loads = person_load(assignments, by_id)
    mine: dict[str, list[Assignment]] = {}
    for a in assignments:
        mine.setdefault(a.person_id, []).append(a)

    out = []
    for person in people:
        cap = person.get("capacity_hours") or 40.0
        load = {w: round(h, 2) for w, h in loads.get(person["id"], {}).items()}
        peak = max(load.values(), default=0.0)
        out.append({
            **person,
            "load": load,
            "peak_pct": round(peak / cap * 100, 0),
            "over_weeks": len(overload(load, cap)),
            "assignments": [
                {
                    "id": a.id, "position_label": a.position_label, "project_name": a.project_name,
                    "category": a.category, "start_date": a.start_date.isoformat() if a.start_date else None,
                    "end_date": a.end_date.isoformat() if a.end_date else None,
                }
                for a in mine.get(person["id"], [])
            ],
        })
    return jsonify({"people": out, "weeks": _week_range(positions), "error": error or gp_error, "this_week": this_monday().isoformat()})


# ── assignments: the answer a functional manager gives ───────────────────────────────────────
def _conflict(position: dict, start, end, others: list[Assignment]) -> str | None:
    new = set(assignment_weeks(position["weeks"], start, end))
    for other in others:
        clash = new & set(assignment_weeks(position["weeks"], other.start_date, other.end_date))
        if clash:
            return f"{other.person_name} is already named to {len(clash)} of those weeks of this position"
    return None


def _load_for(person_id: str, capacity: float) -> list[dict]:
    positions, _ = good_plan_client.fetch_positions()
    by_id = {p["id"]: p for p in positions}
    load = person_load(Assignment.query.filter_by(person_id=person_id).all(), by_id).get(person_id, {})
    return overload(load, capacity)


@bp.get("/assignments")
def list_assignments():
    q = Assignment.query
    if person_id := request.args.get("person_id"):
        q = q.filter_by(person_id=person_id)
    if position_id := request.args.get("position_id"):
        q = q.filter_by(position_id=position_id)
    return jsonify([a.to_dict() for a in q.order_by(Assignment.project_name, Assignment.position_label).all()])


@bp.post("/assignments")
def create_assignment():
    """Name a person to a position: `{position_id, person_id, start_date?, end_date?, note?}`.
    The person must be on the Org Charts roster with the position's labor category — a project asks
    for a generic resource and the functional manager supplies a name that fits it. Two people can't
    cover the same week of one position. Going over the person's capacity is allowed (it happens)
    but reported back in `overload` so the manager sees it."""
    body = request.get_json(force=True) or {}
    position_id, person_id = body.get("position_id"), body.get("person_id")
    if not position_id or not person_id:
        return jsonify({"error": "position_id and person_id are required"}), 400
    try:
        start, end = _date(body.get("start_date"), "start_date"), _date(body.get("end_date"), "end_date")
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    if start and end and end < start:
        return jsonify({"error": "end_date cannot be before start_date"}), 400

    positions, gp_error = good_plan_client.fetch_positions()
    if gp_error:
        return jsonify({"error": gp_error}), 503
    position = next((p for p in positions if p["id"] == position_id), None)
    if position is None:
        return jsonify({"error": "that position isn't in Good Plan (it may have been removed)"}), 404

    roster_people, org_error = org_client.fetch_roster()
    if org_error:
        return jsonify({"error": org_error}), 503
    person = next((p for p in roster_people if p["id"] == person_id), None)
    if person is None:
        return jsonify({"error": "that person isn't on the Org Charts labor roster"}), 400
    if person["labor_category"] != position["category"]:
        return jsonify({"error": f"{person['name']} is a {person['labor_category']}; this position asks for a {position['category']}"}), 400

    if not assignment_weeks(position["weeks"], start, end):
        return jsonify({"error": "those dates don't cover any week of this position"}), 400
    if clash := _conflict(position, start, end, Assignment.query.filter_by(position_id=position_id).all()):
        return jsonify({"error": clash}), 400

    a = Assignment(
        position_id=position_id, depot_project_id=position.get("depot_project_id"),
        project_name=position["project_name"], category=position["category"], position_label=position["label"],
        person_id=person["id"], person_name=person["name"], start_date=start, end_date=end,
        note=(body.get("note") or "").strip() or None,
    )
    db.session.add(a)
    db.session.commit()
    return jsonify({**a.to_dict(), "overload": _load_for(person["id"], person.get("capacity_hours") or 40.0)}), 201


@bp.put("/assignments/<assignment_id>")
def update_assignment(assignment_id):
    a = Assignment.query.get_or_404(assignment_id)
    body = request.get_json(force=True) or {}
    try:
        start = _date(body["start_date"], "start_date") if "start_date" in body else a.start_date
        end = _date(body["end_date"], "end_date") if "end_date" in body else a.end_date
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    if start and end and end < start:
        return jsonify({"error": "end_date cannot be before start_date"}), 400
    positions, _ = good_plan_client.fetch_positions()
    position = next((p for p in positions if p["id"] == a.position_id), None)
    if position is not None:
        others = [o for o in Assignment.query.filter_by(position_id=a.position_id).all() if o.id != a.id]
        if clash := _conflict(position, start, end, others):
            return jsonify({"error": clash}), 400
    a.start_date, a.end_date = start, end
    if "note" in body:
        a.note = (body["note"] or "").strip() or None
    db.session.commit()
    return jsonify(a.to_dict())


@bp.delete("/assignments/<assignment_id>")
def delete_assignment(assignment_id):
    a = Assignment.query.get_or_404(assignment_id)
    db.session.delete(a)
    db.session.commit()
    return "", 204


# ── fulfillment: what was asked for, what was named, what was actually worked ────────────────
@bp.get("/fulfillment")
def fulfillment():
    """Per project (and per labor category within it): the hours requested in Good Plan, the hours
    covered by a named person, and — up to now — the hours actually charged. Requested vs named
    shows what a project asked for but didn't get people for; requested vs actual to date shows
    what it asked for but didn't get worked."""
    positions, error = good_plan_client.fetch_positions()
    by_pos = _by_position(Assignment.query.all())
    now = this_monday().isoformat()

    actual_rows = ActualLine.query.filter(ActualLine.period_start <= monday_of(date.today()) + timedelta(days=6)).all()
    actual: dict[tuple[str, str], float] = {}
    for row in actual_rows:
        key = (row.project, row.role or "Unspecified")
        actual[key] = actual.get(key, 0.0) + row.hours

    projects: dict[str, dict] = {}
    for p in positions:
        proj = projects.setdefault(p["depot_project_id"], {
            "depot_project_id": p["depot_project_id"], "project_name": p["project_name"], "phase": p.get("phase"),
            "positions": 0, "positions_filled": 0, "requested_hours": 0.0, "named_hours": 0.0,
            "requested_to_date": 0.0, "named_to_date": 0.0, "categories": {},
        })
        stats = position_stats(p, by_pos.get(p["id"], []))
        req_to_date = sum(h for w, h in p["weeks"].items() if w <= now)
        named_to_date = sum(h for w, h in p["weeks"].items() if w <= now and stats["cover"].get(w))
        cat = proj["categories"].setdefault(p["category"], {
            "category": p["category"], "positions": 0, "positions_filled": 0, "requested_hours": 0.0,
            "named_hours": 0.0, "requested_to_date": 0.0, "named_to_date": 0.0,
        })
        for bucket in (proj, cat):
            bucket["positions"] += 1
            bucket["positions_filled"] += 1 if stats["unfilled_weeks"] == 0 else 0
            bucket["requested_hours"] += p["total_hours"]
            bucket["named_hours"] += stats["named_hours"]
            bucket["requested_to_date"] += req_to_date
            bucket["named_to_date"] += named_to_date

    out = []
    for proj in projects.values():
        cats = []
        for c in proj["categories"].values():
            c["actual_to_date"] = round(actual.get((proj["project_name"], c["category"]), 0.0), 1)
            cats.append({k: (round(v, 1) if isinstance(v, float) else v) for k, v in c.items()})
        proj["actual_to_date"] = round(sum(c["actual_to_date"] for c in cats), 1)
        proj["categories"] = sorted(cats, key=lambda c: c["category"])
        out.append({k: (round(v, 1) if isinstance(v, float) else v) for k, v in proj.items()})
    out.sort(key=lambda p: p["project_name"])
    return jsonify({"projects": out, "error": error, "this_week": now})


# ── the Depot's project tile ─────────────────────────────────────────────────────────────────
@bp.get("/summary")
def summary():
    """The Launchpad's app-summary contract — this app's tile on a project's page in Conway's Depot.
    `project_id` is the Depot project id (Good Plan positions carry it). Headline: how many of the
    project's positions are fully named. Red if work is underway with nobody named to it, yellow if
    a position goes unstaffed in the next eight weeks."""
    project_id = request.args.get("project_id")
    positions, _ = good_plan_client.fetch_positions(project_id)
    # No positions: the Outlook (home). Otherwise: that project's positions on the Allocations page.
    href = f"{FRONTEND_BASE_URL}/"
    project_href = f"{FRONTEND_BASE_URL}/allocations?project={project_id}"
    if not positions:
        return jsonify({"headline": None, "label": "No labor requested yet", "status": None, "href": href})
    if all(p.get("phase") == "pursuit" for p in positions):
        # A bid isn't staffed until it's won: this is pipeline demand, not a gap.
        return jsonify({
            "headline": str(len(positions)), "label": "positions requested · pipeline, staffed if the bid is won",
            "status": None, "href": project_href,
        })
    by_pos = _by_position(Assignment.query.all())
    filled = now_gap = soon_gap = 0
    for p in positions:
        s = position_stats(p, by_pos.get(p["id"], []))
        filled += 1 if s["unfilled_weeks"] == 0 else 0
        now_gap += 1 if s["unfilled_now_or_past"] else 0
        soon_gap += 1 if s["unfilled_next_8_weeks"] else 0
    open_n = len(positions) - filled
    status = "critical" if now_gap else "warn" if soon_gap else "ok"
    label = "positions fully named" + (f" · {open_n} still open" if open_n else "")
    return jsonify({"headline": f"{filled}/{len(positions)}", "label": label, "status": status, "href": project_href})
