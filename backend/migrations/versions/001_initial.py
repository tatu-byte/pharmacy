"""Initial schema; rejection reasons initially use a legacy text representation."""

from alembic import op

revision = "001"
down_revision = None


def upgrade():
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute("""CREATE TABLE medicines (
        code varchar(64) PRIMARY KEY, name text NOT NULL, form text NOT NULL,
        strength_value numeric(12,3) NOT NULL CHECK (strength_value > 0),
        strength_unit text NOT NULL, is_active boolean NOT NULL DEFAULT true)""")
    op.execute("""CREATE TABLE formulary_rules (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        medicine_code varchar(64) NOT NULL REFERENCES medicines(code),
        effective_from timestamptz NOT NULL, effective_to timestamptz,
        max_quantity_per_dispense integer NOT NULL CHECK (max_quantity_per_dispense > 0),
        max_quantity_per_30_days integer NOT NULL CHECK (max_quantity_per_30_days > 0),
        requires_authorisation boolean NOT NULL,
        CHECK (effective_to IS NULL OR effective_to > effective_from),
        CONSTRAINT no_rule_overlap EXCLUDE USING gist
        (medicine_code WITH =, tstzrange(effective_from,effective_to,'[)') WITH &&))""")
    op.execute("""CREATE TABLE dispenses (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        medicine_code varchar(64) NOT NULL REFERENCES medicines(code),
        patient_ref varchar(128) NOT NULL CHECK (length(trim(patient_ref)) > 0),
        quantity integer NOT NULL CHECK (quantity > 0), dispensed_at timestamptz NOT NULL,
        authorisation_ref varchar(200), idempotency_key varchar(128) NOT NULL UNIQUE,
        rule_id bigint NOT NULL REFERENCES formulary_rules(id),
        rolling_limit integer NOT NULL CHECK (rolling_limit > 0),
        created_at timestamptz NOT NULL DEFAULT now())""")
    op.execute("""CREATE TABLE attempts (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
        idempotency_key varchar(128) UNIQUE, fingerprint text NOT NULL,
        request_payload jsonb NOT NULL, status integer NOT NULL,
        response jsonb NOT NULL, rejection_reasons text NOT NULL DEFAULT '[]',
        created_at timestamptz NOT NULL DEFAULT now())""")
    op.execute(
        "CREATE INDEX medicine_name_trgm ON medicines USING gin (name gin_trgm_ops)"
    )
    op.execute(
        "CREATE INDEX medicine_code_trgm ON medicines USING gin (code gin_trgm_ops)"
    )
    op.execute(
        "CREATE INDEX rule_history ON formulary_rules (medicine_code, effective_from, id)"
    )
    op.execute(
        "CREATE INDEX dispense_window ON dispenses (patient_ref, medicine_code, dispensed_at) INCLUDE (quantity,rolling_limit)"
    )
    op.execute("CREATE INDEX dispense_newest ON dispenses (dispensed_at DESC, id DESC)")
    op.execute(
        "CREATE INDEX dispense_patient_newest ON dispenses (patient_ref, dispensed_at DESC, id DESC)"
    )
    op.execute(
        "CREATE INDEX dispense_medicine_newest ON dispenses (medicine_code, dispensed_at DESC, id DESC)"
    )
    op.execute(
        "CREATE INDEX dispense_pair_newest ON dispenses (patient_ref, medicine_code, dispensed_at DESC, id DESC)"
    )


def downgrade():
    for table in ["attempts", "dispenses", "formulary_rules", "medicines"]:
        op.execute(f"DROP TABLE {table}")
    # Extensions may be shared with other applications; leave them installed.
