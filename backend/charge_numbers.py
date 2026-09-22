"""
Charge numbers — invented for the demo, since a real one only exists once a project is actually
set up in S4. Structured PROJECT-WBS (e.g. "CN-4471-13"): the project's short code plus the Good
Plan labor line's WBS element, the same split the user asked for (a project id, then a functional
area/material/ODC code). This is the one place that formula lives — seed.py's mocked S4 actuals
and /api/my-charges both derive from it, so what a person is told to charge to and what the
(mocked) actuals show them having charged always agree.
"""

CHARGE_BASE = {
    "Bracket Assembly Program": "CN-4471",
    "Nacelle Fairing Retrofit": "CN-5820",
    "Radar Housing Production": "CN-6103",
}


def charge_number_for(project_name: str, wbs: str | None) -> str | None:
    """None means "not chargeable yet" — a pursuit that hasn't been set up in S4, or a position
    with no WBS element recorded."""
    base = CHARGE_BASE.get(project_name)
    if not base or not wbs:
        return None
    return f"{base}-{wbs.replace('.', '')}"
