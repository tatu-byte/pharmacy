# Decisions

## 1. Rule versioning and superseding

**Chosen:** Half-open `[effective_from, effective_to)` timestamp periods, with
starts supplied as Johannesburg dates. `effective_to=NULL` means no end.
PostgreSQL `btree_gist` plus a range exclusion constraint makes overlaps
impossible even for concurrent direct SQL writes. Superseding locks the medicine
row, shortens the containing rule and inserts a replacement ending at that
rule's old end. When inserting in a gap, the new rule ends at the next scheduled
start. Existing future periods are preserved. An identical start is a 409,
not a silent replacement. The API reads history oldest first with pagination.

**Alternatives:** Mutating one current-rule row loses history. A version number
alone does not encode event-time applicability. Application-only overlap checks
race. Deleting future schedules is surprising and harder to audit.

**Cost:** PostgreSQL-specific schema. Existing interval ends may change, but no
accepted dispense may lie in the affected portion: such a change returns 409.
Retroactive correction of already used rules would require a separate audited
correction workflow, deliberately absent here. A dispense stores `rule_id` and
its accepted rolling limit for later-window validation.

## 2. Concurrency and transaction boundaries

**Chosen:** READ COMMITTED with transaction-scoped advisory locks, acquired in
this order: idempotency key; medicine `FOR SHARE`; patient/medicine advisory
lock. Rule supersede uses medicine `FOR UPDATE`. After waiting for a pair lock,
the next statement sees the previous writer's committed dispense. Shared
medicine locks allow different patients to dispense the same medicine in
parallel. All application writers follow this protocol.

Success inserts both dispense and outcome in one transaction. Business rejection
inserts only an attempt, then commits normally; throwing an exception inside the
transaction would incorrectly roll the rejection log back. Database/transport
failure has no claimed business outcome and may be retried with the same key.

**Alternatives:** An aggregate query without locking races. Locking existing
dispense rows misses an empty patient's first dispense. SERIALIZABLE can work
with retries but makes contention and retry budgets less explicit. Locking the
whole medicine exclusively unnecessarily serialises different patients.

**Cost:** Hot patient/medicine pairs queue. SHA-256-derived 64-bit advisory keys
could collide, causing extra serialisation, not unsafe concurrency. Very large
backdated histories make later-window checks more expensive. At 10x scale,
measure contention and query plans before introducing bucketed aggregates;
aggregates complicate backdating. The tests hold a gate lock and require two
observed PostgreSQL waiters before release. Removing the relevant lock makes
the test fail rather than merely reducing its probability of catching a race.

## 3. Business time, backdating and future events

**Chosen assumption:** “30 days ending at dispensed_at” means the event's local
calendar date plus the previous 29 local dates. Lower bound is midnight in
Africa/Johannesburg, inclusive; upper bound is the event instant, inclusive.
Later times on the same date are not included in that event's backward window.
This is deliberately not a fixed 720-hour duration. Offset-aware timestamps are
required and canonicalised to UTC. Rule starts are local midnight and their
upper bounds are exclusive. Medicine activity is current status because no
activity-history model is requested.

Backdated insertions count all existing events by occurrence time, irrespective
of insertion order. Additionally, insertion cannot push an already accepted
later event over its saved rolling limit. This stronger invariant resolves the
otherwise order-dependent result of entering the same events newest-first.
Future timestamps are allowed: the brief specifies no future-time prohibition.

**Alternatives/cost:** A duration window is defensible but differs at midnight.
Validating only the new event is cheaper but lets backdating invalidate accepted
later windows. Checking later windows costs indexed correlated sums; a separate
`later_window_limit` violation explains this rejection.

## 4. Idempotency and error contract

**Chosen:** Global client keys, bounded to 128 characters, stored uniquely in the
attempt log. Persist the canonical payload hash, request, status and response.
Valid payloads canonicalise timestamps and default optional fields, so equivalent
UTC offsets replay. Whitespace in opaque references remains significant.
Accepted and rejected identical retries return the exact original body/status
and add no records, even if rules subsequently change. A changed payload with
the same key returns 409, since it conflicts with the key's established meaning;
that misuse is separately logged with a null key and cannot replace the original.
Input-invalid requests are also persisted; a usable key enables their replay.
Missing/invalid keys and malformed JSON cannot be reliably deduplicated.

Errors always contain `error.code` and `error.violations[]`; each violation has
`code`, `field`, `message`. Business rejection and invalid input use 422;
unknown GET resources use 404; conflicting key/rule changes use 409. Constraint
conflicts use 409, infrastructure failures 503. The frontend shows all violations
and repeats field-specific reasons beside the corresponding controls.

**Alternatives/cost:** Returning 200 for rejection obscures HTTP meaning;
returning only the first error causes repeated correction cycles. A header-only
idempotency cache with expiry would be cheaper to store but cannot guarantee
permanent replay. Attempts grow without bound; real operations need retention
policy and access controls. Reasons depending on a missing medicine/rule cannot
be evaluated and are not invented.

## 5. Pagination

**Chosen:** Keyset pagination. Medicines sort by unique code; rule history by
unique-per-medicine effective start; dispenses by `(dispensed_at DESC, id DESC)`.
Opaque base64 JSON cursors bind position to route and filters. Limits default to
25 and cap at 100. Inputs are validated and SQL values are bound. Cursors are
navigation tokens, not authorisation tokens; they need no secret signing here.
The UI supports next/previous with a cursor stack and reset on filter changes.

**Alternatives/cost:** OFFSET supports arbitrary page numbers, but its work grows
with depth and new rows shift results. Keysets have no cheap total count or
jump-to-page. These are live lists, not snapshots: backdated inserts can appear
on a later page and newly inserted newest records appear on refresh.

## 6. Indexes and validation

**Chosen:** B-tree medicine primary key; GIN trigram name/code indexes for
substring search; `(medicine_code,effective_from,id)` for rule history;
`(patient_ref,medicine_code,dispensed_at) INCLUDE(quantity,rolling_limit)` for
windows; descending `(dispensed_at,id)` indexes for unfiltered, patient,
medicine and paired ledger filters. The GiST exclusion index enforces periods.

**Alternatives/cost:** Prefix-only search cannot meet arbitrary partial matching.
A single composite ledger index cannot efficiently serve every leading-column
combination. Extra indexes cost storage and write amplification; the window and
paired-ledger indexes partially overlap and should be consolidated if measured
write cost outweighs their distinct ordering/coverage benefit. PostgreSQL may
correctly choose a sequential scan on the small 500-row catalogue.

**How it was measured:** After seeding, `app.benchmark` runs ANALYZE, warms each
case with 20 requests, then times 200 sequential HTTP first-page requests per
case and reports nearest-rank p95. It covers catalogue listing, name and code
search, rule history, and the ledger unfiltered, by patient, by medicine and by
both. It also records EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) plans and exits
non-zero if any p95 reaches 300ms:

```sh
docker compose run --rm -T migrate python -m app.benchmark --base-url http://api:8000 > pharmacy-benchmark.json
```

Use `--base-url http://web:8080` to include the Nginx hop.

**Result (16 October 2026):** Apple M3 Pro, 18 GB RAM, macOS 26.6; Docker
Engine 29.6.1 limited to 11 CPUs and 7.75 GiB; seeded data of 500 medicines,
2,000 rules and 2,000 dispenses. Worst p95 was 2.1ms direct to the API
(unfiltered ledger) and 4.2ms through Nginx (rule history); every case passed.
Plans used `rule_history`, `dispense_patient_newest` and an index-only scan of
`dispense_window`. Catalogue search chose a sequential scan, as expected for 500
rows; the trigram indexes matter only at larger catalogue sizes. Reports are in
`benchmarks/`. This dataset is the brief's minimum, so the numbers show headroom,
not behaviour at ten times the volume.

## 7. Dependency reproducibility

**Chosen:** Pin resolved Python versions and direct Angular/toolchain versions;
commit npm's resolved transitive lockfile and use `npm ci` in Docker. Node 22 matches the Angular 20.3 toolchain range. Compose uses PostgreSQL 17.
Image tags can still receive updates; Python transitives are now pinned too.

**Alternatives/cost:** Image digests and a fully hashed Python lock provide
stronger reproducibility but require an update process and a verified target
platform. They remain a limitation of this small assessment, not a guarantee
of bit-identical builds. Dependency audits were performed during the security review; both resolved
dependency sets report zero known vulnerabilities at that point. This is not a
guarantee against unknown vulnerabilities or vulnerable base-image packages.

References consulted:
- https://www.postgresql.org/docs/17/explicit-locking.html
- https://angular.dev/reference/versions


## 8. Local security boundary and resilient browser retries

**Chosen:** Keep authentication out of scope, as the brief explicitly requests,
but expose only loopback ports. Enforce Host/Origin/content-type and streamed
body bounds before parsing; cap database waits. Give the API a separate database
role with only the grants needed by the API, including UPDATE on the medicine
name column solely because PostgreSQL row-locking SELECTs require an UPDATE
privilege. Owner credentials stay in a separate one-shot service. Add composite
rule/medicine referential integrity in reversible migration 003.

Pending browser requests save their exact payload/key before sending. A lost
response, navigation or refresh must not silently create a fresh key. Editing
is disabled while an outcome is unknown; a confirmed success requires an
explicit new dispense. Storage failure prevents a request being sent. Supported
API dates are UTC years 0002 through 9998 to keep Python boundary arithmetic
representable. The browser converts local times with the named timezone,
including historical offset changes, and rejects ambiguous local timestamps.

**Alternatives/cost:** Full authentication or deployment infrastructure would
expand beyond this assessment. These controls do not make the app a public
service. Tab storage survives refresh but not deliberate clearing/tab loss;
real-world recovery needs a durable authenticated client workflow. Boundary
failures are not logged as dispense attempts; business/input rejections are.
Audit payloads PostgreSQL cannot represent are encoded losslessly as base64 JSON.
The attempt log retains idempotent outcomes permanently, with no unrequested
expiry. See SECURITY_REVIEW.md for remaining operational limits.
