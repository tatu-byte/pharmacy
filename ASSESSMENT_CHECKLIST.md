# Assessment coverage review

Reviewed against all five pages of the EMGuidance brief dated 1 September 2026.
Last verified: 16 October 2026, from a fresh clone, with Docker. See
VERIFICATION.md for the exact commands, environment and results.

**Verdict: every requirement below is implemented and has been exercised
against real PostgreSQL in Docker.** 90 backend tests and 16 browser tests pass.
Every listing endpoint's first page is well under the 300ms p95 target.

Status meanings: **Verified** = exercised against the running system or by a
passing PostgreSQL-backed test; **Browser** = exercised by the production-bundle
browser suite; **Inspected** = documentation or configuration reviewed directly.

## Stack and entities

| Requirement | Evidence | Status |
| --- | --- | --- |
| FastAPI, SQLAlchemy, Alembic, PostgreSQL, Angular/TypeScript, Compose | `backend/requirements.txt`, `frontend/package.json`, `compose.yaml`; strict Angular build; full stack started with Compose | Verified |
| Medicine: unique external code, name, form, strength, activity | `001_initial.py`, API response and TypeScript model | Verified |
| Rule: medicine, start/end, single/rolling limits, authorisation | `001_initial.py`, `schemas.py`, `003_integrity.py` | Verified |
| Dispense: medicine, opaque reference, quantity, event time, authorisation, client key | `001_initial.py`, `schemas.py`, `service.py` | Verified |

## Business rules and time

| Brief requirement | Implementation / regression evidence | Status |
| --- | --- | --- |
| 1. Historical event-time rule | `service.py`; `test_split_and_historical_evaluation` checks both sides of a local-midnight split | Verified |
| 2. Single-dispense maximum | `domain.py`; domain tests and multi-reason API test | Verified |
| 3. Inclusive rolling window, independent of recording order | `domain.py` and `service.py`; lower-bound, outside-window, backdating, later-window and independent-patient tests | Verified |
| 4. Non-empty required authorisation | `domain.py`; evaluation and simultaneous-reasons tests | Verified |
| 5. Inactive medicine / absent rule rejected | `test_unknown_and_missing_rule`; inactive UI state | Verified |
| 6. All independently violated rules returned | Accumulated violations in one envelope; live API returned three reasons for one request; browser shows each beside its field | Verified |
| 7. Persist rejection and reasons without a dispense | One transaction in `service.py`; `test_all_reasons_and_rejected_replay` asserts attempt and dispense counts; live rejection left an attempt and no dispense | Verified |
| 8. Database-enforced non-overlapping periods, including concurrency | GiST exclusion constraint; `test_overlap_constraint_rejects_direct_sql` and `test_concurrent_rule_overlap_is_impossible` (second writer observed blocked, then fails with 23P01) | Verified |
| 9. Simultaneous requests cannot jointly breach rolling limit | Pair advisory transaction lock; `test_simultaneous_dispenses_cannot_jointly_breach` holds a gate lock and requires two observed `pg_locks` waiters before release | Verified |
| 10. Same key/payload replays original outcome with no additions; changed payload errors | Persisted request hash/status/body, global unique key; replay, 409 conflict and concurrent duplicate tests; browser lost-response retry | Verified |
| UTC storage and Africa/Johannesburg business boundaries | `timestamptz`, UTC DB sessions, named-zone Python/TypeScript conversion; `test_window_lower_boundary_inclusive`, `test_rule_cursor_handles_local_start_in_previous_utc_year` | Verified |

The 30-day interpretation is explicit in DECISIONS.md: the event's local date
plus the previous 29 local dates, from local midnight to the event instant,
both inclusive. Later-window checks are a documented stronger invariant for
backdating. Missing prerequisites do not produce fabricated dependent reasons.

## API and frontend

| Requirement | Evidence | Status |
| --- | --- | --- |
| Versioned API | All six endpoints under `/api/v1`; generated OpenAPI | Verified |
| GET medicines: partial name/code, pagination | Bound ILIKE query, filter-bound keyset cursor; `test_cursor_pagination_and_filters`, browser pagination tests | Verified |
| GET medicine: current rule | Current-rule query; detail card and timeline highlight checked against seeded data | Verified |
| GET ordered full rule history | Oldest-first pages, traversable until no cursor; `test_rule_history_paginates` | Verified |
| POST rule supersede/split | Locked split preserves scheduled future intervals; same-start conflict and accepted-history protection tests | Verified |
| POST validated idempotent dispense | Historical evaluator plus atomic attempt handling | Verified |
| GET filtered/newest-first/paginated dispenses | Patient, medicine, both or neither; `(dispensed_at, id)` descending keyset | Verified |
| Consistent field/rule error contract | `error.code`, `violations[{code,field,message}]`; schema, guard and renderer tests | Verified |
| Medicine search view | Search/reset, active/inactive status, cursor navigation, empty/error/loading states | Browser |
| Medicine detail view | Current-rule limits, ordered timeline, retry for medicine and history; checked against live API | Browser, Verified |
| Dispense capture view | Field-associated errors, all server reasons, local time, safe pending retries; live multi-reason rejection checked | Browser, Verified |
| Patient ledger view | Required reference, optional medicine filter, paging, event-time ordering; checked against seeded data | Browser, Verified |
| Sound UI state | Cancels superseded requests, retains successful rows after failed paging, retries failed cursor; saves pending payload before POST | Browser |

The rule-history API is paginated to keep listing latency bounded; every period
is reachable. A rule-editing UI was not requested. Rule creation remains exposed
through the documented API. No extra administrative screen was added.

## Data, performance and delivery

| Requirement | Evidence | Status |
| --- | --- | --- |
| 500 medicines, 3–5 periods each, >=2,000 dispenses/references in a two-year window | Seeded database: 500 medicines, 4 periods each, 2,000 dispenses, 2,000 distinct patients, 729-day span; rerun adds nothing; `test_seed_volume_and_repeatability` | Verified |
| All listing first pages p95 <300ms on a developer laptop | `app.benchmark`: eight endpoint/filter cases, 200 measured requests each. Worst p95 2.1 ms direct to the API, 4.2 ms through Nginx | Verified |
| Real incremental Git history | Incremental commits; `.git` included in delivery | Inspected |
| Clean-clone `docker compose up`; automatic migrations | Fresh clone started; one-shot migration service reached revision 003 before API start | Verified |
| Single documented seed command | README Seed section; run twice from a fresh clone | Verified |
| Single documented in-container test command | `sh scripts/test.sh`: isolated PostgreSQL suite, then production-bundle browser suite | Verified |
| Every migration downgrades cleanly | `test_data_transformation_round_trip` downgrades to 001, upgrades, downgrades to base, upgrades | Verified |
| At least one data-transforming migration | 002 converts existing reason text to JSONB and reverses it; semantic round-trip assertion | Verified |

## Documentation and scope

| Requirement | Evidence | Status |
| --- | --- | --- |
| README: run, seed, test only | README.md | Inspected |
| Architecture: one page | ARCHITECTURE.md | Inspected |
| Short ADRs with alternatives and costs | DECISIONS.md covers versioning, concurrency, pagination, errors and indexes, including measured latency | Inspected |
| AI usage | AI_USAGE.md | Inspected |
| No unnecessary auth/cloud/CI/clinical/patient-data scope | Local workspace, synthetic references, four required views; no clinical claim | Inspected |
