import os
import sys

os.environ["DATA_DIR"] = os.path.join(os.path.dirname(__file__), "_tmp_data")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import shutil

import pytest

from app import create_app
from db import db


@pytest.fixture()
def client():
    shutil.rmtree(os.environ["DATA_DIR"], ignore_errors=True)
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c
    with app.app_context():
        db.session.remove()
    shutil.rmtree(os.environ["DATA_DIR"], ignore_errors=True)


# ── Demand proxy ─────────────────────────────────────────────────────────────────────────────

def test_demand_proxies_good_plan(client, monkeypatch):
    import good_plan_client

    def fake_fetch(project=None, portfolio=None):
        return [{"id": "x", "project": "Demo: Bracket Assembly Program", "role": "Machinist", "fte": 2.0}], None

    monkeypatch.setattr(good_plan_client, "fetch_demand", fake_fetch)
    res = client.get("/api/demand?project=Demo: Bracket Assembly Program")
    assert res.status_code == 200
    body = res.get_json()
    assert body["error"] is None
    assert len(body["lines"]) == 1
    assert body["lines"][0]["role"] == "Machinist"


def test_demand_surfaces_good_plan_unreachable(client, monkeypatch):
    import good_plan_client

    monkeypatch.setattr(good_plan_client, "fetch_demand", lambda project=None, portfolio=None: ([], "Good Plan isn't reachable at http://localhost:8093 right now."))
    res = client.get("/api/demand")
    body = res.get_json()
    assert body["lines"] == []
    assert "isn't reachable" in body["error"]


# ── Commitments ──────────────────────────────────────────────────────────────────────────────

def test_commitments_seeded(client):
    res = client.get("/api/commitments?project=Demo: Bracket Assembly Program")
    assert res.status_code == 200
    lines = res.get_json()
    assert len(lines) == 4
    machinist = next(c for c in lines if c["role"] == "Machinist")
    assert machinist["assigned_to"] is None  # headcount reserved, not yet named


def test_create_update_delete_commitment(client):
    created = client.post("/api/commitments", json={
        "project": "Demo: Bracket Assembly Program", "role": "Quality Inspector", "fte": 0.5,
        "start_date": "2026-01-01", "end_date": "2026-03-01",
    })
    assert created.status_code == 201
    cid = created.get_json()["id"]

    updated = client.put(f"/api/commitments/{cid}", json={"assigned_to": "New Person"})
    assert updated.status_code == 200
    assert updated.get_json()["assigned_to"] == "New Person"

    deleted = client.delete(f"/api/commitments/{cid}")
    assert deleted.status_code == 204
    assert not any(c["id"] == cid for c in client.get("/api/commitments").get_json())


def test_create_commitment_requires_fields(client):
    res = client.post("/api/commitments", json={"role": "X"})
    assert res.status_code == 400
    res = client.post("/api/commitments", json={
        "project": "X", "role": "Y", "fte": 1, "start_date": "2026-02-01", "end_date": "2026-01-01",
    })
    assert res.status_code == 400  # end before start


# ── Actuals ──────────────────────────────────────────────────────────────────────────────────

def test_actuals_seeded(client):
    res = client.get("/api/actuals?project=Demo: Bracket Assembly Program")
    assert res.status_code == 200
    lines = res.get_json()
    assert len(lines) == 5


def test_import_actuals(client):
    res = client.post("/api/actuals/import", json={
        "source_label": "S4 labor extract",
        "rows": [
            {"employee": "Test Person", "role": "Engineer", "project": "Demo: Bracket Assembly Program",
             "charge_number": "CN-TEST", "period_start": "2026-01-05", "hours": 40},
        ],
    })
    assert res.status_code == 201
    assert len(res.get_json()) == 1

    res = client.get("/api/actuals?employee=Test Person")
    assert len(res.get_json()) == 1


def test_import_actuals_validates_rows(client):
    res = client.post("/api/actuals/import", json={"rows": [{"employee": "X"}]})
    assert res.status_code == 400
    res = client.post("/api/actuals/import", json={"rows": []})
    assert res.status_code == 400


# ── Lookups ──────────────────────────────────────────────────────────────────────────────────

def test_roles_endpoint(client):
    res = client.get("/api/roles")
    assert res.status_code == 200
    roles = res.get_json()
    assert "Program Manager" in roles
    assert "Machinist" in roles


def test_projects_falls_back_to_local_data_when_good_plan_unreachable(client, monkeypatch):
    import good_plan_client

    monkeypatch.setattr(good_plan_client, "fetch_demand", lambda project=None, portfolio=None: ([], "unreachable"))
    res = client.get("/api/projects")
    assert res.status_code == 200
    projects = res.get_json()
    assert "Demo: Bracket Assembly Program" in projects
    assert "Demo: Nacelle Fairing Retrofit" in projects
