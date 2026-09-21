"""
Where Conway's Depot lives. LSD reads nothing else from the Depot directly — this exists because the
shared ai_client (AI_PROVIDER=depot) routes AI calls through the Depot's proxy, which holds the one
real key, and looks up the Depot's address here. Set DEPOT_API_URL to point somewhere else.
"""

import os

DEPOT_API_URL = os.environ.get("DEPOT_API_URL", "http://localhost:8090").rstrip("/")
