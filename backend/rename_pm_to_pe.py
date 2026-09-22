"""One-off: relabel existing Assignment rows that froze the old 'Program Manager' category/label,
matching Good Plan's own rename of those per-project positions to 'Project Engineer'. Assignment
freezes category/position_label at creation time (see models.py's own doc comment), so Good
Plan's rename doesn't reach these on its own. Safe to re-run."""

from app import create_app
from db import db
from models import Assignment

if __name__ == "__main__":
    app = create_app()
    with app.app_context():
        rows = Assignment.query.filter_by(category="Program Manager").all()
        for a in rows:
            a.category = "Project Engineer"
            a.position_label = a.position_label.replace("Program Manager", "Project Engineer")
        db.session.commit()
        print(f"relabeled {len(rows)} assignment(s)")
