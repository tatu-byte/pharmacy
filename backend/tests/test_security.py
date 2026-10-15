import asyncio
import base64
import json

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.guards import MAX_BODY, RequestGuards
from app.main import app, cursor_encode
from app.schemas import DispenseInput, RuleInput
from app.validation import audit_payload, strict_json
from conftest import payload


@pytest.mark.parametrize("value", ["\x00", "\ud800", "\udfff"])
@pytest.mark.parametrize(
    "field", ["medicine_code", "patient_ref", "idempotency_key", "authorisation_ref"]
)
def test_postgres_unsafe_strings_rejected(field, value):
    with pytest.raises(ValidationError):
        DispenseInput.model_validate(payload(**{field: value}))


@pytest.mark.parametrize(
    "value", ["0001-01-01T00:00:00+02:00", "9999-12-31T23:59:59Z", 0, True]
)
def test_unrepresentable_or_implicit_timestamps_rejected(value):
    with pytest.raises(ValidationError):
        DispenseInput.model_validate(payload(dispensed_at=value))


@pytest.mark.parametrize("value", ["0001-01-01", "9999-12-31", 0])
def test_rule_dates_reject_overflow(value):
    with pytest.raises(ValidationError):
        RuleInput(
            effective_from=value,
            max_quantity_per_dispense=1,
            max_quantity_per_30_days=2,
            requires_authorisation=False,
        )


@pytest.mark.parametrize(
    "body",
    [
        b'{"x":NaN}',
        b'{"x":1e999}',
        b'{"x":1,"x":2}',
        b"[" * 40 + b"0" + b"]" * 40,
        b"[" * 1500 + b"]" * 1500,
        b"\xff",
    ],
    ids=["nan", "overflow", "duplicate-keys", "depth-40", "depth-1500", "invalid-utf8"],
)
def test_strict_json_bounds(body):
    with pytest.raises(ValueError):
        strict_json(body)


def test_lossless_audit_of_unrepresentable_jsonb_values():
    raw = {"patient_ref": "a\x00b", "extra\ud800": ["\udfff"]}
    stored = audit_payload(raw)
    assert stored["audit_encoding"] == "base64-json"
    assert json.loads(base64.b64decode(stored["data"])) == raw
    assert "\\u0000" not in json.dumps(stored)
    assert audit_payload({"emoji": "💊"}) == {"emoji": "💊"}


@pytest.mark.parametrize(
    "position",
    [
        [],
        {},
        ["2026-01-01T00:00:00Z", True],
        ["2026-01-01T00:00:00Z", 1.2],
        ["2026-01-01T00:00:00Z", 2**64],
        ["2026-01-01T00:00:00Z", -1],
        ["9999-12-31T23:59:59Z", 1],
        None,
    ],
)
def test_untrusted_dispense_cursor_never_reaches_database(position):
    token = cursor_encode(
        {"kind": "dispenses", "filters": [None, None], "position": position}
    )
    with TestClient(app, base_url="http://localhost") as client:
        response = client.get("/api/v1/dispenses", params={"cursor": token})
    assert response.status_code == 422
    assert response.json()["error"]["violations"][0]["code"] == "invalid_cursor"


@pytest.mark.parametrize(
    "path",
    [
        "/api/v1/medicines?q=%00",
        "/api/v1/medicines/%00",
        "/api/v1/dispenses?patient_ref=%00",
        "/api/v1/dispenses?patient_ref=%20",
    ],
)
def test_query_strings_validated_before_database(path):
    with TestClient(app, base_url="http://localhost") as client:
        assert client.get(path).status_code == 422


@pytest.mark.parametrize(
    ("headers", "status"),
    [
        ({"Content-Type": "text/plain"}, 415),
        (
            {"Content-Type": "application/json", "Origin": "https://attacker.example"},
            403,
        ),
        ({"Content-Type": "application/json", "Origin": "null"}, 403),
        ({"Content-Type": "application/json", "Sec-Fetch-Site": "cross-site"}, 403),
        ({"Content-Type": "application/json", "Host": "attacker.example"}, 400),
        ({"Content-Type": "application/json", "Content-Encoding": "gzip"}, 415),
    ],
)
def test_cross_site_and_unsupported_requests_blocked(headers, status):
    with TestClient(app, base_url="http://localhost") as client:
        response = client.post("/api/v1/dispenses", content="{}", headers=headers)
    assert response.status_code == status
    assert response.json()["error"]["violations"]


def test_streaming_body_limit_cannot_be_bypassed_with_false_length():
    async def check():
        called = False

        async def inner(scope, receive, send):
            nonlocal called
            called = True

        pieces = iter(
            [
                {"type": "http.request", "body": b"x" * MAX_BODY, "more_body": True},
                {"type": "http.request", "body": b"x", "more_body": False},
            ]
        )

        async def receive():
            return next(pieces)

        messages = []

        async def send(message):
            messages.append(message)

        scope = {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/dispenses",
            "headers": [
                (b"host", b"localhost"),
                (b"content-type", b"application/json"),
                (b"content-length", b"1"),
            ],
        }
        await RequestGuards(inner)(scope, receive, send)
        assert messages[0]["status"] == 413
        assert not called

    asyncio.run(check())


def test_invalid_json_still_reaches_persisting_service(monkeypatch):
    import app.main as module

    seen = []

    def capture(raw, **kwargs):
        seen.append((raw, kwargs))
        return 422, {"error": {"code": "request_rejected", "violations": []}}

    monkeypatch.setattr(module, "dispense", capture)
    with TestClient(app, base_url="http://localhost") as client:
        response = client.post(
            "/api/v1/dispenses",
            content='{"x":1e999}',
            headers={"Content-Type": "application/json"},
        )
    assert response.status_code == 422
    assert seen == [(None, {"invalid_json": True})]
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
