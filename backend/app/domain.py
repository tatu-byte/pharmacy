"""Pure business-time and rule evaluation helpers. No database or HTTP imports."""

from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

LOCAL = ZoneInfo("Africa/Johannesburg")


def midnight(day):
    return datetime.combine(day, time.min, LOCAL).astimezone(timezone.utc)


def window_start(at):
    """Thirty local calendar dates, inclusive; upper bound is the event instant."""
    return midnight(at.astimezone(LOCAL).date() - timedelta(days=29))


def reason(code, field, message):
    return {"code": code, "field": field, "message": message}


def evaluate(payload, medicine, rule, prior_total):
    errors = []
    if not medicine:
        return [
            reason("medicine_not_found", "medicine_code", "Medicine does not exist")
        ]
    if not medicine["is_active"]:
        errors.append(
            reason("inactive_medicine", "medicine_code", "Medicine is inactive")
        )
    if not rule:
        errors.append(reason("no_rule", "dispensed_at", "No rule applies at this time"))
        return errors
    if payload.quantity > rule["max_quantity_per_dispense"]:
        errors.append(
            reason("per_dispense_limit", "quantity", "Single-dispense limit exceeded")
        )
    if prior_total + payload.quantity > rule["max_quantity_per_30_days"]:
        errors.append(reason("rolling_limit", "quantity", "30-day limit exceeded"))
    if rule["requires_authorisation"] and not (payload.authorisation_ref or "").strip():
        errors.append(
            reason(
                "authorisation_required",
                "authorisation_ref",
                "Authorisation reference is required",
            )
        )
    return errors
