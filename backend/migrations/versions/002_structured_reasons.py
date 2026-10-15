"""Transform existing legacy text reasons into queryable JSONB, reversibly."""

from alembic import op

revision = "002"
down_revision = "001"


def upgrade():
    op.execute("ALTER TABLE attempts ADD COLUMN reasons jsonb")
    op.execute("UPDATE attempts SET reasons = rejection_reasons::jsonb")
    op.execute("ALTER TABLE attempts ALTER COLUMN reasons SET DEFAULT '[]'::jsonb")
    op.execute("ALTER TABLE attempts ALTER COLUMN reasons SET NOT NULL")
    op.execute("ALTER TABLE attempts DROP COLUMN rejection_reasons")


def downgrade():
    op.execute("ALTER TABLE attempts ADD COLUMN rejection_reasons text")
    op.execute("UPDATE attempts SET rejection_reasons = reasons::text")
    op.execute("ALTER TABLE attempts ALTER COLUMN rejection_reasons SET DEFAULT '[]'")
    op.execute("ALTER TABLE attempts ALTER COLUMN rejection_reasons SET NOT NULL")
    op.execute("ALTER TABLE attempts DROP COLUMN reasons")
