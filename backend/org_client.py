"""
Read-only client for Org Charts — where the people are. The roster (everyone with a labor category,
who they report to, their weekly capacity) and the list of functional managers with the size of
the team each owns. No copy is kept here: a person who moves teams in Org Charts moves here too.
Server-to-server; if Org Charts is down callers get an empty list and an error string to surface.
"""

import os

import httpx

ORG_CHARTS_URL = os.environ.get("ORG_CHARTS_URL", "http://localhost:8095").rstrip("/")


def _get(path: str, params: dict | None = None) -> tuple[list[dict], str | None]:
    try:
        r = httpx.get(f"{ORG_CHARTS_URL}{path}", params=params or {}, timeout=3.0)
        r.raise_for_status()
        return r.json(), None
    except httpx.ConnectError:
        return [], f"Org Charts isn't reachable at {ORG_CHARTS_URL} right now."
    except httpx.HTTPError as e:
        return [], f"Org Charts returned an error: {e}"


def fetch_roster(manager_id: str | None = None, category: str | None = None) -> tuple[list[dict], str | None]:
    """People with a labor category. `manager_id` narrows to that manager's team (everyone below
    them at any depth) — the people a functional manager owns and allocates."""
    params = {}
    if manager_id:
        params["manager_id"] = manager_id
    if category:
        params["category"] = category
    return _get("/api/people/roster", params)


def fetch_managers() -> tuple[list[dict], str | None]:
    """Functional managers (anyone who directly manages people with a labor category), each with
    `team_size`."""
    return _get("/api/people/managers")
