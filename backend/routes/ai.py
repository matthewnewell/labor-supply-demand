"""
Labor Supply & Demand's Agent tab — a conversation with an assistant that can see the whole staffing
picture: what projects asked for, who is named to it, who is over-allocated, who has room, and how
requested hours compare to hours actually charged. Same shape as Good Plan's and MARTI's agents: the
frontend owns the conversation, this route rebuilds the context fresh on every call, so a person
named a moment ago is reflected immediately. Read-only — it explains and suggests; naming people is
done on the Staffing page.
"""

from datetime import date, timedelta

from flask import Blueprint, jsonify, request

import ai_client
import good_plan_client
import org_client
from models import ActualLine, Assignment
from staffing_math import overload, person_load, position_stats, this_monday

bp = Blueprint("ai", __name__, url_prefix="/api")

_SYSTEM = (
    "You help a functional manager staff projects. Projects ask for generic positions (a labor "
    "category with weekly hours); the manager names real people to them. Ground every answer in "
    "the staffing data below — never give generic resourcing advice unconnected to it. When asked "
    "who could fill a position, suggest specific people from the roster whose labor category "
    "matches, favoring those with the most room, and say what naming them would do to their load. "
    "Flag over-allocation plainly. If the data can't answer something, say so rather than "
    "guessing. You cannot assign people yourself; tell the user to do it on the Staffing page."
)

MAX_OPEN_LISTED = 30


def _context_lines() -> list[str]:
    positions, gp_err = good_plan_client.fetch_positions()
    roster, org_err = org_client.fetch_roster()
    if gp_err or org_err:
        return [f"Data problem: {gp_err or org_err}"]

    assignments = Assignment.query.all()
    by_pos: dict[str, list[Assignment]] = {}
    for a in assignments:
        by_pos.setdefault(a.position_id, []).append(a)
    pos_by_id = {p["id"]: p for p in positions}
    loads = person_load(assignments, pos_by_id)
    now = this_monday().isoformat()

    lines = [f"Today is {date.today().isoformat()} (week of {now}).", ""]

    # per project: requested vs named vs charged
    charged: dict[str, float] = {}
    for row in ActualLine.query.filter(ActualLine.period_start <= date.today()).all():
        charged[row.project] = charged.get(row.project, 0.0) + row.hours
    projects: dict[str, dict] = {}
    open_positions = []
    for p in positions:
        s = position_stats(p, by_pos.get(p["id"], []))
        proj = projects.setdefault(p["project_name"], {
            "phase": p.get("phase"), "n": 0, "filled": 0, "requested": 0.0, "named": 0.0, "to_date": 0.0,
        })
        proj["n"] += 1
        proj["filled"] += 1 if s["unfilled_weeks"] == 0 else 0
        proj["requested"] += p["total_hours"]
        proj["named"] += s["named_hours"]
        proj["to_date"] += sum(h for w, h in p["weeks"].items() if w <= now)
        if s["unfilled_weeks"]:
            open_positions.append((s["unfilled_now_or_past"], s["unfilled_next_8_weeks"], p, s))

    lines.append("Projects (positions fully named, hours requested vs named, hours charged so far vs requested so far):")
    for name, p in sorted(projects.items()):
        pursuit = " [PURSUIT: pipeline, not staffed until won]" if p["phase"] == "pursuit" else ""
        lines.append(
            f"  - {name}{pursuit}: {p['filled']}/{p['n']} positions named; {p['named']:,.0f} of {p['requested']:,.0f} h named; "
            f"{charged.get(name, 0):,.0f} h charged vs {p['to_date']:,.0f} h requested to date"
        )

    open_positions.sort(key=lambda t: (-t[0], -t[1]))
    lines += ["", f"Open positions (most urgent first; {len(open_positions)} have unfilled weeks):"]
    for behind, soon, p, s in open_positions[:MAX_OPEN_LISTED]:
        who = ", ".join(a.person_name for a in by_pos.get(p["id"], [])) or "nobody"
        urgency = f"{behind} wk underway/past" if behind else f"{soon} wk in next 8" if soon else "later"
        lines.append(
            f"  - {p['project_name']} — {p['label']} ({p['category']}): named to {who}; {s['fill_pct']:.0f}% named; "
            f"{s['unfilled_weeks']} open wk ({urgency}); {p['first_week']} to {p['last_week']}"
        )
    if len(open_positions) > MAX_OPEN_LISTED:
        lines.append(f"  ... and {len(open_positions) - MAX_OPEN_LISTED} more")

    # supply: everyone by category, with load
    lines += ["", "Roster by labor category (name, capacity h/wk, peak load %, weeks over capacity):"]
    by_cat: dict[str, list[dict]] = {}
    for person in roster:
        by_cat.setdefault(person["labor_category"], []).append(person)
    for cat, people in sorted(by_cat.items()):
        bits = []
        for person in sorted(people, key=lambda x: x["name"]):
            cap = person.get("capacity_hours") or 40.0
            load = loads.get(person["id"], {})
            peak = round(max(load.values(), default=0.0) / cap * 100)
            over = len(overload(load, cap))
            bits.append(f"{person['name']} ({cap:g}h, {peak}%{f', {over} wk over' if over else ''}; reports to {person['manager_name']})")
        lines.append(f"  {cat}: " + "; ".join(bits))
    return lines


@bp.post("/chat")
def chat():
    if not ai_client.is_configured():
        return jsonify({"error": ai_client.NOT_CONFIGURED_MESSAGE}), 200
    body = request.get_json(force=True) or {}
    messages = body.get("messages")
    if not messages or not isinstance(messages, list):
        return jsonify({"error": "messages (a non-empty list) is required"}), 400
    system = _SYSTEM + "\n\n" + "\n".join(_context_lines())
    return jsonify({"reply": ai_client.chat(messages=messages, system=system, max_tokens=1024)})
