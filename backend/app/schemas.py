from datetime import date, datetime
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.validation import Code, PatientRef, SafeString, business_timestamp, nonblank


class DispenseInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    medicine_code: Code
    patient_ref: PatientRef
    quantity: int = Field(gt=0, le=2147483647, strict=True)
    dispensed_at: datetime
    authorisation_ref: Annotated[SafeString, Field(max_length=200)] | None = None
    idempotency_key: str = Field(min_length=1, max_length=128)

    @field_validator("idempotency_key")
    @classmethod
    def valid_key(cls, value):
        return nonblank(value)

    @field_validator("dispensed_at", mode="before")
    @classmethod
    def explicit_timestamp(cls, value):
        if not isinstance(value, (str, datetime)):
            raise ValueError("Use an ISO 8601 timestamp with an explicit UTC offset")
        return value

    @field_validator("dispensed_at")
    @classmethod
    def aware(cls, value):
        return business_timestamp(value)


class RuleInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    effective_from: date
    max_quantity_per_dispense: int = Field(gt=0, le=2147483647, strict=True)
    max_quantity_per_30_days: int = Field(gt=0, le=2147483647, strict=True)
    requires_authorisation: bool = Field(strict=True)

    @field_validator("effective_from", mode="before")
    @classmethod
    def explicit_date(cls, value):
        if not isinstance(value, (str, date)):
            raise ValueError("Use an ISO calendar date")
        return value

    @field_validator("effective_from")
    @classmethod
    def safe_date(cls, value):
        if not date(2, 1, 1) <= value <= date(9998, 12, 31):
            raise ValueError("Rule date must be between years 0002 and 9998")
        return value
