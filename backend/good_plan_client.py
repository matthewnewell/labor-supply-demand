"""
Read-only client for Good Plan — where projects ask for labor. Each labor line in a plan is a
POSITION: a generic request ("a Machinist") with weekly hours. This app never copies them; it reads
them live and answers each with a named person (see models.Assignment). No shared database, no
writes back. If Good Plan isn't reachable, callers get an empty list plus an error string to surface,
rather than a crash — same tolerant-probe posture as every other cross-app read here.
"""

import os

import httpx

GOOD_PLAN_URL = os.environ.get("GOOD_PLAN_URL", "http://localhost:8093").rstrip("/")


def fetch_positions(project_id: str | None = None) -> tuple[list[dict], str | None]:
    """Returns (positions, error). Each position: id, depot_project_id, project_name, phase,
    category, label, wbs, weeks {iso Monday: hours}, total_hours, first_week, last_week."""
    params = {"project_id": project_id} if project_id else {}
    try:
        r = httpx.get(f"{GOOD_PLAN_URL}/api/positions", params=params, timeout=3.0)
        r.raise_for_status()
        return r.json(), None
    except httpx.ConnectError:
        return [], f"Good Plan isn't reachable at {GOOD_PLAN_URL} right now."
    except httpx.HTTPError as e:
        return [], f"Good Plan returned an error: {e}"
