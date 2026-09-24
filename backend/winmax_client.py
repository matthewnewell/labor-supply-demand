"""
Read-only client for WinMax — where unawarded work carries its odds. A pursuit's id is the same as
its Depot project's (and its Good Plan plan's), so the Outlook joins a plan to its P(Win) by id.
Same tolerant-probe posture as the other clients: WinMax down means no P(Win), not a crash.
"""

import os

import httpx

WINMAX_URL = os.environ.get("WINMAX_URL", "http://localhost:8099").rstrip("/")


def _score(entry) -> int | None:
    if isinstance(entry, dict):
        return entry.get("score")
    return entry if isinstance(entry, (int, float)) else None


def fetch_pursuits() -> tuple[dict[str, dict], str | None]:
    """({pursuit id: {name, status, gate, p_win, p_go}}, error)."""
    try:
        r = httpx.get(f"{WINMAX_URL}/api/pursuits", timeout=3.0)
        r.raise_for_status()
        rows = r.json()
        if isinstance(rows, dict):
            rows = rows.get("pursuits", [])
    except httpx.ConnectError:
        return {}, f"WinMax isn't reachable at {WINMAX_URL} right now."
    except httpx.HTTPError as e:
        return {}, f"WinMax returned an error: {e}"
    return {
        p["id"]: {
            "name": p.get("name"),
            "status": p.get("status"),
            "gate": p.get("current_gate"),
            "customer": p.get("customer"),
            "p_win": _score(p.get("p_win")),
            "p_go": _score(p.get("p_go")),
        }
        for p in rows
    }, None
