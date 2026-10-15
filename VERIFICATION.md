# Verification record

15 October 2026, after the bug/security review. This supersedes the initial
implementation's verification record. No Docker/database execution is implied
by browser tests or SQL grammar checks.

## Executed and passed

- Python compilation and Ruff checks for undefined names, syntax/runtime mistakes
  and selected bug-prone patterns (`--select E9,F,B`).
- FastAPI import/OpenAPI generation and **65 Python domain, contract and security
  tests**, run against the updated pinned dependencies.
- **90 Python tests collected** without collection errors; **25 require PostgreSQL**.
- Angular production build with strict TypeScript and template checks passed.
- **10 browser regression tests passed** against that production bundle with
  controlled API responses and an active Content Security Policy. Coverage:
  local timestamp conversion including seconds; lost response + refresh + exact
  idempotent retry; all rejection reasons; storage failure before sending;
  blank/fractional validation; malformed error responses; failed catalogue and
  ledger paging; rule-history retry; escaping hostile catalogue names as text.
- More than 100 static SQL statements parsed with PostgreSQL's grammar via pglast,
  including migrations and the revised backdating query. This checks syntax,
  not permissions, semantics, concurrency or actual query plans.
- `npm audit`: zero reported vulnerabilities in the resolved frontend dependency
  set, including development dependencies.
- `pip-audit -r backend/requirements.txt`: zero reported known vulnerabilities in
  the resolved Python dependency set. Before/after JSON reports are in `audit/`.

There is one upstream Starlette warning about the future removal of its httpx
TestClient compatibility. Tests use the currently supported compatibility path;
it did not fail and the locked versions are recorded.

## Not executed here

There is no Docker daemon or PostgreSQL server in this environment. System
package installation was blocked by OS permissions. Therefore:

- The **25 PostgreSQL integration tests** have been written and collected, but
  **not executed**. This includes observed concurrency, constraints, role grants,
  migration upgrades/downgrades, rejected-attempt persistence, seed repeatability,
  backdating and pagination against real data.
- Container startup, Nginx configuration execution, image scanning, runtime role
  permissions and the clean-clone Docker workflow remain unverified.
- The p95 < 300ms requirement has **not been measured**. No invented latency
  figures or index-use claims are supplied.
- Browser regressions use controlled API responses; they are not a live
  browser-to-FastAPI-to-PostgreSQL end-to-end test.

## Completion checks on a Docker-capable machine

1. Run `docker compose up --build`, then the seed command in README.md.
2. Run `sh scripts/test.sh` and fix any environment/database failures it reveals.
3. Run the benchmark and retain its JSON with CPU/RAM/OS/Docker resource details.
4. Exercise the four UI views against the live API, including multi-reason
   rejection and retry, then restart from a clean clone and repeat startup.
5. Update this record and AI_USAGE.md with actual results and candidate review.
