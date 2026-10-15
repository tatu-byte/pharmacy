import os
from sqlalchemy import create_engine, text

DATABASE_URL = os.getenv('DATABASE_URL', 'postgresql+psycopg://pharmacy:pharmacy@db/pharmacy')
engine = create_engine(DATABASE_URL, pool_pre_ping=True, pool_size=10, max_overflow=10,
                       connect_args={'options': '-c timezone=UTC'})


def one(conn, sql, **params):
    return conn.execute(text(sql), params).mappings().first()


def many(conn, sql, **params):
    return conn.execute(text(sql), params).mappings().all()
