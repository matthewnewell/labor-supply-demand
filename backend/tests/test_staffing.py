"""Staffing: naming people to positions, coverage, load and fulfillment. Good Plan and Org Charts are
stubbed, so these run on their own."""

import os
import sys
from datetime import date, timedelta

os.environ["DATA_DIR"] = os.path.join(os.path.dirname(__file__), "_tmp_data_staffing")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import shutil

import pytest

import good_plan_client
import org_client
from app import create_app
from db import db
from staffing_math import this_monday

MON = this_monday()
W = [(MON + timedelta(weeks=i)).isoformat() for i in range(-3, 7)]  # three weeks ago .. six ahead


def _pos(pid, label, category, hours_by_index, project="Proj A", project_id="proj-a", phase="execution"):
    weeks = {W[i]: h for i, h in hours_by_index.items()}
    return {
        "id": pid, "depot_project_id": project_id, "project_name": project, "portfolio_name": "Port", "phase": phase,
        "category": category, "label": label, "wbs": "1.1", "note": None, "weeks": weeks,
        "total_hours": sum(weeks.values()), "first_week": min(weeks), "last_week": max(weeks),
    }


POSITIONS = [
    _pos("p-mach-1", "Machinist #1", "Machinist", {i: 40 for i in range(0, 8)}),
    _pos("p-mach-2", "Machinist #2", "Machinist", {i: 40 for i in range(0, 8)}),
    _pos("p-pm", "Program Manager", "Program Manager", {i: 10 for i in range(0, 8)}),
    _pos("p-b-mach", "Machinist", "Machinist", {i: 40 for i in range(2, 6)}, project="Proj B", project_id="proj-b"),
]
ROSTER = [
    {"id": "u-ann", "name": "Ann", "title": "Machinist II", "department": "Mfg", "manager_id": "m1", "manager_name": "Boss", "labor_category": "Machinist", "capacity_hours": 40.0},
    {"id": "u-bob", "name": "Bob", "title": "Machinist I", "department": "Mfg", "manager_id": "m1", "manager_name": "Boss", "labor_category": "Machinist", "capacity_hours": 40.0},
    {"id": "u-cy", "name": "Cy", "title": "Program Manager", "department": "PM", "manager_id": "m2", "manager_name": "Chief", "labor_category": "Program Manager", "capacity_hours": 40.0},
]


@pytest.fixture()
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setattr(good_plan_client, "fetch_positions", lambda project_id=None: ([p for p in POSITIONS if not project_id or p["depot_project_id"] == project_id], None))
    monkeypatch.setattr(org_client, "fetch_roster", lambda manager_id=None, category=None, function=None: ([p for p in ROSTER if (not manager_id or p["manager_id"] == manager_id) and (not category or p["labor_category"] == category)], None))
    monkeypatch.setattr(org_client, "fetch_managers", lambda: ([{"id": "m1", "name": "Boss", "team_size": 2}], None))
    import app as app_module

    monkeypatch.setattr(app_module, "seed_if_empty", lambda: None)  # tests start with no assignments
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c
    with app.app_context():
        db.session.remove()


def _assign(client, position_id, person_id, **extra):
    return client.post("/api/assignments", json={"position_id": position_id, "person_id": person_id, **extra})


def test_positions_start_open(client):
    d = client.get("/api/positions").get_json()
    assert len(d["positions"]) == 4 and d["weeks"]
    assert all(p["fill_pct"] == 0 and p["assignments"] == [] for p in d["positions"])


def test_naming_a_person_covers_the_position(client):
    res = _assign(client, "p-mach-1", "u-ann")
    assert res.status_code == 201 and res.get_json()["person_name"] == "Ann"
    pos = next(p for p in client.get("/api/positions").get_json()["positions"] if p["id"] == "p-mach-1")
    assert pos["fill_pct"] == 100 and pos["unfilled_weeks"] == 0
    assert set(pos["cover"].values()) == {"Ann"}


def test_the_person_must_match_the_positions_category(client):
    res = _assign(client, "p-mach-1", "u-cy")  # a Program Manager can't fill a Machinist position
    assert res.status_code == 400 and "Program Manager" in res.get_json()["error"]
    assert _assign(client, "nope", "u-ann").status_code == 404
    assert _assign(client, "p-mach-1", "ghost").status_code == 400


def test_two_people_cannot_cover_the_same_weeks_but_can_hand_over(client):
    assert _assign(client, "p-mach-1", "u-ann", end_date=(MON + timedelta(weeks=2, days=6)).isoformat()).status_code == 201
    clash = _assign(client, "p-mach-1", "u-bob")  # whole position overlaps Ann's first weeks
    assert clash.status_code == 400 and "Ann" in clash.get_json()["error"]
    handover = _assign(client, "p-mach-1", "u-bob", start_date=(MON + timedelta(weeks=3)).isoformat())
    assert handover.status_code == 201
    pos = next(p for p in client.get("/api/positions").get_json()["positions"] if p["id"] == "p-mach-1")
    assert pos["fill_pct"] == 100 and {"Ann", "Bob"} == set(pos["cover"].values())


def test_dates_that_cover_no_week_are_rejected(client):
    far = (MON + timedelta(weeks=40)).isoformat()
    assert _assign(client, "p-mach-1", "u-ann", start_date=far).status_code == 400


def test_over_allocation_is_reported_not_blocked(client):
    _assign(client, "p-mach-1", "u-ann")  # 40h/wk for 8 weeks
    res = _assign(client, "p-b-mach", "u-ann")  # +40h/wk for weeks 2..5 -> 80h
    assert res.status_code == 201
    over = res.get_json()["overload"]
    assert len(over) == 4 and all(o["hours"] == 80 and o["capacity"] == 40 for o in over)


def test_roster_shows_load_and_over_weeks(client):
    _assign(client, "p-mach-1", "u-ann")
    _assign(client, "p-b-mach", "u-ann")
    d = client.get("/api/roster").get_json()
    ann = next(p for p in d["people"] if p["id"] == "u-ann")
    assert ann["over_weeks"] == 4 and ann["peak_pct"] == 200 and len(ann["assignments"]) == 2
    bob = next(p for p in d["people"] if p["id"] == "u-bob")
    assert bob["load"] == {} and bob["over_weeks"] == 0
    team = client.get("/api/roster?manager_id=m2").get_json()["people"]
    assert [p["name"] for p in team] == ["Cy"]  # only the people that manager owns


def test_removing_an_assignment_reopens_the_position(client):
    aid = _assign(client, "p-mach-1", "u-ann").get_json()["id"]
    assert client.delete(f"/api/assignments/{aid}").status_code == 204
    pos = next(p for p in client.get("/api/positions").get_json()["positions"] if p["id"] == "p-mach-1")
    assert pos["fill_pct"] == 0


def test_fulfillment_compares_requested_named_and_actual(client):
    _assign(client, "p-mach-1", "u-ann")  # only one of Proj A's two machinist positions is named
    client.post("/api/actuals/import", json={"rows": [
        {"employee": "Ann", "role": "Machinist", "project": "Proj A", "period_start": (MON - timedelta(weeks=1)).isoformat(), "hours": 30},
        {"employee": "Ann", "role": "Machinist", "project": "Proj A", "period_start": (MON - timedelta(weeks=2)).isoformat(), "hours": 38},
    ]})
    proj = next(p for p in client.get("/api/fulfillment").get_json()["projects"] if p["project_name"] == "Proj A")
    mach = next(c for c in proj["categories"] if c["category"] == "Machinist")
    assert mach["requested_hours"] == 640 and mach["named_hours"] == 320  # two positions asked, one named
    assert mach["actual_to_date"] == 68
    assert proj["positions"] == 3 and proj["positions_filled"] == 1


def test_summary_tile_goes_red_when_work_is_underway_with_nobody_named(client):
    s = client.get("/api/summary?project_id=proj-a").get_json()
    assert s["headline"] == "0/3" and s["status"] == "critical"
    for pid, uid in (("p-mach-1", "u-ann"), ("p-mach-2", "u-bob"), ("p-pm", "u-cy")):
        _assign(client, pid, uid)
    s = client.get("/api/summary?project_id=proj-a").get_json()
    assert s["headline"] == "3/3" and s["status"] == "ok"
    assert client.get("/api/summary?project_id=unknown").get_json()["headline"] is None


def test_a_pursuit_is_pipeline_not_a_staffing_gap(client, monkeypatch):
    pursuit = [dict(POSITIONS[0], phase="pursuit", id="bid-1", depot_project_id="bid")]
    monkeypatch.setattr(good_plan_client, "fetch_positions", lambda project_id=None: (pursuit, None))
    s = client.get("/api/summary?project_id=bid").get_json()
    assert s["headline"] == "1" and s["status"] is None and "pipeline" in s["label"]


def test_agent_context_shows_open_positions_overload_and_roster(client, monkeypatch):
    from routes import ai as ai_route

    _assign(client, "p-mach-1", "u-ann")
    _assign(client, "p-b-mach", "u-ann")  # Ann is now double-booked for weeks 2-5
    text = "\n".join(ai_route._context_lines())
    assert "Proj A" in text and "Machinist #2" in text  # an open position
    assert "Ann (40h, 200%, 4 wk over" in text  # the over-allocated person, with their peak
    assert "Machinist:" in text and "Program Manager:" in text  # supply by category
