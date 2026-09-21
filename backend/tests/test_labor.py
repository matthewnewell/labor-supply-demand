import os
import sys

os.environ["DATA_DIR"] = os.path.join(os.path.dirname(__file__), "_tmp_data")
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import shutil

import pytest

from app import create_app
from db import db


@pytest.fixture()
def client(monkeypatch):
    import good_plan_client
    import org_client

    # No seed against the other apps: these tests are about actuals only.
    monkeypatch.setattr(good_plan_client, "fetch_positions", lambda project_id=None: ([], None))
    monkeypatch.setattr(org_client, "fetch_roster", lambda manager_id=None, category=None: ([], None))
    monkeypatch.setattr(org_client, "fetch_managers", lambda: ([], None))
    shutil.rmtree(os.environ["DATA_DIR"], ignore_errors=True)
    app = create_app()
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c
    with app.app_context():
        db.session.remove()
    shutil.rmtree(os.environ["DATA_DIR"], ignore_errors=True)


def test_import_actuals(client):
    res = client.post("/api/actuals/import", json={
        "source_label": "S4 labor extract",
        "rows": [
            {"employee": "Test Person", "role": "Engineer", "project": "Bracket Assembly Program",
             "charge_number": "CN-TEST", "period_start": "2026-01-05", "hours": 40},
        ],
    })
    assert res.status_code == 201
    assert len(res.get_json()) == 1
    assert len(client.get("/api/actuals?employee=Test Person").get_json()) == 1


def test_import_actuals_validates_rows(client):
    assert client.post("/api/actuals/import", json={"rows": [{"employee": "X"}]}).status_code == 400
    assert client.post("/api/actuals/import", json={"rows": []}).status_code == 400
