import os
import pytest
from sqlalchemy import text
from sqlalchemy.engine import make_url
from app.db import engine


@pytest.fixture
def database():
    expected = os.environ.get("PHARMACY_TEST_DATABASE", "")
    assert (
        expected.startswith("pharmacy_test_")
        and make_url(str(engine.url)).database == expected
    ), "Use python run_tests.py"
    with engine.begin() as conn:
        conn.execute(
            text(
                "TRUNCATE attempts, dispenses, formulary_rules, medicines RESTART IDENTITY CASCADE"
            )
        )
        conn.execute(
            text(
                "INSERT INTO medicines VALUES ('MED','Test medicine','tablet',500,'mg',true)"
            )
        )
        conn.execute(
            text("""INSERT INTO formulary_rules(medicine_code,effective_from,max_quantity_per_dispense,
            max_quantity_per_30_days,requires_authorisation) VALUES ('MED','2020-01-01T00:00:00+02:00',10,10,false)""")
        )
    yield engine


@pytest.fixture
def client(database):
    from fastapi.testclient import TestClient
    from app.main import app

    with TestClient(app, base_url="http://localhost") as client:
        yield client


def payload(**changes):
    result = {
        "medicine_code": "MED",
        "patient_ref": "PATIENT",
        "quantity": 6,
        "dispensed_at": "2026-06-15T12:00:00+02:00",
        "idempotency_key": "key-1",
    }
    result.update(changes)
    return result
