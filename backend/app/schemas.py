from datetime import date, datetime, timezone
from pydantic import BaseModel, ConfigDict, Field, field_validator


class DispenseInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    medicine_code: str = Field(min_length=1, max_length=64)
    patient_ref: str = Field(min_length=1, max_length=128)
    quantity: int = Field(gt=0, le=2147483647, strict=True)
    dispensed_at: datetime
    authorisation_ref: str | None = Field(default=None, max_length=200)
    idempotency_key: str = Field(min_length=1, max_length=128)

    @field_validator('medicine_code', 'patient_ref', 'idempotency_key')
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError('Must not be blank')
        return value  # Opaque identifiers are never silently trimmed.

    @field_validator('dispensed_at')
    @classmethod
    def aware(cls, value):
        if value.tzinfo is None or value.utcoffset() is None:
            raise ValueError('Include a UTC offset, e.g. +02:00 or Z')
        return value.astimezone(timezone.utc)


class RuleInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    effective_from: date
    max_quantity_per_dispense: int = Field(gt=0, le=2147483647, strict=True)
    max_quantity_per_30_days: int = Field(gt=0, le=2147483647, strict=True)
    requires_authorisation: bool = Field(strict=True)
