"""
Demo seed — commitments and mocked S4 actuals for the same two demo projects Good Plan already
declares demand for ("Demo: Bracket Assembly Program", "Demo: Nacelle Fairing Retrofit"),
portfolio "Industrial Programs". No demand seeded here — it's read live from Good Plan.

Deliberately an incomplete supply picture, not a mirror of demand: some roles are fully
committed to a named person, some are headcount-only (reserved but not yet assigned), some are
under-committed against what's actually being asked for, and Quality Inspector on both projects
has no commitment at all yet — a real functional manager's worklist, not a solved puzzle.
Charge numbers and PM names echo Scope Manager's and The Fixer's own demo seeds (Sam Ortiz /
Dana Kim, CN-4471-xx) — no functional link, just the same demo story told from the labor side.
"""

from datetime import timedelta

from db import db
from models import ActualLine, Commitment, _now

DAY = timedelta(days=1)
_PORTFOLIO = "Industrial Programs"
_BKT = "Demo: Bracket Assembly Program"
_NAC = "Demo: Nacelle Fairing Retrofit"

# project, role, fte, start_offset_days, end_offset_days, assigned_to, note
_COMMITMENTS = [
    (_BKT, "Program Manager", 0.25, -30, 60, "Sam Ortiz",
     None),
    (_BKT, "Systems Engineer", 0.5, -30, 10, "Priya Nair",
     "Only half covered so far — flagged to Systems Engineering lead."),
    (_BKT, "Mechanical Engineer", 1.5, -20, 15, "Priya Nair",
     "Design Definition phase only; sustaining-engineering phase not yet committed."),
    (_BKT, "Machinist", 2.0, 10, 45, None,
     "Headcount reserved on 2nd shift, not yet named to individuals."),
    (_NAC, "Program Manager", 0.25, -10, 90, "Dana Kim",
     None),
    (_NAC, "Mechanical Engineer", 1.0, -10, 20, None,
     None),
    (_NAC, "Machinist", 0.5, 15, 60, "J. Alvarez",
     "Half of what's being asked for — competing with the Bracket program for the same shift."),
]

# employee, role, project, charge_number, period_offset_days, hours
_ACTUALS = [
    ("Sam Ortiz", "Program Manager", _BKT, "CN-4471-10", -14, 18),
    ("Sam Ortiz", "Program Manager", _BKT, "CN-4471-10", -7, 20),
    ("Priya Nair", "Mechanical Engineer", _BKT, "CN-4471-10", -14, 38),
    ("Priya Nair", "Mechanical Engineer", _BKT, "CN-4471-10", -7, 41),
    ("J. Alvarez", "Machinist", _BKT, "CN-4471-30", -7, 34),
    ("Dana Kim", "Program Manager", _NAC, "CN-5820-10", -7, 15),
]


def seed_if_empty():
    if Commitment.query.count() > 0:
        return

    today = _now()
    for project, role, fte, start_offset, end_offset, assigned_to, note in _COMMITMENTS:
        db.session.add(Commitment(
            project=project,
            portfolio=_PORTFOLIO,
            role=role,
            fte=fte,
            start_date=(today + start_offset * DAY).date(),
            end_date=(today + end_offset * DAY).date(),
            assigned_to=assigned_to,
            note=note,
            created_at=today,
        ))

    for employee, role, project, charge_number, period_offset, hours in _ACTUALS:
        db.session.add(ActualLine(
            employee=employee,
            role=role,
            project=project,
            portfolio=_PORTFOLIO,
            charge_number=charge_number,
            period_start=(today + period_offset * DAY).date(),
            hours=hours,
            created_at=today,
        ))

    db.session.commit()
