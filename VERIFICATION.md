# Verification record

16 October 2026. Everything below was run from a fresh `git clone` of the
repository, using the commands in README.md.

## Environment

Apple M3 Pro, 18 GB RAM, macOS 26.6. Docker Engine 29.6.1 with Compose v5.3.0,
limited to 11 CPUs and 7.75 GiB. PostgreSQL 17 (`postgres:17-alpine`).

This host's Docker had used up its default network address pools on unrelated
projects, so the runs added a local Compose override that pinned the default
network to a free subnet. No service definition changed.

## Results

| Check | Result |
| --- | --- |
| `docker compose up --build` | Database healthy, migration service exited 0 at revision 003, API healthy, web served the app and proxied `/api/v1` |
| Seed command, run twice | 500 medicines, 2,000 rules (4 per medicine), 2,000 dispenses, 2,000 distinct patient references, 729-day span. The second run added nothing |
| Backend suite (`run_tests.py`) | **90 passed**, including the 25 PostgreSQL integration tests: concurrency, exclusion constraint, runtime role grants, migration round trip, seed, backdating and pagination |
| Browser suite (`browser-tests`) | **16 passed** against the production bundle |
| First-page latency, direct to API | Worst p95 2.1ms over eight listing cases (`benchmarks/2026-10-16-api.json`) |
| First-page latency, through Nginx | Worst p95 4.2ms over the same cases (`benchmarks/2026-10-16-nginx.json`) |
| Views against the live API | Detail (current rule and timeline), capture and ledger used with seeded data. Search checked through the proxied API with partial name and code queries |
| Multi-reason rejection, live | One request returned `per_dispense_limit`, `rolling_limit` and `authorisation_required` together. The attempt was logged with three reasons and no dispense row was created |

The first database run found one faulty test: the search assertion looked for
`esti`, which the fixture name "Test medicine" does not contain. The assertion
was corrected; the API's search behaviour was not changed.

## Static and dependency checks (15 October 2026)

- Ruff checks for undefined names, syntax/runtime mistakes and selected
  bug-prone patterns (`--select E9,F,B`).
- Strict Angular production build with template type checking.
- Static SQL parsed with PostgreSQL's grammar via pglast.
- `npm audit` and `pip-audit -r backend/requirements.txt`: zero known
  vulnerabilities in the resolved dependency sets. Reports are in `audit/`.

## Not covered

- Browser tests use controlled API responses. The live end-to-end check above
  was done by hand, not by an automated browser-to-database test.
- Database timeout settings are configured but not forced to expire in a test.
- Container images were not scanned for operating-system vulnerabilities.
- Latency was measured at the brief's minimum dataset with one client at a
  time. It says nothing about behaviour under concurrent load or at larger volume.

See ASSESSMENT_CHECKLIST.md for the requirement-by-requirement mapping.
