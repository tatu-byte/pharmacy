"""HTTP first-page latency and EXPLAIN evidence; exits nonzero above 300ms p95."""
import argparse
import json
import math
import os
import platform
import time
from datetime import datetime, timezone
from pathlib import Path
import httpx
from sqlalchemy import text
from app.db import engine, one


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--base-url',default='http://localhost:8000')
    parser.add_argument('--samples',type=int,default=200)
    parser.add_argument('--output',default='/tmp/pharmacy-benchmark.json')
    args=parser.parse_args()
    if args.samples < 20:
        parser.error('Use at least 20 measured requests per case')
    with engine.begin() as conn:
        conn.execute(text('ANALYZE'))
        counts=dict(one(conn, '''SELECT (SELECT count(*) FROM medicines) AS medicines,
            (SELECT count(*) FROM formulary_rules) AS rules,
            (SELECT count(*) FROM dispenses) AS dispenses,
            (SELECT count(DISTINCT patient_ref) FROM dispenses) AS patients'''))
    if counts['medicines']<500 or counts['rules']<1500 or counts['dispenses']<2000 or counts['patients']<2000:
        raise SystemExit('Run python -m app.seed before benchmarking')
    cases={
        'medicines':'/api/v1/medicines',
        'medicine_search':'/api/v1/medicines?q=Medicine',
        'code_search':'/api/v1/medicines?q=MED001',
        'rule_history':'/api/v1/medicines/MED0001/rules',
        'dispenses':'/api/v1/dispenses',
        'patient_ledger':'/api/v1/dispenses?patient_ref=SYNTHETIC-00000',
        'medicine_ledger':'/api/v1/dispenses?medicine=MED0001',
        'patient_medicine_ledger':'/api/v1/dispenses?patient_ref=SYNTHETIC-00000&medicine=MED0001',
    }
    report={'measured_at':datetime.now(timezone.utc).isoformat(),'platform':platform.platform(),
            'cpu_count':os.cpu_count(),'samples_per_case':args.samples,'warmup_per_case':20,
            'concurrency':1,'base_url':args.base_url,'dataset':counts,'results':{}}
    with httpx.Client(base_url=args.base_url,timeout=10) as client:
        for name,path in cases.items():
            for _ in range(20): client.get(path).raise_for_status()
            times=[]
            for _ in range(args.samples):
                start=time.perf_counter()
                response=client.get(path); response.raise_for_status(); response.json()
                times.append((time.perf_counter()-start)*1000)
            times.sort()
            report['results'][name]={'p50_ms':times[math.ceil(len(times)*.5)-1],
                'p95_ms':times[math.ceil(len(times)*.95)-1], 'max_ms':times[-1]}
    plans={
        'search':("SELECT * FROM medicines WHERE name ILIKE :q OR code ILIKE :q ORDER BY code LIMIT 25",{'q':'%MED001%'}),
        'rules':("SELECT * FROM formulary_rules WHERE medicine_code=:code ORDER BY effective_from LIMIT 25",{'code':'MED0001'}),
        'ledger':("SELECT * FROM dispenses WHERE patient_ref=:patient ORDER BY dispensed_at DESC,id DESC LIMIT 25",{'patient':'SYNTHETIC-00000'}),
        'window':("SELECT sum(quantity) FROM dispenses WHERE patient_ref=:patient AND medicine_code=:code AND dispensed_at BETWEEN now()-interval '30 days' AND now()",{'patient':'SYNTHETIC-00000','code':'MED0001'}),
    }
    report['query_plans']={}
    with engine.connect() as conn:
        for name,(sql,params) in plans.items():
            report['query_plans'][name]=conn.execute(text('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) '+sql),params).scalar_one()
    report['passed']=all(r['p95_ms']<300 for r in report['results'].values())
    Path(args.output).write_text(json.dumps(report,indent=2))
    print(json.dumps(report,indent=2))
    if not report['passed']: raise SystemExit(1)


if __name__=='__main__': main()
