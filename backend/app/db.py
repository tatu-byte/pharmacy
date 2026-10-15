import os
from sqlalchemy import create_engine, text

DATABASE_URL = os.getenv(
    "DATABASE_URL", "postgresql+psycopg://pharmacy_app:local-app-only@db/pharmacy"
)
engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    pool_size=10,
    max_overflow=10,
    pool_timeout=5,
    connect_args={
        "connect_timeout": 5,
        "options": "-c timezone=UTC -c statement_timeout=5000 -c lock_timeout=3000 -c idle_in_transaction_session_timeout=15000",
    },
)


def one(conn, sql, **params):
    return conn.execute(text(sql), params).mappings().first()


def many(conn, sql, **params):
    return conn.execute(text(sql), params).mappings().all()
