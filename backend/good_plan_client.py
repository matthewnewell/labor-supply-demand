"""
Read-only client for Good Plan's demand API — the one cross-app dependency this whole app has.
No shared database, no writes back: just a GET against Good Plan's own `/api/demand`, the same
plain-text `project`/`portfolio` label convention every other cross-app tie in this ecosystem
uses. If Good Plan isn't reachable, callers get an empty list plus an error string to surface,
rather than a crash — same tolerant-probe posture as Conway's Depot's own app-reachability check.
"""

import os

import httpx

GOOD_PLAN_URL = os.environ.get("GOOD_PLAN_URL", "http://localhost:8093").rstrip("/")


def fetch_demand(project: str | None = None, portfolio: str | None = None) -> tuple[list[dict], str | None]:
    """Returns (lines, error). `lines` is always a list (empty on failure); `error` is None on
    success or a short message describing what went wrong."""
    params = {}
    if project:
        params["project"] = project
    if portfolio:
        params["portfolio"] = portfolio

    try:
        r = httpx.get(f"{GOOD_PLAN_URL}/api/demand", params=params, timeout=3.0)
        r.raise_for_status()
        return r.json(), None
    except httpx.ConnectError:
        return [], f"Good Plan isn't reachable at {GOOD_PLAN_URL} right now."
    except httpx.HTTPError as e:
        return [], f"Good Plan returned an error: {e}"
