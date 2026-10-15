import pytest
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from conftest import payload


def rule(date, single=20):
    return {
        "effective_from": date,
        "max_quantity_per_dispense": single,
        "max_quantity_per_30_days": 30,
        "requires_authorisation": False,
    }


def test_split_and_historical_evaluation(client):
    assert (
        client.post("/api/v1/medicines/MED/rules", json=rule("2026-06-01")).status_code
        == 201
    )
    rows = client.get("/api/v1/medicines/MED/rules").json()["data"]
    assert len(rows) == 2 and rows[0]["effective_to"] == rows[1]["effective_from"]
    old = client.post(
        "/api/v1/dispenses",
        json=payload(quantity=11, dispensed_at="2026-05-31T23:59:59+02:00"),
    )
    assert old.status_code == 422
    new = client.post(
        "/api/v1/dispenses",
        json=payload(
            idempotency_key="two", quantity=11, dispensed_at="2026-06-01T00:00:00+02:00"
        ),
    )
    assert new.status_code == 201


def test_middle_split_preserves_scheduled_rule(client):
    assert (
        client.post("/api/v1/medicines/MED/rules", json=rule("2027-01-01")).status_code
        == 201
    )
    assert (
        client.post("/api/v1/medicines/MED/rules", json=rule("2026-06-01")).status_code
        == 201
    )
    rows = client.get("/api/v1/medicines/MED/rules").json()["data"]
    assert len(rows) == 3 and rows[1]["effective_to"] == rows[2]["effective_from"]
    assert (
        client.post("/api/v1/medicines/MED/rules", json=rule("2026-06-01")).status_code
        == 409
    )


def test_cannot_rewrite_accepted_history(client):
    assert client.post("/api/v1/dispenses", json=payload()).status_code == 201
    assert (
        client.post("/api/v1/medicines/MED/rules", json=rule("2026-06-01")).status_code
        == 409
    )
    assert len(client.get("/api/v1/medicines/MED/rules").json()["data"]) == 1
    assert (
        client.post("/api/v1/medicines/MED/rules", json=rule("2026-06-16")).status_code
        == 201
    )


def test_overlap_constraint_rejects_direct_sql(database):
    with pytest.raises(IntegrityError):
        with database.begin() as conn:
            conn.execute(
                text("""INSERT INTO formulary_rules(medicine_code,effective_from,max_quantity_per_dispense,max_quantity_per_30_days,requires_authorisation)
                VALUES ('MED','2026-01-01T00:00:00Z',10,10,false)""")
            )


def test_rule_history_paginates(client):
    for day in ["2027-01-01", "2028-01-01", "2029-01-01"]:
        assert (
            client.post("/api/v1/medicines/MED/rules", json=rule(day)).status_code
            == 201
        )
    first = client.get("/api/v1/medicines/MED/rules?limit=2").json()
    second = client.get(
        "/api/v1/medicines/MED/rules",
        params={"limit": 2, "cursor": first["next_cursor"]},
    ).json()
    assert len(first["data"] + second["data"]) == 4 and second["next_cursor"] is None


def test_dispense_cannot_reference_another_medicines_rule(database):
    with database.begin() as conn:
        conn.execute(
            text("INSERT INTO medicines VALUES ('OTHER','Other','tablet',1,'mg',true)")
        )
    with pytest.raises(IntegrityError), database.begin() as conn:
        conn.execute(
            text("""INSERT INTO dispenses(medicine_code,patient_ref,quantity,dispensed_at,idempotency_key,rule_id,rolling_limit)
            VALUES ('OTHER','P',1,'2026-01-01T00:00:00Z','mismatched',1,10)""")
        )


def test_infinite_rule_period_rejected(database):
    with pytest.raises(IntegrityError), database.begin() as conn:
        conn.execute(text("UPDATE formulary_rules SET effective_from='-infinity'"))
