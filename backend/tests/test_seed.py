from sqlalchemy import text
from app.db import one
from app.seed import main


def test_seed_volume_and_repeatability(database):
    with database.begin() as conn:
        conn.execute(text('TRUNCATE attempts,dispenses,formulary_rules,medicines RESTART IDENTITY CASCADE'))
    main()
    main()
    with database.connect() as conn:
        assert one(conn,'SELECT count(*) AS n FROM medicines')['n']==500
        assert one(conn,'SELECT count(*) AS n FROM formulary_rules')['n']==2000
        assert one(conn,'SELECT count(*) AS n FROM dispenses')['n']==2000
        assert one(conn,'SELECT count(DISTINCT patient_ref) AS n FROM dispenses')['n']==2000
        assert one(conn,'SELECT count(*) AS n FROM attempts')['n']==2000
        assert one(conn,'SELECT max(dispensed_at)-min(dispensed_at) AS span FROM dispenses')['span'].days==729
        assert one(conn,'''SELECT count(*) AS n FROM (
            SELECT medicine_code FROM formulary_rules GROUP BY medicine_code HAVING count(*) NOT BETWEEN 3 AND 5) x''')['n']==0
