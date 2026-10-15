"""Idempotent, synthetic seed. Never includes real patient information."""
from datetime import datetime, timedelta
from sqlalchemy import text
from app.db import engine, one
from app.domain import LOCAL, midnight
from app.service import dispense, lock


def main():
    # Persist the anchor once so rerunning on another day does not move historical periods.
    with engine.begin() as conn:
        lock(conn, 'seed', 'catalogue')
        existing = one(conn, "SELECT min(effective_from) AS start FROM formulary_rules WHERE medicine_code='MED0001'")
        anchor = existing['start'].astimezone(LOCAL).date() if existing['start'] else datetime.now(LOCAL).date()-timedelta(days=730)
        for i in range(1,501):
            code = f'MED{i:04d}'
            conn.execute(text('''INSERT INTO medicines(code,name,form,strength_value,strength_unit,is_active)
                VALUES (:code,:name,'tablet',:strength,'mg',:active) ON CONFLICT (code) DO NOTHING'''),
                {'code':code,'name':f'Generated Medicine {i:04d}','strength':(i%10+1)*50,'active':i%20!=0})
            if one(conn, 'SELECT id FROM formulary_rules WHERE medicine_code=:code LIMIT 1', code=code):
                continue
            offsets = [0,183,366,549]
            for j, offset in enumerate(offsets):
                conn.execute(text('''INSERT INTO formulary_rules(medicine_code,effective_from,effective_to,
                    max_quantity_per_dispense,max_quantity_per_30_days,requires_authorisation)
                    VALUES (:code,:start,:end,:single,:rolling,:auth)'''),
                    {'code':code,'start':midnight(anchor+timedelta(days=offset)),
                     'end':midnight(anchor+timedelta(days=offsets[j+1])) if j<3 else None,
                     'single':30+j*10,'rolling':90+j*30,'auth':j%2==1})
    active = [i for i in range(1,501) if i%20!=0]
    for i in range(2000):
        at = midnight(anchor+timedelta(days=(i*37)%730))+timedelta(hours=12)
        status, body = dispense({'medicine_code':f'MED{active[i%len(active)]:04d}',
            'patient_ref':f'SYNTHETIC-{i:05d}', 'quantity':1+i%10,
            'dispensed_at':at.isoformat(), 'authorisation_ref':'SYNTHETIC-AUTH',
            'idempotency_key':f'seed-v1-{i}'})
        if status != 201:
            raise RuntimeError(f'Seed entry {i} rejected: {body}')
    print('Seed complete: 500 medicines, 2,000 rules, 2,000 dispenses and distinct patient references. Safe to rerun.')


if __name__ == '__main__':
    main()
