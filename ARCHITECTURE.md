# Architecture

The browser loads a standalone Angular application from Nginx. Nginx proxies
`/api/v1` to FastAPI; this keeps browser requests same-origin. Four routed views
provide catalogue search, medicine/rule history, dispense capture and patient
ledger. Lists use typed API responses, cancel stale requests and reset cursors
when filters change. The capture form persists pending payloads/keys in browser tab storage, restores
them after refresh and prevents edits until an uncertain result is resolved.

FastAPI handles HTTP validation and pagination in `backend/app/main.py`.
`schemas.py` defines input contracts. `domain.py` contains pure time-boundary
and rule-evaluation functions; it accumulates all independently evaluable
violations. `service.py` owns the dispense transaction. SQLAlchemy Core executes
parameterised PostgreSQL queries; explicit SQL keeps lock acquisition, window
bounds and index use visible. There is no second in-memory source of truth.

For a dispense, the service canonicalises the payload, locks its idempotency
key and checks for an existing outcome. It then takes a shared medicine-row
lock, locks the patient/medicine pair, resolves the historical rule and totals
the applicable window. It also checks later windows affected by backdating.
On success it inserts a dispense and its successful attempt. On rejection it
inserts only the failed attempt. The response is returned after commit; replay
reads the stored status and body. Database failure rolls back the entire unit.

PostgreSQL stores timestamps as `timestamptz` with UTC connections. Business
boundaries use `Africa/Johannesburg`. Rules are non-overlapping half-open
intervals, enforced with a GiST exclusion constraint. Rule updates exclusively
lock the medicine row; concurrent dispenses share-lock that row, so they cannot
observe half a supersede operation. Accepted dispenses reference their rule and
snapshot its rolling limit. A rule change may not rewrite an accepted event's
historical interval.

A one-shot owner process runs Alembic before API startup and grants a separate
restricted runtime role. Only loopback HTTP ports are published. ASGI guards
bound JSON work and reject cross-site requests; both API and web run without root. A second migration transforms existing
text rejection reasons to JSONB and supports a semantic round trip on downgrade.
Synthetic seeding uses the same dispense service as the API. Integration tests
run against a separate, disposable PostgreSQL database, including observed overlapping
lock waits, exclusion constraints and populated migration round trips.

Scope is deliberately small: no authentication, cloud deployment, CI, clinical
data or theme system. Direct SQL writes are administrative operations: the
exclusion constraint still applies, but dispense business rules require the
service transaction. See DECISIONS.md for costs and assumptions; VERIFICATION.md
records what was checked, how, and what is not covered.
