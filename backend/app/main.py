import base64
import json
from datetime import datetime, timezone
from fastapi import FastAPI, Query, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from fastapi.encoders import jsonable_encoder
from starlette.exceptions import HTTPException
from starlette.concurrency import run_in_threadpool
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from app.db import engine, one, many
from app.domain import midnight, reason
from app.schemas import RuleInput, DispenseInput
from app.service import dispense, error_body, validation_reasons

app = FastAPI(title='Community Pharmacy', version='1.0.0')
PREFIX = '/api/v1'


class APIError(Exception):
    def __init__(self, status, code, field, message):
        self.status = status
        self.body = error_body([reason(code, field, message)])


@app.exception_handler(APIError)
async def api_error(_, exc):
    return JSONResponse(exc.body, status_code=exc.status)


@app.exception_handler(RequestValidationError)
async def validation_error(_, exc):
    errors = validation_reasons(exc)
    for e in errors:
        e['field'] = e['field'].removeprefix('body.').removeprefix('query.')
    return JSONResponse(error_body(errors), status_code=422)


@app.exception_handler(HTTPException)
async def http_error(_, exc):
    return JSONResponse(error_body([reason('http_error', '', str(exc.detail))]), status_code=exc.status_code)


@app.exception_handler(IntegrityError)
async def integrity_error(_, exc):
    return JSONResponse(error_body([reason('constraint_conflict', '', 'Request conflicts with a database constraint')]), status_code=409)


@app.exception_handler(SQLAlchemyError)
async def database_error(_, exc):
    # Never expose SQL, connection credentials or patient references.
    return JSONResponse(error_body([reason('database_unavailable', '', 'Database operation failed; retry with the same key')]), status_code=503)


def cursor_encode(values):
    return base64.urlsafe_b64encode(json.dumps(jsonable_encoder(values)).encode()).decode()


def cursor_decode(value, kind, filters):
    if not value:
        return None
    try:
        data = json.loads(base64.b64decode(value, altchars=b'-_', validate=True))
        if data['kind'] != kind or data['filters'] != filters:
            raise ValueError()
        return data['position']
    except (ValueError, KeyError, TypeError, UnicodeDecodeError):
        raise APIError(422, 'invalid_cursor', 'cursor', 'Cursor is invalid or belongs to different filters')


def page(rows, limit, kind, filters, position):
    next_cursor = cursor_encode({'kind': kind, 'filters': filters, 'position': position(rows[limit-1])}) if len(rows) > limit else None
    return {'data': [dict(r) for r in rows[:limit]], 'next_cursor': next_cursor}


def require_medicine(conn, code, suffix=''):
    med = one(conn, 'SELECT * FROM medicines WHERE code=:code ' + suffix, code=code)
    if not med:
        raise APIError(404, 'medicine_not_found', 'medicine_code', 'Medicine does not exist')
    return med


@app.get('/health')
def health():
    with engine.connect() as conn:
        one(conn, 'SELECT 1')
    return {'status': 'ok'}


@app.get(PREFIX + '/medicines')
def medicines(q: str = Query('', max_length=100), limit: int = Query(25, ge=1, le=100), cursor: str | None = Query(None, max_length=2000)):
    after = cursor_decode(cursor, 'medicines', [q])
    if after is not None and not isinstance(after, str):
        raise APIError(422, 'invalid_cursor', 'cursor', 'Invalid medicine cursor')
    escaped = q.replace('\\', '\\\\').replace('%', '\\%').replace('_', '\\_')
    with engine.connect() as conn:
        rows = many(conn, '''SELECT * FROM medicines WHERE (name ILIKE :q OR code ILIKE :q)
            AND (CAST(:after AS text) IS NULL OR code > :after) ORDER BY code LIMIT :limit''',
            q=f'%{escaped}%', after=after, limit=limit+1)
    return page(rows, limit, 'medicines', [q], lambda r: r['code'])


@app.get(PREFIX + '/medicines/{code}')
def medicine(code: str):
    with engine.connect() as conn:
        med = dict(require_medicine(conn, code))
        rule = one(conn, '''SELECT * FROM formulary_rules WHERE medicine_code=:code
            AND effective_from<=:now AND (effective_to IS NULL OR :now<effective_to)''',
            code=code, now=datetime.now(timezone.utc))
    med['current_rule'] = dict(rule) if rule else None
    return {'data': med}


@app.get(PREFIX + '/medicines/{code}/rules')
def rules(code: str, limit: int = Query(25, ge=1, le=100), cursor: str | None = Query(None, max_length=2000)):
    after = cursor_decode(cursor, 'rules', [code])
    try:
        after = datetime.fromisoformat(after) if after is not None else None
        if after and after.tzinfo is None:
            raise ValueError()
    except (ValueError, TypeError):
        raise APIError(422, 'invalid_cursor', 'cursor', 'Invalid rule cursor')
    with engine.connect() as conn:
        require_medicine(conn, code)
        rows = many(conn, '''SELECT * FROM formulary_rules WHERE medicine_code=:code
            AND (CAST(:after AS timestamptz) IS NULL OR effective_from>:after)
            ORDER BY effective_from LIMIT :limit''', code=code, after=after, limit=limit+1)
    return page(rows, limit, 'rules', [code], lambda r: r['effective_from'])


@app.post(PREFIX + '/medicines/{code}/rules', status_code=201)
def supersede(code: str, body: RuleInput):
    start = midnight(body.effective_from)
    with engine.begin() as conn:
        require_medicine(conn, code, 'FOR UPDATE')
        current = one(conn, '''SELECT * FROM formulary_rules WHERE medicine_code=:code
            AND effective_from<=:start AND (effective_to IS NULL OR :start<effective_to)''', code=code, start=start)
        if current and current['effective_from'] == start:
            raise APIError(409, 'rule_start_exists', 'effective_from', 'A rule already starts on this date')
        next_rule = one(conn, '''SELECT effective_from FROM formulary_rules
            WHERE medicine_code=:code AND effective_from>:start ORDER BY effective_from LIMIT 1''', code=code, start=start)
        end = current['effective_to'] if current else (next_rule['effective_from'] if next_rule else None)
        used = one(conn, '''SELECT id FROM dispenses WHERE medicine_code=:code AND dispensed_at>=:start
            AND (CAST(:end AS timestamptz) IS NULL OR dispensed_at<:end) LIMIT 1''', code=code, start=start, end=end)
        if used:
            raise APIError(409, 'historical_rule_in_use', 'effective_from', 'This change would rewrite rules for an accepted dispense')
        if current:
            from sqlalchemy import text
            conn.execute(text('UPDATE formulary_rules SET effective_to=:start WHERE id=:id'), {'start': start, 'id': current['id']})
        row = one(conn, '''INSERT INTO formulary_rules (medicine_code,effective_from,effective_to,
            max_quantity_per_dispense,max_quantity_per_30_days,requires_authorisation)
            VALUES (:code,:start,:end,:single,:rolling,:auth) RETURNING *''', code=code, start=start, end=end,
            single=body.max_quantity_per_dispense, rolling=body.max_quantity_per_30_days, auth=body.requires_authorisation)
    return {'data': dict(row)}


@app.post(PREFIX + '/dispenses', openapi_extra={'requestBody': {'required': True,
    'content': {'application/json': {'schema': DispenseInput.model_json_schema()}}}})
async def create_dispense(request: Request):
    try:
        raw = json.loads(await request.body(), parse_constant=lambda _: (_ for _ in ()).throw(ValueError('Invalid JSON number')))
    except (ValueError, UnicodeDecodeError):
        raw = None  # Malformed JSON is also recorded as a rejected attempt.
    status, body = await run_in_threadpool(dispense, raw)
    return JSONResponse(body, status_code=status)


@app.get(PREFIX + '/dispenses')
def dispenses(patient_ref: str | None = Query(None, max_length=128), medicine: str | None = Query(None, max_length=64),
              limit: int = Query(25, ge=1, le=100), cursor: str | None = Query(None, max_length=2000)):
    filters = [patient_ref, medicine]
    after = cursor_decode(cursor, 'dispenses', filters)
    at, identifier = None, None
    if after is not None:
        try:
            at, identifier = datetime.fromisoformat(after[0]), int(after[1])
            if at.tzinfo is None or len(after) != 2:
                raise ValueError()
        except (ValueError, TypeError, IndexError, KeyError):
            raise APIError(422, 'invalid_cursor', 'cursor', 'Invalid dispense cursor')
    # Add only fixed SQL fragments; all client values remain bound parameters.
    clauses, params = [], {'limit': limit+1}
    if patient_ref is not None:
        clauses.append('patient_ref=:patient'); params['patient'] = patient_ref
    if medicine is not None:
        clauses.append('medicine_code=:medicine'); params['medicine'] = medicine
    if at is not None:
        clauses.append('(dispensed_at,id)<(:at,:id)'); params.update(at=at, id=identifier)
    where = ' WHERE ' + ' AND '.join(clauses) if clauses else ''
    with engine.connect() as conn:
        rows = many(conn, 'SELECT * FROM dispenses' + where + ' ORDER BY dispensed_at DESC,id DESC LIMIT :limit', **params)
    return page(rows, limit, 'dispenses', filters, lambda r: [r['dispensed_at'], r['id']])
