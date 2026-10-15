"""One-shot schema-owner process. The serving API never receives owner credentials."""

import subprocess
import sys

from sqlalchemy import text

from app.db import engine


def main():
    # Serialise schema changes when two Compose starts overlap.
    with engine.connect() as conn:
        conn.execute(text("SELECT pg_advisory_lock(768319426)"))
        conn.commit()
        try:
            subprocess.run(
                [sys.executable, "-m", "alembic", "upgrade", "head"], check=True
            )
            with engine.begin() as setup:
                role = setup.execute(
                    text("SELECT 1 FROM pg_roles WHERE rolname='pharmacy_app'")
                ).first()
                if not role:
                    # Fixed local demo password; this database is never published to the host.
                    setup.execute(
                        text(
                            "CREATE ROLE pharmacy_app LOGIN PASSWORD 'local-app-only' NOSUPERUSER NOCREATEDB NOCREATEROLE"
                        )
                    )
                setup.execute(
                    text(
                        "ALTER ROLE pharmacy_app NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS NOINHERIT"
                    )
                )
                setup.execute(text("REVOKE CREATE ON SCHEMA public FROM PUBLIC"))
                setup.execute(
                    text(
                        "REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM pharmacy_app"
                    )
                )
                setup.execute(text("GRANT USAGE ON SCHEMA public TO pharmacy_app"))
                setup.execute(
                    text("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM pharmacy_app")
                )
                setup.execute(
                    text(
                        "GRANT SELECT ON medicines, formulary_rules, dispenses, attempts TO pharmacy_app"
                    )
                )
                setup.execute(
                    text(
                        "GRANT INSERT ON dispenses, attempts, formulary_rules TO pharmacy_app"
                    )
                )
                setup.execute(
                    text(
                        "GRANT UPDATE (effective_to) ON formulary_rules TO pharmacy_app"
                    )
                )
                # PostgreSQL locking SELECTs require UPDATE on at least one column.
                setup.execute(text("GRANT UPDATE (name) ON medicines TO pharmacy_app"))
                setup.execute(
                    text(
                        "GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO pharmacy_app"
                    )
                )
        finally:
            conn.execute(text("SELECT pg_advisory_unlock(768319426)"))
            conn.commit()


if __name__ == "__main__":
    main()
