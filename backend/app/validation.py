"""Shared bounds and strict parsing for data that reaches PostgreSQL/JSONB."""

import base64
import json
import math
from datetime import UTC, datetime
from typing import Annotated

from pydantic import AfterValidator, Field

MIN_DATE = datetime(2, 1, 1, tzinfo=UTC)
MAX_DATE = datetime(9999, 1, 1, tzinfo=UTC)


def safe_text(value: str) -> str:
    if "\x00" in value or any(0xD800 <= ord(char) <= 0xDFFF for char in value):
        raise ValueError("NUL and unpaired Unicode surrogates are not supported")
    return value


def nonblank(value: str) -> str:
    safe_text(value)
    if not value.strip():
        raise ValueError("Must not be blank")
    return value


def display_text(value: str) -> str:
    return value.replace("\x00", r"\u0000").encode("utf-8", "backslashreplace").decode()


def business_timestamp(value: datetime) -> datetime:
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("Include a UTC offset, e.g. +02:00 or Z")
    try:
        result = value.astimezone(UTC)
    except (ValueError, OverflowError) as exc:
        raise ValueError("Timestamp is outside the supported range") from exc
    if not MIN_DATE <= result < MAX_DATE:
        raise ValueError("Timestamp must be between years 0002 and 9998")
    return result


Code = Annotated[str, Field(min_length=1, max_length=64), AfterValidator(nonblank)]
PatientRef = Annotated[
    str, Field(min_length=1, max_length=128), AfterValidator(nonblank)
]
SafeString = Annotated[str, AfterValidator(safe_text)]


def strict_json(data: bytes):
    def finite(value):
        result = float(value)
        if not math.isfinite(result):
            raise ValueError("Non-finite JSON numbers are not supported")
        return result

    def reject(_):
        raise ValueError("Invalid JSON constant")

    def unique(pairs):
        result = {}
        for key, value in pairs:
            if key in result:
                raise ValueError("Duplicate JSON keys are not supported")
            result[key] = value
        return result

    try:
        parsed = json.loads(
            data, parse_float=finite, parse_constant=reject, object_pairs_hook=unique
        )
        stack = [(parsed, 0)]
        while stack:
            item, depth = stack.pop()
            if depth > 32:
                raise ValueError("JSON nesting exceeds 32 levels")
            if isinstance(item, dict):
                stack.extend((v, depth + 1) for v in item.values())
            elif isinstance(item, list):
                stack.extend((v, depth + 1) for v in item)
        return parsed
    except (RecursionError, UnicodeError) as exc:
        raise ValueError("Invalid JSON encoding or nesting") from exc


def audit_payload(raw):
    """JSONB rejects NUL/surrogates even in rejected inputs. Preserve these losslessly."""
    stack = [raw]
    while stack:
        item = stack.pop()
        if isinstance(item, str):
            try:
                safe_text(item)
            except ValueError:
                encoded = json.dumps(raw, ensure_ascii=True, allow_nan=False).encode(
                    "ascii"
                )
                return {
                    "audit_encoding": "base64-json",
                    "data": base64.b64encode(encoded).decode("ascii"),
                }
        elif isinstance(item, dict):
            stack.extend(item.keys())
            stack.extend(item.values())
        elif isinstance(item, list):
            stack.extend(item)
    return raw
