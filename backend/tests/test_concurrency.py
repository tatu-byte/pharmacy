"""Force overlap and observe real PostgreSQL lock waiters; no sleep-only race tests."""

import time
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from fastapi.testclient import TestClient
from sqlalchemy import text
from app.main import app
from app.service import lock, lock_number
from app.db import one
from conftest import payload


def wait_for_waiters(database, key, count):
    # pg_locks represents a signed bigint as two unsigned 32-bit components.
    high, low = (key & ((1 << 64) - 1)) >> 32, key & 0xFFFFFFFF
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        with database.connect() as conn:
            n = one(
                conn,
                """SELECT count(*) AS n FROM pg_locks WHERE locktype='advisory'
                AND NOT granted AND classid::bigint=:high AND objid::bigint=:low""",
                high=high,
                low=low,
            )["n"]
        if n >= count:
            return
        time.sleep(0.02)
    raise AssertionError(
        f"Did not observe {count} overlapping lock waiters; locking may be missing"
    )


def concurrent_posts(database, bodies, namespace, value):
    gate = database.connect()
    tx = gate.begin()
    lock(gate, namespace, value)
    barrier = Barrier(len(bodies) + 1)

    def submit(body):
        with TestClient(app, base_url="http://localhost") as client:
            barrier.wait(timeout=10)
            return client.post("/api/v1/dispenses", json=body)

    with ThreadPoolExecutor(max_workers=len(bodies)) as pool:
        futures = [pool.submit(submit, b) for b in bodies]
        try:
            barrier.wait(timeout=10)
            wait_for_waiters(database, lock_number(namespace, value), len(bodies))
        finally:
            tx.rollback()
            gate.close()  # Release even if the assertion fails.
        return [f.result(timeout=15) for f in futures]


def test_simultaneous_dispenses_cannot_jointly_breach(database):
    results = concurrent_posts(
        database,
        [payload(), payload(idempotency_key="key-2")],
        "patient-medicine",
        ["PATIENT", "MED"],
    )
    assert sorted(r.status_code for r in results) == [201, 422]
    with database.connect() as conn:
        assert one(conn, "SELECT sum(quantity) AS q FROM dispenses")["q"] == 6
        assert one(conn, "SELECT count(*) AS n FROM attempts")["n"] == 2


def test_simultaneous_idempotent_requests_create_once(database):
    results = concurrent_posts(database, [payload(), payload()], "idempotency", "key-1")
    assert [r.status_code for r in results] == [201, 201]
    assert results[0].json() == results[1].json()
    with database.connect() as conn:
        assert one(conn, "SELECT count(*) AS n FROM dispenses")["n"] == 1
        assert one(conn, "SELECT count(*) AS n FROM attempts")["n"] == 1


def test_concurrent_rule_overlap_is_impossible(database):
    # Two direct writers bypass all application validation. Writer B must wait for A,
    # then fail the exclusion constraint when A commits.
    from sqlalchemy.exc import IntegrityError

    with database.begin() as conn:
        conn.execute(text("DELETE FROM formulary_rules"))
    first = database.connect()
    tx = first.begin()
    sql = text("""INSERT INTO formulary_rules(medicine_code,effective_from,max_quantity_per_dispense,max_quantity_per_30_days,requires_authorisation)
        VALUES ('MED','2026-01-01T00:00:00Z',10,10,false)""")
    first.execute(sql)

    def second():
        try:
            with database.begin() as conn:
                conn.execute(text("SET LOCAL application_name='rule-overlap-test'"))
                conn.execute(sql)
            return "accepted"
        except IntegrityError as exc:
            return exc.orig.sqlstate

    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(second)
        try:
            deadline = time.monotonic() + 10
            blocked = False
            while time.monotonic() < deadline:
                with database.connect() as conn:
                    blocked = bool(
                        one(
                            conn,
                            """SELECT count(*) AS n FROM pg_stat_activity
                        WHERE application_name='rule-overlap-test' AND wait_event_type='Lock'""",
                        )["n"]
                    )
                if blocked:
                    break
                time.sleep(0.02)
            assert blocked, "Second rule writer did not demonstrably overlap"
        finally:
            tx.commit()
            first.close()
        assert future.result(timeout=15) == "23P01"
