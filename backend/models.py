"""
Labor Supply & Demand: the org-wide counterpart to Good Plan. A project declares what labor it
needs in Good Plan (demand); a functional/resource manager, working here, sees that demand
rolled up across every project and commits real people or headcount against it (supply).
Staffing only — not a general organizational dashboard (that's Reckon's job, which scales from
a project view up to an org/portfolio one on the same underlying data).

**No local copy of demand.** `Commitment` and `ActualLine` are the only tables here — demand
itself is always read live from Good Plan's own API (`good_plan_client.py`), the same read-only,
no-shared-database pattern this ecosystem uses everywhere a plain-text `project` label is the
only tie between two apps. Storing a mirrored copy of Good Plan's demand lines here would just
be a second, driftable source of the same fact.

`project`/`portfolio` are plain-text labels, same convention as everywhere else.
"""

from datetime import datetime, timezone

from db import _uuid, db


def _now():
    return datetime.now(timezone.utc)


class Commitment(db.Model):
    """One line of committed supply: `assigned_to` (a real person, or left blank for "N FTE of
    this role, not yet named to an individual") gives `fte` of `role` to `project` from
    `start_date` to `end_date`. The supply-side mirror of Good Plan's `DemandLine` — same shape
    on purpose, so the two sit side by side and compare directly. Not validated against Good
    Plan's demand in any automated way; a person decides whether a commitment actually covers
    what's being asked for, same "no fake precision" stance as the rest of this ecosystem."""

    __tablename__ = "commitment"

    id = db.Column(db.String(36), primary_key=True, default=_uuid)
    project = db.Column(db.String(200), nullable=False, index=True)
    portfolio = db.Column(db.String(200), nullable=True, index=True)
    role = db.Column(db.String(200), nullable=False, index=True)
    fte = db.Column(db.Float, nullable=False)
    start_date = db.Column(db.Date, nullable=False)
    end_date = db.Column(db.Date, nullable=False)
    assigned_to = db.Column(db.String(200), nullable=True)
    note = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime, default=_now, nullable=False)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "project": self.project,
            "portfolio": self.portfolio,
            "role": self.role,
            "fte": self.fte,
            "start_date": self.start_date.isoformat(),
            "end_date": self.end_date.isoformat(),
            "assigned_to": self.assigned_to,
            "note": self.note,
            "created_at": self.created_at.isoformat(),
        }


class ActualLine(db.Model):
    """One row of real labor consumption — hours an employee actually charged, for a period,
    against a project (and optionally a charge number). Mocked S4 data: in production this
    would be an on-demand extract the way DWMP/DWMO pull procurement/manufacturing status from
    S4; here it's a paste-in import, same convention as those two apps' `/import` pages. This is
    the actual-labor half of what Reckon will eventually read for its ACWP calculation — owned
    here rather than duplicated, since this app is the natural place real headcount/hours land."""

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
