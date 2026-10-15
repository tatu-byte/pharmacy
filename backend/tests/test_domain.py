import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from app.domain import evaluate, window_start


class DomainTests(unittest.TestCase):
    def test_window_crosses_utc_date_and_year(self):
        event = datetime.fromisoformat("2026-01-01T00:01:00+02:00")
        self.assertEqual(
            window_start(event), datetime(2025, 12, 2, 22, tzinfo=timezone.utc)
        )

    def test_leap_year(self):
        self.assertEqual(
            window_start(datetime.fromisoformat("2024-03-01T12:00:00+02:00")),
            datetime.fromisoformat("2024-02-01T00:00:00+02:00"),
        )

    def test_all_independent_failures(self):
        errors = evaluate(
            SimpleNamespace(quantity=20, authorisation_ref=" "),
            {"is_active": False},
            {
                "max_quantity_per_dispense": 5,
                "max_quantity_per_30_days": 10,
                "requires_authorisation": True,
            },
            0,
        )
        self.assertEqual(
            {e["code"] for e in errors},
            {
                "inactive_medicine",
                "per_dispense_limit",
                "rolling_limit",
                "authorisation_required",
            },
        )

    def test_no_rule_and_inactive_both_reported(self):
        errors = evaluate(SimpleNamespace(quantity=1), {"is_active": False}, None, 0)
        self.assertEqual([e["code"] for e in errors], ["inactive_medicine", "no_rule"])

    def test_exact_limit_accepted(self):
        self.assertEqual(
            evaluate(
                SimpleNamespace(quantity=5, authorisation_ref=None),
                {"is_active": True},
                {
                    "max_quantity_per_dispense": 5,
                    "max_quantity_per_30_days": 10,
                    "requires_authorisation": False,
                },
                5,
            ),
            [],
        )

    def test_missing_medicine(self):
        self.assertEqual(evaluate(None, None, None, 0)[0]["code"], "medicine_not_found")


if __name__ == "__main__":
    unittest.main()
