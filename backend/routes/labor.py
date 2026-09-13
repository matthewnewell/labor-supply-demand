from datetime import date

from flask import Blueprint, jsonify, request

import good_plan_client
from db import db
from models import ActualLine, Commitment

bp = Blueprint("labor", __name__, url_prefix="/api")


def _parse_date(value: str, field: str) -> date:
    try:
        return date.fromisoformat(value)
    except (TypeError, ValueError):
        raise ValueError(f"{field} must be an ISO date (YYYY-MM-DD)")


# ── Demand (read-only proxy onto Good Plan — see good_plan_client.py) ─────────────────────────

@bp.get("/demand")
def get_demand():
    """Every demand line Good Plan knows about, live — this app has no copy of its own.
    `?project=`/`?portfolio=` scope it, same as Good Plan's own endpoint. `error` is set (and
    `lines` empty) if Good Plan couldn't be reached; the frontend shows that plainly rather than
    pretending demand is zero."""
    lines, error = good_plan_client.fetch_demand(
        project=request.args.get("project"), portfolio=request.args.get("portfolio"),
    )
    return jsonify({"lines": lines, "error": error})


# ── Commitments (the actual supply side, owned here) ──────────────────────────────────────────

@bp.get("/commitments")
def list_commitments():
    q = Commitment.query
    if project := request.args.get("project"):
        q = q.filter(Commitment.project == project)
    if portfolio := request.args.get("portfolio"):
        q = q.filter(Commitment.portfolio == portfolio)
    if role := request.args.get("role"):
        q = q.filter(Commitment.role == role)
    lines = q.order_by(Commitment.start_date).all()
    return jsonify([c.to_dict() for c in lines])


@bp.post("/commitments")
def create_commitment():
    body = request.get_json(force=True) or {}
    project = (body.get("project") or "").strip()
    role = (body.get("role") or "").strip()
    if not project:
        return jsonify({"error": "project is required"}), 400
    if not role:
        return jsonify({"error": "role is required"}), 400
    try:
        fte = float(body.get("fte"))
    except (TypeError, ValueError):
        return jsonify({"error": "fte must be a number"}), 400
    if fte <= 0:
        return jsonify({"error": "fte must be greater than 0"}), 400

    try:
        start_date = _parse_date(body.get("start_date"), "start_date")
        end_date = _parse_date(body.get("end_date"), "end_date")
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    if end_date < start_date:
        return jsonify({"error": "end_date cannot be before start_date"}), 400

    line = Commitment(
        project=project,
        portfolio=(body.get("portfolio") or "").strip() or None,
        role=role,
        fte=fte,
        start_date=start_date,
        end_date=end_date,
        assigned_to=(body.get("assigned_to") or "").strip() or None,
        note=(body.get("note") or "").strip() or None,
    )
    db.session.add(line)
    db.session.commit()
    return jsonify(line.to_dict()), 201


@bp.put("/commitments/<commitment_id>")
def update_commitment(commitment_id):
    line = Commitment.query.get_or_404(commitment_id)
    body = request.get_json(force=True) or {}

    if "project" in body:
        project = (body["project"] or "").strip()
        if not project:
            return jsonify({"error": "project cannot be empty"}), 400
        line.project = project
    if "portfolio" in body:
        line.portfolio = (body["portfolio"] or "").strip() or None
    if "role" in body:
        role = (body["role"] or "").strip()
        if not role:
            return jsonify({"error": "role cannot be empty"}), 400
        line.role = role
    if "fte" in body:
        try:
            fte = float(body["fte"])
        except (TypeError, ValueError):
            return jsonify({"error": "fte must be a number"}), 400
        if fte <= 0:
            return jsonify({"error": "fte must be greater than 0"}), 400
        line.fte = fte
    if "start_date" in body:
        try:
            line.start_date = _parse_date(body["start_date"], "start_date")
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
    if "end_date" in body:
        try:
            line.end_date = _parse_date(body["end_date"], "end_date")
        except ValueError as e:
            return jsonify({"error": str(e)}), 400
    if line.end_date < line.start_date:
        return jsonify({"error": "end_date cannot be before start_date"}), 400
    if "assigned_to" in body:
        line.assigned_to = (body["assigned_to"] or "").strip() or None
    if "note" in body:
        line.note = (body["note"] or "").strip() or None

    db.session.commit()
    return jsonify(line.to_dict())


@bp.delete("/commitments/<commitment_id>")
def delete_commitment(commitment_id):
    line = Commitment.query.get_or_404(commitment_id)
    db.session.delete(line)
    db.session.commit()
    return "", 204


# ── Actuals (mocked S4 labor extract) ──────────────────────────────────────────────────────────

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
    employee actually charged N hours in a period) — unlike DWMP/DWMO's order lines, there's no
    evolving record to match against, so this just appends one ActualLine per row."""
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


# ── Shared lookups ──────────────────────────────────────────────────────────────────────────

@bp.get("/projects")
def list_projects():
    """Good Plan's own project list, live — the natural source since demand is what defines
    which projects exist from this app's point of view. Falls back to whatever's shown up
    locally in commitments/actuals if Good Plan can't be reached, so the picker isn't just
    empty."""
    projects, error = good_plan_client.fetch_demand()
    names = {p["project"] for p in projects}
    if error:
        names |= {r[0] for r in db.session.query(Commitment.project).distinct().all()}
        names |= {r[0] for r in db.session.query(ActualLine.project).distinct().all()}
    return jsonify(sorted(names))


@bp.get("/roles")
def list_roles():
    rows = db.session.query(Commitment.role).distinct().all()
    return jsonify(sorted({r[0] for r in rows}))
