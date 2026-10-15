# Verification record

Build-session date: 15 October 2026. These results describe this environment,
not a claimed run on the candidate's laptop.

## Executed and passed

- Python compilation: `python3 -m compileall -q backend`.
- FastAPI import and OpenAPI generation, including the dispense request schema.
- `python3 -m pytest tests/test_domain.py tests/test_contract.py -q` from backend:
  **19 passed**. Coverage includes local-calendar/year/leap boundaries,
  simultaneous rule reasons, missing medicine/rule, exact limits, input bounds,
  UTC canonicalisation, uniform validation errors and malformed JSON routing.
- Full pytest discovery: **39 tests collected** without collection errors.
- Angular `npm run build`: production build passed with strict TypeScript and
  Angular template checks. Initial bundle 341.71 kB raw, estimated 91.65 kB transfer.
- JSON configuration parsing and Git incremental commit checks.

The test run reported one upstream Starlette/AnyIO deprecation warning, not a
failure. Direct frontend dependency versions and the generated npm lockfile are
committed; Docker uses `npm ci`.

## Not executed here

There is no Docker daemon or PostgreSQL server in this environment. Installing
PostgreSQL via the system package manager was blocked by OS permissions. Thus:

- The **20 PostgreSQL integration tests** have been written and collected but
  have **not been run**. They cover success/rejection persistence, replay,
  concurrent dispense/idempotency requests, concurrent exclusion enforcement,
  backdating, pagination, superseding, seed repeatability and migration round trips.
- `docker compose up --build` and clean-clone container startup are unverified.
- The p95 < 300ms requirement has **not been measured**. No fabricated performance
  numbers are supplied. Run the benchmark in README.md and retain its JSON report.
- Browser interaction and end-to-end UI against a live API are unverified.

## Completion checks on a Docker-capable machine

1. Extract the archive (including `.git`) and run `docker compose up --build`.
2. Run the seed command, then the single-command test runner in README.md.
3. Run the benchmark; record CPU, RAM, OS and Docker CPU/memory allocation with
   its report. The script checks every listing route and relevant filter variants.
4. Open the UI. Search MED0001, inspect its timeline, capture a valid dispense,
   provoke quantity/authorisation errors, retry, then inspect the patient ledger.
5. Start again from a clean clone and confirm automatic migrations/startup.
6. Update this record and AI_USAGE.md with actual outcomes and your own review.

This is an implemented, partially verified submission candidate, not a claim
that all assessment acceptance criteria have already passed.
