from datetime import datetime
from sqlalchemy import text
from app.db import one
from conftest import payload


def codes(response):
    return {v['code'] for v in response.json()['error']['violations']}


def test_accept_replay_and_conflict(client,database):
    body=payload()
    first=client.post('/api/v1/dispenses',json=body)
    assert first.status_code==201
    assert client.post('/api/v1/dispenses',json=body).json()==first.json()
    equivalent=payload(dispensed_at='2026-06-15T10:00:00Z')
    assert client.post('/api/v1/dispenses',json=equivalent).json()==first.json()
    conflict=client.post('/api/v1/dispenses',json=payload(quantity=1))
    assert conflict.status_code==409 and 'idempotency_conflict' in codes(conflict)
    with database.connect() as conn:
        assert one(conn,'SELECT count(*) AS n FROM dispenses')['n']==1
        assert one(conn,"SELECT count(*) AS n FROM attempts WHERE idempotency_key='key-1'")['n']==1


def test_all_reasons_and_rejected_replay(client,database):
    with database.begin() as conn:
        conn.execute(text('UPDATE medicines SET is_active=false'))
        conn.execute(text('UPDATE formulary_rules SET requires_authorisation=true'))
    body=payload(quantity=11,authorisation_ref=' ')
    response=client.post('/api/v1/dispenses',json=body)
    assert response.status_code==422
    assert codes(response)=={'inactive_medicine','per_dispense_limit','rolling_limit','authorisation_required'}
    with database.begin() as conn:
        assert one(conn,'SELECT count(*) AS n FROM dispenses')['n']==0
        assert len(one(conn,'SELECT reasons FROM attempts')['reasons'])==4
        conn.execute(text('UPDATE medicines SET is_active=true'))
    assert client.post('/api/v1/dispenses',json=body).json()==response.json()
    with database.connect() as conn:
        assert one(conn,'SELECT count(*) AS n FROM attempts')['n']==1


def test_unknown_and_missing_rule(client):
    assert 'medicine_not_found' in codes(client.post('/api/v1/dispenses',json=payload(medicine_code='NO')))
    assert 'no_rule' in codes(client.post('/api/v1/dispenses',json=payload(idempotency_key='other',dispensed_at='2019-01-01T12:00:00Z')))


def test_validation_logged_and_replayed(client,database):
    body=payload(quantity=0,dispensed_at='2026-06-15T12:00:00')
    first=client.post('/api/v1/dispenses',json=body)
    assert first.status_code==422
    assert len(first.json()['error']['violations'])==2
    assert client.post('/api/v1/dispenses',json=body).json()==first.json()
    with database.connect() as conn:
        assert one(conn,'SELECT count(*) AS n FROM attempts')['n']==1
        assert one(conn,'SELECT count(*) AS n FROM dispenses')['n']==0
    assert client.post('/api/v1/dispenses',content='{').status_code==422


def test_backdated_counts_occurrence_not_recording_time(client):
    assert client.post('/api/v1/dispenses',json=payload(dispensed_at='2026-06-10T12:00:00+02:00')).status_code==201
    result=client.post('/api/v1/dispenses',json=payload(idempotency_key='two',dispensed_at='2026-06-15T12:00:00+02:00'))
    assert result.status_code==422 and 'rolling_limit' in codes(result)


def test_backdated_preserves_later_windows(client):
    assert client.post('/api/v1/dispenses',json=payload()).status_code==201
    result=client.post('/api/v1/dispenses',json=payload(idempotency_key='two',dispensed_at='2026-06-10T12:00:00+02:00'))
    assert result.status_code==422 and 'later_window_limit' in codes(result)


def test_window_lower_boundary_inclusive(client):
    assert client.post('/api/v1/dispenses',json=payload(dispensed_at='2026-05-17T00:00:00+02:00')).status_code==201
    assert 'rolling_limit' in codes(client.post('/api/v1/dispenses',json=payload(idempotency_key='two')))


def test_outside_window_not_counted(client):
    assert client.post('/api/v1/dispenses',json=payload(dispensed_at='2026-05-16T23:59:59+02:00')).status_code==201
    assert client.post('/api/v1/dispenses',json=payload(idempotency_key='two')).status_code==201


def test_other_patient_and_medicine_are_independent(client,database):
    assert client.post('/api/v1/dispenses',json=payload()).status_code==201
    assert client.post('/api/v1/dispenses',json=payload(idempotency_key='two',patient_ref='OTHER')).status_code==201
    with database.begin() as conn:
        conn.execute(text("INSERT INTO medicines VALUES ('OTHER','Other','tablet',1,'mg',true)"))
        conn.execute(text("""INSERT INTO formulary_rules(medicine_code,effective_from,max_quantity_per_dispense,max_quantity_per_30_days,requires_authorisation)
            VALUES ('OTHER','2020-01-01T00:00:00Z',10,10,false)"""))
    assert client.post('/api/v1/dispenses',json=payload(idempotency_key='three',medicine_code='OTHER')).status_code==201


def test_cursor_pagination_and_filters(client,database):
    for i in range(4):
        assert client.post('/api/v1/dispenses',json=payload(quantity=1,idempotency_key=f'key-{i}')).status_code==201
    first=client.get('/api/v1/dispenses',params={'patient_ref':'PATIENT','limit':2}).json()
    second=client.get('/api/v1/dispenses',params={'patient_ref':'PATIENT','limit':2,'cursor':first['next_cursor']}).json()
    assert [d['id'] for d in first['data']+second['data']]==[4,3,2,1]
    assert second['next_cursor'] is None
    assert client.get('/api/v1/dispenses',params={'patient_ref':'OTHER','cursor':first['next_cursor']}).status_code==422
    assert client.get('/api/v1/medicines?cursor=bad').status_code==422
    assert client.get('/api/v1/medicines?limit=0').status_code==422
    assert len(client.get('/api/v1/medicines?q=edic').json()['data'])==1
    assert client.get('/api/v1/medicines?q=%25').json()['data']==[]
    assert client.get('/api/v1/dispenses?patient_ref=OTHER').json()['data']==[]
