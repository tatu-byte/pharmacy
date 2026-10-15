"""Prevent mismatched dispense/rule medicines and non-finite timestamps."""

from alembic import op

revision = "003"
down_revision = "002"


def upgrade():
    op.execute(
        "ALTER TABLE formulary_rules ADD CONSTRAINT rule_medicine_identity UNIQUE (id, medicine_code)"
    )
    op.execute("""ALTER TABLE dispenses ADD CONSTRAINT dispense_rule_medicine
        FOREIGN KEY (rule_id,medicine_code) REFERENCES formulary_rules(id,medicine_code)""")
    op.execute("""ALTER TABLE formulary_rules ADD CONSTRAINT finite_rule_period
        CHECK (isfinite(effective_from) AND (effective_to IS NULL OR isfinite(effective_to)))""")
    op.execute(
        "ALTER TABLE dispenses ADD CONSTRAINT finite_dispense_time CHECK (isfinite(dispensed_at))"
    )


def downgrade():
    op.execute("ALTER TABLE dispenses DROP CONSTRAINT finite_dispense_time")
    op.execute("ALTER TABLE formulary_rules DROP CONSTRAINT finite_rule_period")
    op.execute("ALTER TABLE dispenses DROP CONSTRAINT dispense_rule_medicine")
    op.execute("ALTER TABLE formulary_rules DROP CONSTRAINT rule_medicine_identity")
