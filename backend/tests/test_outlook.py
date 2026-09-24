"""The Outlook: plan / committed / actual per project and category, joined to P(Win) and capacity.
Good Plan, Org Charts and WinMax are stubbed."""

import os
import sys
from datetime import timedelta

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import pytest

import good_plan_client
import org_client
import winmax_client
from app import create_app
from db import db
from models import ActualLine
from staffing_math import this_monday

MON = this_monday()
W = [(MON + timedelta(weeks=i)).isoformat() for i in range(-2, 10)]


def _pos(pid, category, idx, project, project_id, phase):
    weeks = {W[i]: 40.0 for i in idx}
    return {
        "id": pid, "depot_project_id": project_id, "project_name": project, "portfolio_name": "Port", "phase": phase,
        "category": category, "label": category, "wbs": "1.1", "note": None, "weeks": weeks,
        "total_hours": sum(weeks.values()), "first_week": min(weeks), "last_week": max(weeks),
    }


POSITIONS = [
    _pos("a-mach", "Machinist", range(0, 6), "Awarded", "proj-a", "execution"),
    _pos("w-mach", "Machinist", range(4, 12), "Pursuit", "proj-w", "pursuit"),
]
ROSTER = [
    {"id": "u-ann", "name": "Ann", "labor_category": "Machinist", "function": "Manufacturing", "capacity_hours": 40.0, "manager_id": "m"},
]


@pytest.fixture()
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setattr(good_plan_client, "fetch_positions", lambda project_id=None: (POSITIONS, None))
    monkeypatch.setattr(org_client, "fetch_roster", lambda *a, **k: (ROSTER, None))
    monkeypatch.setattr(org_client, "fetch_functions", lambda: ([{"name": "Manufacturing", "categories": ["Machinist"]}], None))
    monkeypatch.setattr(winmax_client, "fetch_pursuits", lambda: ({"proj-w": {"name": "Pursuit", "status": "active", "p_win": 60, "p_go": 70}}, None))
    import app as app_module

    monkeypatch.setattr(app_module, "seed_if_empty", lambda: None)
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c, app
    with app.app_context():
        db.session.remove()


def test_outlook_joins_plans_odds_capacity_and_actuals(client):
    c, app = client
    c.post("/api/assignments", json={"position_id": "a-mach", "person_id": "u-ann"})
    with app.app_context():
        db.session.add(ActualLine(employee="Ann", role="Machinist", project="Awarded", period_start=MON - timedelta(weeks=1), hours=38))
        db.session.commit()
    d = c.get("/api/outlook").get_json()
    projects = {p["id"]: p for p in d["projects"]}
    assert projects["proj-a"]["awarded"] and "reckon" in projects["proj-a"]["links"]
    assert not projects["proj-w"]["awarded"] and projects["proj-w"]["pursuit"]["p_win"] == 60
    assert projects["proj-w"]["links"]["winmax"].endswith("/pursuits/proj-w")
    cells = {(s["project_id"], s["category"]): s for s in d["series"]}
    assert cells["proj-a", "Machinist"]["committed"][W[0]] == 40.0
    assert cells["proj-a", "Machinist"]["actual"][W[1]] == 38
    assert cells["proj-w", "Machinist"]["committed"] == {}
    assert d["categories"] == [{"name": "Machinist", "function": "Manufacturing", "headcount": 1, "capacity_hours": 40.0}]
    assert d["weeks"][0] == W[0] and d["weeks"][-1] == W[11]
