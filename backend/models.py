"""
Labor Supply & Demand: the other side of a project's labor plan. A project asks for labor in Good
Plan — a POSITION per person it needs ("a Machinist", generic, with weekly hours). A functional
manager, working here, answers each request with a NAME: a real person from the roster in Org
Charts, for the whole position or a stretch of it. Functional managers commit names, never
headcount. From that come the things worth seeing:

  - who is named to what, and which positions are still open (fulfillment);
  - each person's load across every project they're on, against their capacity (over-allocation);
  - what was requested vs. what was named vs. what people actually charged (the gap between what a
    project asks for and what it gets).

**Nothing here is a copy of another app's data.** Positions are read live from Good Plan, people
and reporting lines live from Org Charts. What THIS app owns is the answer — `Assignment` — and the
mocked S4 hours people actually charged — `ActualLine`. An Assignment freezes the names it needs to
stay readable if a plan is re-seeded or a person leaves the roster (position_label, project_name,
person_name), but `position_id` (a Good Plan line id) and `person_id` (an Org Charts id) are the
real keys.
"""

from datetime import datetime, timezone

from db import _uuid, db


def _now():
    return datetime.now(timezone.utc)


class Assignment(db.Model):
    """A named person filling a position, for the whole position or a date range of it. A position
    may have several in sequence (one person until week 10, another from week 11) but never two at
    once — a position is one person's worth of work."""

    __tablename__ = "assignment"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    position_id = db.Column(db.String(36), nullable=False, index=True)  # a Good Plan labor line id
    depot_project_id = db.Column(db.String(36), nullable=True, index=True)
    project_name = db.Column(db.String(200), nullable=False)
    category = db.Column(db.String(120), nullable=False)
    position_label = db.Column(db.String(200), nullable=False)  # "Machinist #3"
    person_id = db.Column(db.String(36), nullable=False, index=True)  # an Org Charts person id
    person_name = db.Column(db.String(200), nullable=False)
    # Null = the position's own first / last week.
    start_date = db.Column(db.Date, nullable=True)
    end_date = db.Column(db.Date, nullable=True)
    note = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=_now, nullable=False)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "position_id": self.position_id,
            "depot_project_id": self.depot_project_id,
            "project_name": self.project_name,
            "category": self.category,
            "position_label": self.position_label,
            "person_id": self.person_id,
            "person_name": self.person_name,
            "start_date": self.start_date.isoformat() if self.start_date else None,
            "end_date": self.end_date.isoformat() if self.end_date else None,
            "note": self.note,
            "created_at": self.created_at.isoformat(),
        }


class ActualLine(db.Model):
    """One row of real labor consumption — hours an employee actually charged, for a period,
    against a project (and optionally a charge number). Mocked S4 data: in production this
    would be an on-demand extract the way DWMP/DWMO pull procurement/manufacturing status from
    S4; here it's a paste-in import, same convention as those two apps' `/import` pages. Owned
    here because this is where "what a project asked for" meets "what it actually got": requested
    hours (Good Plan) vs named people (this app) vs hours actually charged (this table). Reckon
    reads it for plan-vs-actual."""

    __tablename__ = "actual_line"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    employee = db.Column(db.String(200), nullable=False)
    role = db.Column(db.String(200), nullable=True)
    project = db.Column(db.String(200), nullable=False, index=True)
    portfolio = db.Column(db.String(200), nullable=True)
    charge_number = db.Column(db.String(80), nullable=True, index=True)
    period_start = db.Column(db.Date, nullable=False)
    hours = db.Column(db.Float, nullable=False)
    created_at = db.Column(db.DateTime, default=_now, nullable=False)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "employee": self.employee,
            "role": self.role,
            "project": self.project,
            "portfolio": self.portfolio,
            "charge_number": self.charge_number,
            "period_start": self.period_start.isoformat(),
            "hours": self.hours,
            "created_at": self.created_at.isoformat(),
        }
