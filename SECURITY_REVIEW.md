# Bug and security review - 15 October 2026

This review covers the assessment repository: API inputs, transactions,
rule/window logic, migrations, database privileges, browser state, containers and
resolved Python/npm dependencies. It is a bounded review, not proof that the
system has no defects. Authentication remains excluded by the brief;
the supplied configuration is a local synthetic-data assessment, not a public
pharmacy service.

## Findings addressed

| Issue | Correction | Verification |
| --- | --- | --- |
| Known vulnerable dependencies | Updated Angular framework/compiler to 20.3.34 and CLI/build to 20.3.40; refreshed Python dependencies; committed both resolved dependency sets. | npm audit: 25 flagged packages before, zero after. pip-audit: two flagged packages before, zero after. Full before/after reports in `audit/`. Scanner findings include transitive/build-only and unused feature paths; these counts do not claim every advisory was exploitable here. |
| Unauthenticated demo published on all network interfaces | Both published ports bind 127.0.0.1; database remains unexposed. No public deployment is supplied. | Compose configuration reviewed; stack started and served on loopback ports. |
| Browser cross-site writes and DNS rebinding | Enforce Host and Origin allow-lists, reject cross-site fetches, require JSON content type, reject compressed bodies. | Request-boundary regressions pass. |
| Unbounded JSON buffering / slow bodies | Count streamed bytes before parsing, 32 KiB limit including absent/false Content-Length; ten-second body deadline; Nginx has matching limits. | Streaming limit regression passes; Nginx configuration reviewed. |
| Malformed data causing 500/503 instead of rejection | Reject non-finite numbers, duplicate JSON keys and deep nesting; bound date arithmetic, reject implicit numeric dates and validate cursor shape, integer range and timestamps. | Parameterised security tests pass. |
| NUL/unpaired surrogates break PostgreSQL text or JSONB logging | Validate input strings and query parameters; preserve invalid raw payloads in a lossless base64-JSON audit envelope; sanitise error-field display. | Input/audit tests and the PostgreSQL rejected-attempt persistence test pass. |
| Runtime API used the database superuser | Separate one-shot owner/migration service and restricted serving role. API cannot delete attempts, rewrite accepted dispenses, change activity flags or run DDL. | Grant statements reviewed; runtime role permission test passes against PostgreSQL. |
| Workers could wait indefinitely for database locks | Connect, pool, statement, lock and idle-transaction timeouts. Retry remains idempotent after uncertain failures. | Configuration reviewed; concurrency tests pass against PostgreSQL. Timeout expiry itself is not forced in a test. |
| Broad container permissions and default caching/logging | Non-root API/web processes, dropped capabilities, no-new-privileges, no API access logs containing query references, no-store and defensive browser headers. Nginx rate-limits writes. | Browser tests run under the intended CSP; API and web containers ran as configured. |
| Rule/dispense references could name different medicines | Reversible migration 003 adds composite referential integrity and rejects non-finite database timestamps. | Cross-medicine reference, non-finite period and migration round-trip tests pass against PostgreSQL. |
| Backdated validation materialised every affected row | Existence query stops at the first later-window breach, preserves the same patient/medicine lock. | Backdating and later-window tests pass against PostgreSQL. |
| Refresh or navigation after a lost response discarded the idempotency key | Save the exact pending payload/key in sessionStorage before sending. Restore on return; block edits until the result is resolved; retries use identical data. | Real browser test simulates a lost response, refreshes, retries and compares both payloads/keys. |
| Date input with seconds produced invalid timestamps | Parse local calendar input and convert using Africa/Johannesburg; reject nonexistent/ambiguous historical local times instead of guessing. | Browser conversion with seconds passes. Explicit tzdata dependency supports minimal Python images. |
| Failed list pagination mutated cursor/history prematurely | Commit page rows/cursor/history only after successful response; retain previous rows on failure. | Catalogue and ledger failure/retry browser tests pass. |
| Failed initial rule-history request could not be retried | Add retry state; retain route cancellation; show current rule limits even when history spans pages. | Browser history-retry test passes. |
| Error renderer assumed every response matched the error schema | Runtime-check the violations array and use a safe fallback for malformed infrastructure responses. | Browser regression passes. |
| Capture accepted blank references/fractional quantities locally | Add client validators; confirmed requests are read-only until an explicit new dispense; new form clears patient/time/quantity appropriately. | Browser validation and post-success state tests pass. |

## Security boundaries and trade-offs

- All business failures and parseable invalid dispense inputs remain persisted.
  Transport-level rejection (Host/Origin/content type, size, deadline, server
  admission or rate limits) occurs before database work and does not create an
  attempt. This avoids turning a rejected request flood into database writes.
- Identical usable-key retries still return the original outcome. Changed-key
  payload conflicts remain separately logged. Attempts and idempotency outcomes
  are retained indefinitely to preserve the brief's replay semantics. Disk quotas,
  retention policy and an archive/replay design are operational work for a real
  service, not silently imposed here.
- API writes require JSON and exact allowed browser origins. These checks are
  not authentication: a local process can set its own headers. Demo credentials
  are intentionally local, embedded and unsuitable for a public deployment.
- Browser tab storage contains opaque synthetic references and pending values.
  It is not encrypted, is not a defence against an attacker controlling the
  browser, and can be lost if the tab is closed or storage is cleared. Keep the
  tab open until a pending result is confirmed; use the ledger for reconciliation.
- Runtime SQL is parameterised and Angular values are interpolated as text.
  No new SQL injection, raw-HTML rendering or remote URL fetching path was found.
  Advisory locks are cooperative: direct administrative SQL must not bypass the
  dispense service for business-rule enforcement.
- Images use maintained major/stable tags, not immutable digests. OS/image
  vulnerability scanning was not available here. Python versions are fully
  pinned but not hash-locked across every target architecture.

## Evidence and remaining work

See VERIFICATION.md for exact executed checks, including the PostgreSQL suite,
Docker startup and latency measurements. `sh scripts/test.sh` runs both suites.
A review cannot guarantee
all bugs, configuration problems or unknown vulnerabilities have been eliminated.

Representative advisories checked against the package audit:
- https://github.com/advisories/GHSA-jj27-h5hq-8x99
- https://github.com/advisories/GHSA-jrmj-c5cx-3cw6
- https://github.com/encode/starlette/security/advisories/GHSA-2c2j-9gv5-cj73
