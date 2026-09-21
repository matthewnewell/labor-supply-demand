"""
Actual labor hours — the mocked S4 extract of what people really charged. Requested labor lives in
Good Plan, named people in Assignments (routes/staffing.py); this is the third leg, so the gap
between what a project asked for and what it actually got can be seen.
"""

from datetime import date

from flask import Blueprint, jsonify, request

from db import db
from models import ActualLine

bp = Blueprint("labor", __name__, url_prefix="/api")


def _parse_date(value: str, field: str) -> date:
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        raise ValueError(f"{field} must be an ISO date (YYYY-MM-DD)")


@bp.get("/actuals")
def list_actuals():
    q = ActualLine.query
    if project := request.args.get("project"):
        q = q.filter(ActualLine.project == project)
    if employee := request.args.get("employee"):
        q = q.filter(ActualLine.employee == employee)
    lines = q.order_by(ActualLine.period_start.desc()).all()
    return jsonify([a.to_dict() for a in lines])


def _validate_actual_row(row: dict) -> str | None:
    if not (row.get("employee") or "").strip():
        return "each row needs an employee"
    if not (row.get("project") or "").strip():
        return "each row needs a project"
    if not row.get("period_start"):
        return "each row needs a period_start"
    try:
        float(row.get("hours"))
    except (TypeError, ValueError):
        return "each row needs numeric hours"
    return None


@bp.post("/actuals/import")
def import_actuals():
    """Ingest a mocked S4-style labor extract: {source_label, rows: [{employee, role, project,
    portfolio, charge_number, period_start, hours}, ...]}. Each row is an independent fact (an
    employee actually charged N hours in a period) — there's no evolving record to match against,
    so this just appends one ActualLine per row."""
    body = request.get_json(force=True) or {}
    rows = body.get("rows")
    if not isinstance(rows, list) or not rows:
        return jsonify({"error": "rows must be a non-empty list"}), 400

    for i, row in enumerate(rows):
        if err := _validate_actual_row(row):
            return jsonify({"error": f"row {i + 1}: {err}"}), 400

    created = []
    for row in rows:
        try:
            period_start = _parse_date(row["period_start"], "period_start")
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
        line = ActualLine(
            employee=row["employee"].strip(),
            role=(row.get("role") or "").strip() or None,
            project=row["project"].strip(),
            portfolio=(row.get("portfolio") or "").strip() or None,
            charge_number=(row.get("charge_number") or "").strip() or None,
            period_start=period_start,
            hours=float(row["hours"]),
        )
        db.session.add(line)
        created.append(line)

    db.session.commit()
    return jsonify([c.to_dict() for c in created]), 201
