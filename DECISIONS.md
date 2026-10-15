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

**Validation status:** Static query/index alignment was reviewed. The benchmark
runs ANALYZE, collects EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON), warms each case,
then measures 200 HTTP first-page requests per case using nearest-rank p95.
It fails at p95 >= 300ms. No PostgreSQL or Docker exists in the build environment,
so no measured latency or index-use claim is made. Run and retain the report on
the developer laptop before submission; record CPU/RAM and Docker resource limits.

## 7. Dependency reproducibility

**Chosen:** Pin direct Python versions and direct Angular/toolchain versions;
commit npm's resolved transitive lockfile and use `npm ci` in Docker. Node 22.18
matches the Angular 20.3 toolchain range. Compose uses PostgreSQL 17. Alpine
image patch tags and Python transitive dependencies can still receive updates.

**Alternatives/cost:** Image digests and a fully hashed Python lock provide
stronger reproducibility but require an update process and a verified target
platform. They remain a limitation of this small assessment, not a guarantee
of bit-identical builds. Build-tool deprecation warnings were observed during
npm install; no dependency security audit was performed.

References consulted:
- https://www.postgresql.org/docs/17/explicit-locking.html
- https://angular.dev/reference/versions
