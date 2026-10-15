"""Create an isolated disposable database; never truncate the application database."""
import os
import subprocess
import sys
import uuid
from sqlalchemy import create_engine, text
from sqlalchemy.engine import make_url

url = make_url(os.environ['DATABASE_URL'])
name = 'pharmacy_test_' + uuid.uuid4().hex
admin = create_engine(url.set(database='postgres'), isolation_level='AUTOCOMMIT')
with admin.connect() as conn:
    conn.execute(text(f'CREATE DATABASE "{name}"'))
try:
    env = dict(os.environ, DATABASE_URL=url.set(database=name).render_as_string(hide_password=False), PHARMACY_TEST_DATABASE=name)
    subprocess.run(['alembic','upgrade','head'], check=True, env=env)
    result = subprocess.run([sys.executable,'-m','pytest','-q',*sys.argv[1:]],env=env)
finally:
    with admin.connect() as conn:
        conn.execute(text(f'DROP DATABASE "{name}" WITH (FORCE)'))
    admin.dispose()
sys.exit(result.returncode)
