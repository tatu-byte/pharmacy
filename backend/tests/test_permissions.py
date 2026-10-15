import pytest
from sqlalchemy import create_engine, text
from sqlalchemy.exc import ProgrammingError

from app.migrate import main as migrate_and_grant
from conftest import payload


def test_runtime_role_can_serve_but_cannot_rewrite_dispenses(database, monkeypatch):
    import app.main as api
    import app.service as service
    from app.schemas import RuleInput

    migrate_and_grant()
    # Re-running setup removes an accidental previous activity-column grant.
    with database.begin() as conn:
        conn.execute(text("GRANT UPDATE (is_active) ON medicines TO pharmacy_app"))
    migrate_and_grant()
    limited = create_engine(
        database.url.set(username="pharmacy_app", password="local-app-only"),
        connect_args={"options": "-c timezone=UTC"},
    )
    try:
        monkeypatch.setattr(service, "engine", limited)
        monkeypatch.setattr(api, "engine", limited)
        status, _ = service.dispense(payload(quantity=1))
        assert status == 201
        api.supersede(
            "MED",
            RuleInput(
                effective_from="2026-06-16",
                max_quantity_per_dispense=10,
                max_quantity_per_30_days=20,
                requires_authorisation=False,
            ),
        )
        for sql in [
            "DELETE FROM dispenses",
            "UPDATE dispenses SET quantity=99",
            "UPDATE medicines SET is_active=false",
            "DELETE FROM attempts",
            "CREATE TABLE public.forbidden (id int)",
            "SELECT * FROM alembic_version",
        ]:
            with pytest.raises(ProgrammingError), limited.begin() as conn:
                conn.execute(text(sql))
    finally:
        limited.dispose()
