"""
Where Conway's Depot lives. Mostly read nothing else from the Depot directly — the shared
ai_client (AI_PROVIDER=depot) routes AI calls through the Depot's proxy, which holds the one real
key, and looks up the Depot's address here. The one exception is `fetch_person_name`: LSD is
handed a Depot person_id when launched from the Launchpad (see lib/person.ts on the frontend),
and needs the person's NAME to find them in Org Charts' roster — the two apps mint their own ids
independently, the same way Sam Ortiz exists under two different ids in Depot and Org Charts,
tied together only by matching on name (see Org Charts' demo_roster.py). Set DEPOT_API_URL to
point somewhere else.
"""

import os

import httpx

DEPOT_API_URL = os.environ.get("DEPOT_API_URL", "http://localhost:8090").rstrip("/")


def fetch_person_name(person_id: str) -> str | None:
    """The Depot persona's name for a person_id, or None if Depot is down or the id isn't
    found. Fetches the Depot's small persona list (six people, cheap) rather than assuming a
    single-person endpoint exists there."""
    try:
        r = httpx.get(f"{DEPOT_API_URL}/api/people", timeout=2.0)
        r.raise_for_status()
        for p in r.json():
            if p.get("id") == person_id:
                return p.get("name")
        return None
    except httpx.HTTPError:
        return None
