"""Transaction boundaries live here: outcomes, attempts and dispenses commit together."""

import hashlib
import json
from datetime import timedelta
from fastapi.encoders import jsonable_encoder
from pydantic import ValidationError
from sqlalchemy import text
from app.db import engine, one
from app.domain import LOCAL, evaluate, midnight, reason, window_start
from app.schemas import DispenseInput
from app.validation import audit_payload, display_text, safe_text


def lock_number(namespace, value):
    raw = json.dumps(
        [namespace, value], separators=(",", ":"), ensure_ascii=False
    ).encode()
    return int.from_bytes(hashlib.sha256(raw).digest()[:8], "big", signed=True)


def lock(conn, namespace, value):
    conn.execute(
        text("SELECT pg_advisory_xact_lock(:key)"),
        {"key": lock_number(namespace, value)},
    )


def error_body(errors):
    return {"error": {"code": "request_rejected", "violations": errors}}


def validation_reasons(exc):
    return [
        reason(
            e["type"],
            display_text(".".join(str(x) for x in e["loc"])),
            display_text(e["msg"]),
        )
        for e in exc.errors()
    ]


def record(conn, key, fingerprint, raw, status, response):
    encoded = jsonable_encoder(response)
    conn.execute(
        text("""INSERT INTO attempts
        (idempotency_key,fingerprint,request_payload,status,response,reasons)
        VALUES (:key,:fingerprint,CAST(:raw AS jsonb),:status,CAST(:response AS jsonb),CAST(:reasons AS jsonb))"""),
        {
            "key": key,
            "fingerprint": fingerprint,
            "raw": json.dumps(audit_payload(raw), allow_nan=False),
            "status": status,
            "response": json.dumps(encoded),
            "reasons": json.dumps(encoded.get("error", {}).get("violations", [])),
        },
    )
    return status, encoded


def dispense(raw, invalid_json=False):
    try:
        payload = DispenseInput.model_validate(raw)
        canonical = payload.model_dump(mode="json")
        invalid = []
    except ValidationError as exc:
        payload = None
        canonical = raw
        invalid = (
            [
                reason(
                    "invalid_json",
                    "",
                    "Body must be valid, finite JSON with unique keys and at most 32 nesting levels",
                )
            ]
            if invalid_json
            else validation_reasons(exc)
        )
    fingerprint = hashlib.sha256(
        json.dumps(canonical, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    candidate = raw.get("idempotency_key") if isinstance(raw, dict) else None
    key = (
        candidate
        if isinstance(candidate, str) and candidate.strip() and len(candidate) <= 128
        else None
    )
    if key is not None:
        try:
            safe_text(key)
        except ValueError:
            key = None
    with engine.begin() as conn:
        if key:
            lock(conn, "idempotency", key)
            original = one(
                conn, "SELECT * FROM attempts WHERE idempotency_key=:key", key=key
            )
            if original:
                if original["fingerprint"] != fingerprint:
                    # A conflicting reuse is logged, but never replaces the key's original outcome.
                    return record(
                        conn,
                        None,
                        fingerprint,
                        raw,
                        409,
                        error_body(
                            [
                                reason(
                                    "idempotency_conflict",
                                    "idempotency_key",
                                    "Key was used with a different payload",
                                )
                            ]
                        ),
                    )
                return original["status"], original["response"]
        if invalid:
            return record(conn, key, fingerprint, raw, 422, error_body(invalid))
        medicine = one(
            conn,
            "SELECT * FROM medicines WHERE code=:code FOR SHARE",
            code=payload.medicine_code,
        )
        lock(conn, "patient-medicine", [payload.patient_ref, payload.medicine_code])
        # READ COMMITTED: this statement sees the preceding lock holder's committed insert.
        rule = one(
            conn,
            """SELECT * FROM formulary_rules WHERE medicine_code=:code
            AND effective_from <= :at AND (effective_to IS NULL OR :at < effective_to)""",
            code=payload.medicine_code,
            at=payload.dispensed_at,
        )
        total = one(
            conn,
            """SELECT coalesce(sum(quantity),0) AS total FROM dispenses
            WHERE medicine_code=:code AND patient_ref=:patient AND dispensed_at BETWEEN :start AND :at""",
            code=payload.medicine_code,
            patient=payload.patient_ref,
            start=window_start(payload.dispensed_at),
            at=payload.dispensed_at,
        )["total"]
        errors = evaluate(payload, medicine, rule, total)
        # Also preserve limits of already accepted later events affected by a backdated insertion.
        affected = one(
            conn,
            """SELECT d.id FROM dispenses d WHERE d.patient_ref=:patient AND d.medicine_code=:code
            AND d.dispensed_at >= :at AND d.dispensed_at < :end AND
            (SELECT coalesce(sum(x.quantity),0) FROM dispenses x
             WHERE x.patient_ref=d.patient_ref AND x.medicine_code=d.medicine_code
               AND x.dispensed_at <= d.dispensed_at
               AND x.dispensed_at >= ((d.dispensed_at AT TIME ZONE 'Africa/Johannesburg')::date - 29)
                    ::timestamp AT TIME ZONE 'Africa/Johannesburg') + :quantity > d.rolling_limit LIMIT 1""",
            patient=payload.patient_ref,
            code=payload.medicine_code,
            at=payload.dispensed_at,
            quantity=payload.quantity,
            end=midnight(
                payload.dispensed_at.astimezone(LOCAL).date() + timedelta(days=30)
            ),
        )
        if affected and not any(e["code"] == "rolling_limit" for e in errors):
            errors.append(
                reason(
                    "later_window_limit",
                    "quantity",
                    "Backdated entry would breach a later dispense window",
                )
            )
        if errors:
            return record(conn, key, fingerprint, raw, 422, error_body(errors))
        row = one(
            conn,
            """INSERT INTO dispenses
            (medicine_code,patient_ref,quantity,dispensed_at,authorisation_ref,idempotency_key,rule_id,rolling_limit)
            VALUES (:code,:patient,:quantity,:at,:auth,:key,:rule,:limit) RETURNING *""",
            code=payload.medicine_code,
            patient=payload.patient_ref,
            quantity=payload.quantity,
            at=payload.dispensed_at,
            auth=payload.authorisation_ref,
            key=key,
            rule=rule["id"],
            limit=rule["max_quantity_per_30_days"],
        )
        return record(conn, key, fingerprint, raw, 201, {"data": dict(row)})
