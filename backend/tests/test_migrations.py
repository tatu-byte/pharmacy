import json
import subprocess
from sqlalchemy import text
from app.db import one


def migrate(*args):
    subprocess.run(['alembic',*args],check=True)


def test_data_transformation_round_trip(database):
    reasons=[{'code':'legacy','field':'quantity','message':'Original reason'}]
    with database.begin() as conn:
        conn.execute(text('''INSERT INTO attempts(fingerprint,request_payload,status,response,reasons)
            VALUES ('legacy','{}',422,'{}',CAST(:r AS jsonb))'''),{'r':json.dumps(reasons)})
    migrate('downgrade','001')
    with database.connect() as conn:
        assert json.loads(one(conn,'SELECT rejection_reasons FROM attempts')['rejection_reasons'])==reasons
    migrate('upgrade','head')
    with database.connect() as conn:
        assert one(conn,'SELECT reasons FROM attempts')['reasons']==reasons
    migrate('downgrade','base')
    migrate('upgrade','head')
    with database.connect() as conn:
        assert one(conn,'SELECT count(*) AS n FROM attempts')['n']==0
