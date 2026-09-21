"""Rebuild the demo staffing from the OTHER apps' live data: names people from Org Charts to the
positions in Good Plan, and generates the hours they charged. REPLACES all assignments and actuals.
Run it after Good Plan or Org Charts is re-seeded (which is when old ids stop matching).

    cd backend && .venv/bin/python refresh_demo.py      # needs Good Plan (:8093) and Org Charts (:8095) running
"""

from app import create_app
from seed import apply_demo_staffing

if __name__ == "__main__":
    app = create_app()
    with app.app_context():
        print(apply_demo_staffing())
