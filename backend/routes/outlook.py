"""
The Outlook: the big picture for senior leadership. Every project's labor, requested (Good Plan's
plans), named (this app's assignments) and actually charged (the S4 extract), by project and labor
category, week by week, against the headcount each category has (Org Charts). Unawarded work comes
with its P(Win) from WinMax, so the page can ask "if we win these, when do we run out of people?"

This route only gathers and joins; it doesn't weight, pick scenarios or decide when to hire. That
is the page's arithmetic (pages/OutlookPage.tsx), done live as the operator toggles wins.
"""

import os
from datetime import date, timedelta

from flask import Blueprint, jsonify

import good_plan_client
import org_client
import winmax_client
from models import ActualLine, Assignment
from staffing_math import coverage, monday_of, this_monday

bp = Blueprint("outlook", __name__, url_prefix="/api")

WINMAX_WEB = os.environ.get("WINMAX_WEB_URL", "http://localhost:5185").rstrip("/")
DEPOT_WEB = os.environ.get("DEPOT_WEB_URL", "http://localhost:5175").rstrip("/")
RECKON_WEB = os.environ.get("RECKON_WEB_URL", "http://localhost:5192").rstrip("/")
GOOD_PLAN_WEB = os.environ.get("GOOD_PLAN_WEB_URL", "http://localhost:5178").rstrip("/")


def _add(series: dict, week: str, hours: float):
    series[week] = round(series.get(week, 0.0) + hours, 2)


@bp.get("/outlook")
def outlook():
    positions, gp_error = good_plan_client.fetch_positions()
    people, org_error = org_client.fetch_roster()
    functions, _fn_error = org_client.fetch_functions()
    pursuits, wm_error = winmax_client.fetch_pursuits()

    by_pos: dict[str, list[Assignment]] = {}
    for a in Assignment.query.all():
        by_pos.setdefault(a.position_id, []).append(a)

    projects: dict[str, dict] = {}
    series: dict[tuple[str, str], dict] = {}

    def cell(project_id, category):
        return series.setdefault((project_id, category), {
            "project_id": project_id, "category": category, "plan": {}, "committed": {}, "actual": {},
        })

    for p in positions:
        pid = p["depot_project_id"]
        proj = projects.setdefault(pid, {
            "id": pid, "name": p["project_name"], "portfolio": p.get("portfolio_name"),
            "phase": p.get("phase"), "first_week": p["first_week"], "last_week": p["last_week"],
            "plan_hours": 0.0, "positions": 0, "open_positions": 0,
        })
        proj["first_week"] = min(proj["first_week"], p["first_week"])
        proj["last_week"] = max(proj["last_week"], p["last_week"])
        proj["plan_hours"] += p.get("total_hours") or sum(p["weeks"].values())
        proj["positions"] += 1
        cover = coverage(p, by_pos.get(p["id"], []))
        if any(who is None for who in cover.values()):
            proj["open_positions"] += 1
        s = cell(pid, p["category"])
        for w, h in p["weeks"].items():
            _add(s["plan"], w, h)
            if cover.get(w):
                _add(s["committed"], w, h)

    # Actuals are keyed by project NAME and the charger's role (their labor category).
    id_by_name = {proj["name"]: pid for pid, proj in projects.items()}
    for a in ActualLine.query.all():
        pid = id_by_name.get(a.project)
        if pid is None or not a.role:
            continue
        _add(cell(pid, a.role)["actual"], monday_of(a.period_start).isoformat(), a.hours)

    for pid, proj in projects.items():
        pursuit = pursuits.get(pid)
        proj["plan_hours"] = round(proj["plan_hours"], 1)
        proj["awarded"] = proj["phase"] not in ("pursuit", None) if not pursuit else False
        proj["pursuit"] = pursuit
        links = {"depot": f"{DEPOT_WEB}/projects/{pid}", "good_plan": GOOD_PLAN_WEB}
        if pursuit:
            links["winmax"] = f"{WINMAX_WEB}/pursuits/{pid}"
        if proj["awarded"]:
            links["reckon"] = RECKON_WEB
        proj["links"] = links

    categories: dict[str, dict] = {}
    for person in people:
        c = categories.setdefault(person["labor_category"], {
            "name": person["labor_category"], "function": person.get("function"), "headcount": 0, "capacity_hours": 0.0,
        })
        c["headcount"] += 1
        c["capacity_hours"] += person.get("capacity_hours") or 40.0
    for s in series.values():  # a category a plan asks for that nobody on the roster holds
        categories.setdefault(s["category"], {"name": s["category"], "function": None, "headcount": 0, "capacity_hours": 0.0})
    function_of = {cat: f["name"] for f in functions for cat in f.get("categories", [])}
    for c in categories.values():
        c["function"] = c["function"] or function_of.get(c["name"]) or "Other"

    all_weeks = sorted({w for s in series.values() for kind in ("plan", "actual") for w in s[kind]})
    weeks = []
    if all_weeks:
        d, last = date.fromisoformat(all_weeks[0]), date.fromisoformat(all_weeks[-1])
        while d <= last:
            weeks.append(d.isoformat())
            d += timedelta(weeks=1)

    return jsonify({
        "projects": sorted(projects.values(), key=lambda p: (not p["awarded"], p["first_week"])),
        "functions": sorted({c["function"] for c in categories.values()}),
        "categories": sorted(categories.values(), key=lambda c: (c["function"], c["name"])),
        "series": list(series.values()),
        "weeks": weeks,
        "this_week": this_monday().isoformat(),
        "errors": [e for e in (gp_error, org_error, wm_error) if e],
    })
