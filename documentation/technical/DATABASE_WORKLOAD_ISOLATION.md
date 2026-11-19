# Database workload isolation

## Scope and safety

Keep PostgreSQL and the current HTTP contracts. Do not add a mandatory cache,
broker, container runtime or service. Code changes do not authorize production
migrations, configuration changes, restarts or deployment.

The configured app, chat and Scan URLs currently target the same PostgreSQL
database, `hubit_chat`. Schemas and application connection pools do not isolate
the cluster's WAL, storage, CPU or memory.

The runtime flag `CHAT_DB_ASYNC_COMMIT=1` was changed outside this work. This work
does not change that flag or the chat commit implementation. Verify the actual
write-pool setting before a release. Client-message deduplication is not recovery
for an acknowledged transaction lost after an asynchronous commit.

## Baseline: 2026-11-18

A read-only 45-second interval, 12:24:24-12:25:09 local server time, produced:

| Table | Updates |
| --- | ---: |
| `scan.scan_agents` | 805 |
| `app.monitoring_aggregates` | 447 |
| `app.monitoring_samples` | 344 |
| `app.monitoring_targets` | 215 |
| `app.monitoring_interfaces` | 88 |
| `app.mail_runtime_snapshots` | 84 |
| `app.sessions` | 27 |

No preview-table updates were observed in this interval. Old cumulative preview
update counts are not evidence of current preview write load.

The WAL counter increased by 5,311,135 bytes. No long active wait was observed at
the two endpoints of the interval. This is not proof that the listed writes cause
the intermittent WAL/storage stalls, nor a sustained-rate or capacity estimate.
Statistics resets must be checked when comparing intervals.

Local operational reports, without credentials or user payloads:

- `artifacts/operations/db-write-baseline-20261118.json`
- `artifacts/operations/scan-heartbeat-write-control-20261118.json`

## First change: bounded Scan presence writes

Implementation: `scan_server/database.py`.

Previously, ordinary changes in CPU, RSS, free space and queue age invalidated
the complete heartbeat fingerprint. Process-local timers also did not protect
against another worker or a light presence update immediately after a heartbeat.

The change:

- Samples only known volatile resource fields. Identity, version, MAC, queue
  depths, errors, disk/staleness alerts, update markers and unknown fields remain
  significant. Temporary source ports do not represent a changed IP identity.
- Reads the persisted full heartbeat on a local-cache miss. Its own timestamp,
  not a later light presence touch, controls the resource sampling window.
- Uses compare-and-set to detect competing writes. A resource-only request that
  loses a race does not replay the older queue/error/identity snapshot.
- Allows bounded retries for significant concurrent changes, preserving the
  existing last-writer behavior rather than adding a new request failure.
- Checks persisted presence before writing. A late light update cannot overwrite
  a concurrently committed heartbeat; a failed write does not suppress its retry.
- Caps the sampling/throttle interval at half the configured online timeout.

No columns, indexes, migration, authentication policy, task TTL, ACK behavior or
durability setting change in this step. Resource values may lag by the sampling
interval; critical state still triggers an immediate write.

### Verification and limits

`tests/test_scan_agent_poll_load.py` exercises HTTP heartbeats and actual row
writes through audit triggers in disposable SQLite databases. Critical race
checks use two independent stores, including synchronized competing writes.
HTTP success alone cannot reveal unnecessary writes or stale overwrites.

The isolated fingerprint-policy comparison uses 30 agents, two stores and 720
heartbeats over 110 simulated seconds, including a queue-depth transition:

| Fingerprint policy | Actual agent-row writes |
| --- | ---: |
| Previous full-payload comparison | 720 |
| Resource sampling | 31 |

Both arms use the guarded persistence implementation. Only the comparison
policy changes. The local cache is cleared each frame to exercise persisted
state. The queue-depth transition is retained in both cases. This is not a
whole-release before/after benchmark, a PostgreSQL WAL measurement or a
production p95/p99 result.

PostgreSQL concurrency, production latency and workload reduction still require
verification in an isolated PostgreSQL environment and after an explicitly
authorized release. The code is not deployed by running these tests.

## Authorized Scan release: 2026-11-18

The user explicitly approved restarting only `itinvent-scan` and
`itinvent-scan-worker`. The standard `scripts/pm2/restart-scan.ps1` applied the
reviewed source at 12:55 local server time. `C:\Project\Image_scan` is a junction
to this repository, not a separate unchecked source tree.

Only `scan_server/database.py` had changed in the Scan runtime since the previous
Scan process start. Its reviewed SHA-256 was
`cd1d5d9a68efd3e558c8b7a6accd1ee91af6c7ad0a73d07ec39d69014ea1f01a`.
The database URL matched the existing processes; PostgreSQL column types matched
the guarded SQL. No OCR jobs were active in the preflight snapshot.

No `.env`, ecosystem, database, migration or agent-rollout changes were applied.
Backend, chat, the separate retention worker and all other application PIDs
remained unchanged. OCR settings and ingest limits also remained unchanged.
Both Scan processes stayed online without an additional restart through the
13:02 final check; Scan health and backend/chat health/readiness returned 200.

### Production measurements

These are ordinary agent requests, not a production load test. Each interval
lasts 45 seconds. Post-release measurement started after two minutes of warmup.
Database and WAL statistics resets were unchanged.

| Interval | Agent updates | Heartbeats 200 | Polls 200 | Cluster WAL bytes |
| --- | ---: | ---: | ---: | ---: |
| 12:52:19-12:53:04, before | 798 | 423 | 423 | 6,073,097 |
| 12:57:02-12:57:47, after | 441 | 433 | 433 | 5,712,251 |
| 12:57:49-12:58:34, after | 413 | 419 | 419 | 5,644,294 |

Agent-row updates decreased by 44.7% and 48.2% at comparable request volume.
The 30-minute active-agent count remained 724. No SQL exceptions, tracebacks,
pool-timeout signatures, new deadlocks or temporary-file growth were observed
in these measured windows.

This is a bounded observational comparison, not proof that all storage stalls
or chat latency tails are resolved. WAL is shared with other workloads: its byte
reduction was much smaller than the update-count reduction. Aggregate WAL sync
time was 111.0 ms before and 116.5/271.6 ms after; it did not establish improved
commit latency. No representative chat-send p95/p99 was measured.

Each post-release window also contained one heartbeat/poll pair returning 401.
The requests identify `kos-nach-ychastka-0001n` and `reg-pto-0009-n`, both last
reporting agent 1.4.24. These authentication failures were not introduced as a
new finding by this release: the existing log tail contains 645 timestamped
unknown-key rejections before the restart. No wrong-agent-binding rejection was
found in that tail. Exact key ownership and client-side refresh still require
separate diagnosis; no keys or checks were changed.

Evidence:

- `artifacts/operations/scan-write-window-pre-20261118.json`
- `artifacts/operations/scan-write-window-post-warmup-20261118.json`
- `artifacts/operations/scan-write-window-post-steady-20261118.json`
- `artifacts/operations/scan-heartbeat-production-comparison-20261118.json`
- `artifacts/operations/scan-deploy-final-health-20261118.json`

A code-only rollback archive and release hashes are recorded in
`artifacts/operations/scan-heartbeat-release-manifest-20261118.json`.
The archive restores only the four reviewed heartbeat/presence methods and two
throttle assignments while retaining the other dirty code present at preparation.
It passed 68 pre-existing isolated checks; the release had passed 83 checks.
Before applying any archive, verify the live source still matches the manifest
release hash. If it does not, reconcile later edits rather than overwriting them.
No rollback was needed or performed.

## Prepared chat changes: 2026-11-18

These initial file/forward changes are not deployed. They add no migration,
configuration or new service, and preserve the existing conversation lock,
sequence allocation and membership/task-sharing checks. Their original
delivery/outbox arrangement was unchanged; the later atomic-intent change is
recorded separately below.

### Batch preview queue writes

Real HTTP file-send and forward tests reproduced five preview-row SELECTs for
five attachments after the conversation lock helper, before the write
transaction ended. `enqueue_many_in_session` reduces these lookups to one.
Unsupported attachments cause no preview lookup. Parent message/attachment rows
still flush before preview inserts, and all rows still commit atomically.

The single-attachment entry point uses the same implementation. Repeated enqueue
before flush reuses pending rows, including with the runtime's `autoflush=False`.
The prior implementation reproduced a duplicate-preview primary-key error in
this case. A real worker-claim check verifies that a later enqueue does not reset
the processing lease.

The isolated SQLite scenario measured 5 -> 1 preview SELECTs for both file send
and forward. Single diagnostic transaction-section samples were 24.7 -> 24.0 ms
and 14.5 -> 13.4 ms respectively; they establish no meaningful latency gain.
SQLite does not implement PostgreSQL row locks. PostgreSQL contention, WAL and
representative message-send p95/p99 still need separate measurement.

### Preserve committed forward attachments

An additional HTTP reproduction found a data-loss path: a forward committed its
message and attachment rows, response construction failed, and the facade's
generic error cleanup deleted the copied files. The peer then received 404 when
downloading the attachments from a message already visible in history.

For a new forward with attachments, post-commit response failure now raises the
existing `FileMessageCommittedError`; the facade preserves the committed
message's files. The HTTP error is not hidden. Retrying the same
`client_message_id` retrieves the same message and attachments, and removes only
unused copies made for the retry. Pre-commit failure still rolls back the
message, attachment/preview rows and sequence, and removes temporary files.
No historical production files were inspected, restored or removed.

### Verification

- Four new HTTP scenarios cover batched queue persistence, replay, order,
  outsider denial and atomic rollback/cleanup for files and forwards.
- One critical store check covers pending-row idempotency and a real worker lease;
  HTTP retries use separate sessions and cannot exercise this pending ORM state.
- The initial four-file profile selected 81 tests: 79 passed; two existing push
  tests failed resolving the special-use `push.example` hostname. Those two
  passed with only the test hostname's DNS response controlled; their existing
  webpush stub and production endpoint validation remained unchanged.
- The added post-commit forward failure reproduces peer download 404 before the
  fix and successful byte-for-byte downloads, stable retry IDs and access denial
  after it. All 14 affected scenarios passed after the final forward fix.

Evidence is recorded in
`artifacts/operations/chat-preview-batch-verification-20261118.json`.
Existing unrelated text-message persistence changes were retained.

### Prepared file/forward replay response split

An HTTP concurrency reproduction confirmed that a slow replay response kept the
conversation's original transaction active and prevented another send from
finishing. Both file-send and forward retries had this behavior.

After membership, posting/file/AI guards and client-message/source validation,
finding an existing message now ends the original write transaction. A separate
session reloads the conversation, message and attachments and builds the replay
response without reacquiring the conversation write lock. No new message or
sequence is allocated. The existing configured factory is retained: this does
not introduce replica routing or change pool budgets. Fresh point reads outside
the protected transition are an intentional cost, not a reduction in total
replay queries.

Failure in this read phase is still an ordinary replay failure, not
`FileMessageCommittedError` for a newly saved message. This distinction matters:
the retry's freshly staged copies are unused and must be discarded, while the
original message's attachment files remain owned and downloadable.

Verification:

- Before the fix, both parallel HTTP cases failed: a contender could not finish
  during a controlled two-second pause in replay serialization, and the original
  transaction was still active. After the fix, the contender finishes before
  releasing the pause and the original transaction is inactive.
- Two additional HTTP cases cover response failure, removal of unused retry
  files, byte-for-byte peer downloads, stable retry IDs and no extra messages.
- The four new cases failed before the fix and passed afterward. The final
  related profile passed 20 cases (57 deselected), including the prior
  post-commit attachment protection and ordinary send/read/access flow.

The SQLite-only lock adapter uses `BEGIN IMMEDIATE` at the existing lock seam
because SQLite ignores `FOR UPDATE`. It models write exclusion for the tested
same-conversation race; it is not PostgreSQL row-lock contention measurement.
The pause/deadline is a structural concurrency check, not a production latency
or p95/p99 benchmark. Native PostgreSQL verification, WAL and production timing
remain outstanding. No production restart or rollout was performed.

Evidence:
`artifacts/operations/chat-replay-lock-verification-20261118.json`.

### Prepared atomic delivery-state intent

Real HTTP fault injection reproduced a recovery gap: a new message was committed
and acknowledged without its delivery-state outbox job. Dropping optional
post-send scheduling lost the intent. The fallback repairs only the latest 50
text messages within five minutes, so it is not an unbounded recovery guarantee;
other lean-send kinds such as contact are not covered by that fallback.

The message and one delivery-state intent now insert in the same transaction
before commit. An outbox INSERT failure rolls back the message and conversation
sequence too. Delivery-state fan-out, directory resolution and optional
notifications stay outside the conversation lock. New sends no longer require
the deferred post-ACK INSERT; legacy-adapter fallback remains compatible.
The metrics include the outbox INSERT in preparation/insert time.

Mention-bearing messages carry the original body and a send-time permission
snapshot for `@all`. The worker resolves mentions before opening its delivery
write transaction. A later promotion does not turn a member's old `@all` into a
manager mention; demotion does not erase a moderator's valid send-time mention.
Existing jobs with explicit mentioned-user IDs retain their existing format and
processing behavior. Ordinary username resolution still depends on the shared
directory resolver; this is not a new exactly-once notification guarantee.

This is a reliability change, not an UPDATE/WAL optimization. It adds one
mandatory INSERT to the critical transaction instead of relying on a later
transaction. No p95/p99 improvement is claimed.

Verification:

- Fault injection before the fix: four of five initial HTTP recovery cases
  failed (missing durable intent, successful response despite the simulated
  intent-write failure, missing recovered mention). They pass after the fix.
- PostgreSQL 16.15: seven recovery/concurrency cases passed in logical `chat`.
- PostgreSQL 16.15: 17 relevant HTTP cases passed in legacy `public` through the
  actual runtime `schema_translate_map`, including the prepared file/forward
  changes and native row-lock/replay checks.
- Both native runs used an explicitly verified disposable loopback cluster,
  separate synthetic databases, the existing development Alembic initializer,
  `fsync=on` and `synchronous_commit=on`. No production database was a test target.
- SQLite: 34 related send-path, mentions, receipts and HTTP recovery checks passed.
- Worker outage is modeled by discarding optional scheduling, advancing the
  worker clock by ten minutes and constructing a fresh dispatcher. This is not
  an operating-system process-kill or power-loss test.

Evidence and reproducible native runner:

- `artifacts/operations/chat-native-pg-intent-20261118.json`
- `artifacts/operations/chat-native-pg-public-20261118.json`
- `artifacts/operations/chat-atomic-intent-verification-20261118.json`
- `artifacts/operations/run_isolated_chat_pg_20261118.py`
- `tests/test_e2e_chat_delivery_recovery.py`

The disposable PostgreSQL was stopped cleanly after verification; its loopback
port was confirmed closed. Production backend, both Chat nodes, Scan and its
worker retained their preflight PIDs and stayed online.

The earlier SQLite-only verification limits remain historical records; these
native checks address their row-lock/dialect gap, not production performance.
Before release, identify every delivery-state consumer and coordinate its code
version. An old worker ignores the new mention snapshot fields. Do not allow an
old consumer to claim new-format intents during a mixed-version rollout.
No migration, production settings change or deployment was performed.

### Production guarantee snapshot, read-only

At 14:26 local server time, runtime Chat tables still resolved to `public`.
The outbox contained 16,132 delivered history rows and three failed rows, not a
16,000-job queued backlog. The latest 50 text messages all had delivery intents;
the crash gap is a fault-injected code-level finding, not evidence that these
50 production messages lost their delivery state. Existing failed jobs were not
retried, edited or removed.

One activity snapshot showed `WALWrite` and transaction/tuple-lock waits among
authorization/realtime connections. It is not a representative latency series
or proof of the cause of every delay.

The new diagnostic connection was explicitly read-only and showed server
defaults `synchronous_commit=on`, `fsync=on`, `wal_writer_delay=200ms`.
These settings describe that connection, NOT the existing chat application
sessions. `.env` still contains `CHAT_DB_ASYNC_COMMIT=1`; the current write-engine
code would opt into asynchronous commit. Existing session modes were not
directly observable with these views and must remain a release risk until
verified. No flag or process was changed. Atomic message/outbox storage does not
prevent loss of both acknowledged records when commit durability is weakened.

Evidence:
`artifacts/operations/chat-guarantees-production-readonly-20261118.json`.

## Remaining stages

The local write-cost comparison, exact candidate scope and rollout blockers are
recorded in [CHAT_DB_RELEASE_READINESS.md](CHAT_DB_RELEASE_READINESS.md).
The candidate is not approved for a one-step rolling deployment.

1. Extend observation to representative peak intervals and message-send stages.
   The first production comparison is recorded above; it does not close the
   intermittent WAL issue. Do not attribute unrelated concurrent improvements
   to this change.
2. Review monitoring write budgets against required history resolution and
   freshness. The current writer already rejects repeated/older protocol times;
   a new observation is not automatically a redundant write. Preserve packet
   counts, alert timing and historical aggregates.
3. Deploy and measure the prepared chat changes only after separate approval.
   Further shortening still requires work: the forward path locks the
   conversation before task-share recipient validation. File/forward replay
   responses now build outside that lock; other slow work and pool budgets still
   need review. Preserve final authorization, ordering and deduplication.
   The lean-send delivery-state intent is now prepared atomically and tested
   natively; realtime/push guarantees and the actual production commit mode
   remain separate acceptance items.
   Do not simply move access checks outside the protected transition.
4. Inventory existing connection pools and worker concurrency before changing
   budgets. Reserve capacity for interactive requests and apply bounded
   backpressure to background work; do not increase every pool independently.
5. Tune PostgreSQL only from measured memory, I/O and query behavior. Global
   `work_mem` increases multiply across operators and parallel workers. A slow
   commit is not by itself proof of a WAL fsync wait.
6. Consider a separate PostgreSQL instance for heavy background workloads only
   if contention remains. Check foreign keys, shared transactions, ownership and
   recovery first. Separate databases in the same cluster do not isolate WAL;
   separate instances on the same overloaded disk do not isolate storage.

## Release and acceptance

Deploy one verified change group at a time. Keep compatible code and schema for
rollback; restoring a production backup is not an automatic rollback strategy
because it can discard newer valid writes.

Provisional interactive targets are send p95 below 500 ms and p99 below 2 s on
an agreed representative workload. Acceptance also requires no lost acknowledged
messages, duplicate messages, false offline state, session-policy changes or
pool timeouts under normal load. Background peaks must not stall authorization.
Retain reliable commit semantics for critical records.

Only after stable checks should the already-authorized agent rollout resume in
bounded waves. Offline, busy, unsupported or low-disk PCs must be reported
separately rather than counted as successful installations.

### Monitoring minute-row double write — fixed, not deployed

Two read-only 45 s production intervals (10:44-10:46 UTC) showed the monitoring
worker as the largest app-table writer: ~1,170 UPDATE/45 s across
`monitoring_samples`+`monitoring_aggregates`+`monitoring_targets`+
`monitoring_interfaces`, vs 87 mail-snapshot and ~355 scan-agent UPDATE/45 s.
Cluster WAL was ~132-138 KB/s. These are two short windows, not a peak
representative sample, and table counters cannot attribute WAL per table.

Root cause found and reproduced: each split-protocol ICMP record wrote the
device minute row twice per transaction — `_merge_device_sample` flushed stats,
then `_icmp_sample` flushed again to attach the 10 s slot (INSERT+UPDATE on the
first poll, UPDATE+UPDATE afterwards). Regression test
`test_split_icmp_rewrites_minute_sample_row_once_per_probe` failed with
`inserts=1, updates=1` on the first probe before the fix.

Fix: the 10 s slot is folded into the same row values before the single flush;
`_icmp_sample` now reuses the pending/committed minute row instead of
flush-then-update. Packet counts, min/max rollups, the
manual-must-not-erase-scheduled rule and the different-minute edge (scheduled
slot at a minute boundary, legacy combined path) are preserved: 47 monitoring
e2e checks pass on SQLite. Expected effect is up to -1 UPDATE per ICMP record;
production magnitude unverified until deployed and remeasured.

Evidence: `artifacts/operations/background-write-baseline-20261118.json`.
No production change, migration or restart was performed.

### Desktop presence heartbeat race — fixed, not deployed

The deploy checkpoint found repeated `desktop_presence_pkey` UniqueViolation in
the untouched backend (concurrent first heartbeats: read-miss + insert on both
sides). Reproduced on SQLite via a synchronized read-miss barrier. Heartbeat
now uses one atomic INSERT .. ON CONFLICT DO UPDATE whose WHERE guard makes a
foreign-owner conflict a no-op that still raises DesktopPresenceIdentityError —
no takeover of another user's presence row. 15 desktop-presence checks pass;
includes both new regression tests. One less retry/error per heartbeat race;
production frequency was ~10-14 rows/45 s, so the load effect is minor — this is
a correctness fix, not a workload reducer.

### Device rollup deferral — fixed, not deployed

Second monitoring fix: `monitoring_aggregates` (~450 UPDATE/45 s) was rewritten by
every 10s ICMP record even though rollups only serve >7d history. A minute row now
applies its delta to the 5m/1h buckets at most ~once per minute (`_agg_applied` /
`_agg_applied_at` markers in the sample row); the skipped tail is marked
`_agg_pending` and finalized by the next record — including a bounded 15-minute
sweep so a closed minute is never lost. Effect: ~6 rollup writes/min/target ->
~4/min (2 own + 2 finalize), roughly -60% on this path. Trade-off recorded: an
*open* minute's contribution can lag rollups by up to ~1 min (rows pending across
a >15 min probe gap can stay unapplied until probing resumes). Interface-level
aggregates and `monitoring_targets` (~230 UPDATE/45 s, `row.current` rewrite per
poll) are the next candidates and require the same freshness choice.
Verification: 48 monitoring e2e + 31 related tests pass; new regression test
proves rollup writes drop to zero inside an open minute and totals stay exact
(sent/received sums incl. the finalized tail).

### monitoring_targets / monitoring_interfaces — contract-bound, not reduced

`monitoring_targets` (~230 UPDATE/45 s) rewrites `row.current` per record, but the
write is load-bearing, not churn: (1) the frontend recomputes liveness from the
stored timestamps — `isStale(icmp_checked_at || checked_at, 20)` in
Monitoring.jsx and MonitoringDeviceGrid hides the latency chip / shows
"данные устарели" past 20 s, so at a 10 s ICMP cadence any throttle still writes
~every 2nd probe and can flicker stale; (2) persisted `{kind}_checked_at` is the
retry dedup anchor — a skipped write lets a retried observation re-merge stats
(double packet counts). Reducing this path needs a product decision on display
freshness (e.g. widened stale window + slot-anchored dedup), not a hidden change.
`monitoring_interfaces` (~120 UPDATE/45 s) is the same pattern for the shown port.

### Deployed 2026-11-19: presence upsert + ICMP slot fold + rollup deferral

Restarted `itinvent-backend` (PID 27628, `-SkipScanRestart`) and
`itinvent-monitoring-worker` (PID 44464, standard script) — the worker owns the
ICMP/SNMP loop, so a backend restart alone would not activate the write-path
fixes. Readiness 200, both error logs clean after restart, other processes
untouched (Scan PID 26944, chat nodes unchanged). Read-only 45 s window after
deploy: `monitoring_aggregates` upd=67/ins=17 (was ~450 upd), `monitoring_samples`
upd=207/ins=41, `monitoring_targets` upd=220 (unchanged — contract-bound),
`monitoring_interfaces` upd=108 (unchanged). Aggregate writes dropped ~85%;
overall monitoring table writes ~602/45 s vs ~1 850 before the two fixes (~-60%).
The ~200 upd/45 s on monitoring_samples is the inherent minute-row merge path
(stats + slot in one write), not the removed double-write.

### Scan realtime cursor — fixed, pending scan restart

`scan_server/realtime.py` polls `ScanDatabaseStore.get_realtime_cursor` every ~2 s
while a Scan Center SSE subscriber is open. The PostgreSQL cursor was one UNION
with `MAX(COALESCE(finished_at, started_at, created_at, 0))` per section — a
non-sargable expression that seq-scanned all four scan tables per poll: the
scan_jobs leg alone measured 448 ms on production (~60k rows/s continuous).
Caught live in pg_stat_activity at ~34% active share. The cursor now runs four
`GROUP BY status ORDER BY status` aggregates (index-only plans: jobs 27 ms,
incidents ~5 ms, tasks 8 ms) plus pg_stat_user_tables write counters as the
change marker — stricter than a timestamp, catches in-place same-status updates.
Tuple equality semantics in the broker are unchanged. Total ~70 ms vs ~900 ms
per poll (~-92%), scan_jobs/scan_incidents seq scans eliminated. `scan_agents`
GROUP BY still seq-scans (956 rows, no status index — index needs a migration).
Verified: EXPLAIN plans on production + 25 scan tests. Other seq scans measured
(trusted_devices 336/min @92 rows, mobile_biometric 375/min @28 rows,
my_file_previews 463/min @228 rows) are sub-ms tiny-table reads, semantically
needed. Deploy: restart itinvent-scan (standard script) — not yet restarted.

### auth_runtime_items transactionid waits — analysis + scoped fix (not deployed)

During the 17:10-17:14 stall wave the watcher caught INSERTs into
`system.auth_runtime_items` waiting on `transactionid`, plus auth COMMITs
waiting WALWrite (chat auth 400-740 ms). Mechanism: rate-limit upserts
(`INSERT ... ON CONFLICT DO UPDATE` on PK namespace+item_key) serialize on a
hot key; the leading tx's COMMIT stalls on WAL fsync, so follower upserts pile
up on its unresolved xid. Internal contributor: the throttling counter session
committed synchronously though its data is telemetry-class. Fix: the
`rate_limit` namespace counter now uses `app_session(relax_commit=True)` — the
existing telemetry precedent (`SET LOCAL synchronous_commit = off`) — so during
a WAL stall it returns without fsync, releasing the PK slot and shortening the
transactionid chain. Security data stays durable: refresh/refresh_grace/
revoked_jti, login lockout scopes (set_json/delete paths, not the counter) and
the `refresh_grace_hits` replay counter are unchanged. 83 auth tests pass;
2 failures (network-zone classification) reproduce on unmodified code —
pre-existing, env-dependent.
