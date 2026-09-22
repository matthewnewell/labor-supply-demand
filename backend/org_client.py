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


def fetch_roster(
    manager_id: str | None = None, category: str | None = None, function: str | None = None,
) -> tuple[list[dict], str | None]:
    """People with a labor category. `manager_id` narrows to that manager's reporting-line team
    (everyone below them, at any depth). `function` narrows to a Function's people instead —
    everyone whose category rolls up into it (see Org Charts' FUNCTION_CATEGORIES), which is the
    cut a Functional Manager actually assigns from; a Function's people aren't necessarily all
    under one reporting-line manager (Manufacturing, for one, isn't)."""
    params = {}
    if manager_id:
        params["manager_id"] = manager_id
    if category:
        params["category"] = category
    if function:
        params["function"] = function
    return _get("/api/people/roster", params)


def fetch_managers() -> tuple[list[dict], str | None]:
    """Functional managers (anyone who directly manages people with a labor category), each with
    `team_size`."""
    return _get("/api/people/managers")


def fetch_person_by_name(name: str) -> dict | None:
    """One roster person (an individual contributor — has a labor category) by exact name, or
    None. Used to turn a resolved Depot persona name into the Org Charts id Assignment actually
    keys on (see depot_client's own doc comment on why this is name-matched, not id-matched).
    Fetches the whole roster rather than assuming Org Charts has a by-name lookup of its own."""
    people, _error = fetch_roster()
    return next((p for p in people if p.get("name") == name), None)


def fetch_functions() -> tuple[list[dict], str | None]:
    """The functional taxonomy — one Function per named discipline, each with its designated
    manager (see Org Charts' models.Function). What the Staffing page scopes itself to, instead
    of an arbitrary manager pick."""
    return _get("/api/functions")
