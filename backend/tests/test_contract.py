"""Input and HTTP contracts that do not require a running database."""

from datetime import timezone
import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError
from app.schemas import DispenseInput
from app.main import app
from conftest import payload


@pytest.mark.parametrize(
    "change",
    [
        {"quantity": True},
        {"quantity": 1.5},
        {"quantity": 2147483648},
        {"quantity": 0},
        {"patient_ref": " "},
        {"idempotency_key": ""},
        {"medicine_code": " "},
        {"dispensed_at": "2026-06-15T12:00:00"},
        {"unexpected": 1},
    ],
)
def test_reject_invalid_input(change):
    with pytest.raises(ValidationError):
        DispenseInput.model_validate(payload(**change))


def test_utc_canonicalisation():
    first = DispenseInput.model_validate(payload())
    second = DispenseInput.model_validate(payload(dispensed_at="2026-06-15T10:00:00Z"))
    assert first.model_dump(mode="json") == second.model_dump(mode="json")
    assert first.dispensed_at.tzinfo == timezone.utc


def test_validation_errors_use_uniform_envelope():
    with TestClient(app, base_url="http://localhost") as client:
        response = client.get("/api/v1/medicines?limit=0")
        assert response.status_code == 422
        assert response.json()["error"]["violations"][0]["field"] == "limit"
        response = client.get("/does-not-exist")
        assert response.status_code == 404
        assert "violations" in response.json()["error"]


def test_openapi_includes_dispense_request_schema():
    schema = app.openapi()["paths"]["/api/v1/dispenses"]["post"]["requestBody"][
        "content"
    ]["application/json"]["schema"]
    assert "idempotency_key" in schema["required"]


def test_transport_routes_malformed_json_to_attempt_service(monkeypatch):
    import app.main as module

    seen = []

    def fake(raw, **kwargs):
        seen.append(raw)
        return 422, {"error": {"code": "request_rejected", "violations": []}}

    monkeypatch.setattr(module, "dispense", fake)
    with TestClient(app, base_url="http://localhost") as client:
        assert (
            client.post(
                "/api/v1/dispenses",
                content="{",
                headers={"Content-Type": "application/json"},
            ).status_code
            == 422
        )
        assert (
            client.post(
                "/api/v1/dispenses",
                content='{"quantity":NaN}',
                headers={"Content-Type": "application/json"},
            ).status_code
            == 422
        )
    assert seen == [None, None]
