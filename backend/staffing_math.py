"""
The arithmetic of staffing, kept out of the routes so it's easy to test: which weeks an assignment
covers, who is named on each week of a position, and how loaded each person is week by week.
Positions are Good Plan's dicts ({"weeks": {iso Monday: hours}, ...}); assignments are anything with
person_id / person_name / start_date / end_date.
"""

from datetime import date, timedelta


def monday_of(d: date) -> date:
    return d - timedelta(days=d.weekday())


def this_monday() -> date:
    return monday_of(date.today())


def assignment_weeks(position_weeks: dict[str, float], start: date | None, end: date | None) -> list[str]:
    """The position's weeks an assignment covers. A week counts if any part of it falls inside
    [start, end] — a person starting on a Wednesday covers that week."""
    out = []
    for w in sorted(position_weeks):
        monday = date.fromisoformat(w)
        if start is not None and monday + timedelta(days=6) < start:
            continue
        if end is not None and monday > end:
            continue
        out.append(w)
    return out


def coverage(position: dict, assignments: list) -> dict[str, str | None]:
    """{week: name of the person covering it, or None} for each week the position has hours."""
    cover: dict[str, str | None] = {w: None for w in position["weeks"]}
    for a in assignments:
        for w in assignment_weeks(position["weeks"], a.start_date, a.end_date):
            cover[w] = a.person_name
    return cover


def position_stats(position: dict, assignments: list) -> dict:
    cover = coverage(position, assignments)
    total = sum(position["weeks"].values()) or 0.0
    named = sum(h for w, h in position["weeks"].items() if cover.get(w))
    unfilled = [w for w, who in cover.items() if who is None]
    now = this_monday().isoformat()
    ahead = (this_monday() + timedelta(weeks=8)).isoformat()
    return {
        "cover": cover,
        "named_hours": round(named, 2),
        "fill_pct": round(named / total * 100, 1) if total else 0.0,
        "unfilled_weeks": len(unfilled),
        # Work that is happening (or should have started) with nobody named to it.
        "unfilled_now_or_past": sum(1 for w in unfilled if w <= now),
        "unfilled_next_8_weeks": sum(1 for w in unfilled if now < w <= ahead),
    }


def person_load(assignments: list, positions_by_id: dict[str, dict]) -> dict[str, dict[str, float]]:
    """{person_id: {week: hours}} — the hours each person is named to, summed across every project."""
    load: dict[str, dict[str, float]] = {}
    for a in assignments:
        pos = positions_by_id.get(a.position_id)
        if pos is None:
            continue
        person = load.setdefault(a.person_id, {})
        for w in assignment_weeks(pos["weeks"], a.start_date, a.end_date):
            person[w] = person.get(w, 0.0) + pos["weeks"][w]
    return load


def overload(load: dict[str, float], capacity: float) -> list[dict]:
    """The weeks a person's named hours exceed their capacity."""
    return [
        {"week": w, "hours": round(h, 2), "capacity": capacity}
        for w, h in sorted(load.items())
        if h > capacity + 1e-6
    ]
