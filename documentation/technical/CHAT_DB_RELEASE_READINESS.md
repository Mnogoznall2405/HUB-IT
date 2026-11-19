# Chat DB release readiness, 2026-11-18

Status: v2 deployed in two phases after explicit deployment, reliable-commit and
recovery-policy approvals. Operational postchecks passed at approximately 10:40
UTC. Application-traffic and performance acceptance remain pending.

## Deployment Outcome

- Applied `chat-db-reader-stage1-20261118` to both Chat readers before publishing
  `chat-db-candidate-20261118-v2`. Both archives and all five final source hashes
  were verified. The original v1 archive is historical evidence only.
- Restarted only `itinvent-chat-a`, `itinvent-chat-b`, `itinvent-backend` and
  `itinvent-ai-chat-worker` using standard scoped scripts. The other 17 PM2
  process PIDs, including Scan, preview/push workers and sandbox control, did not
  change. Backend and both Chat readiness checks passed; both ARR nodes are
  enabled and subscribed to PostgreSQL realtime. Scan health returned 200.
- Changed only `CHAT_DB_ASYNC_COMMIT=1` to `0` in `.env`, as explicitly selected.
  A fresh configured write-engine session reports `synchronous_commit=on`,
  `fsync=on`. This is not direct introspection of every application connection;
  unselected background processes were intentionally not restarted.
- Saved verified PM2 state. Final snapshot: 159/300 PostgreSQL connections,
  141 free, versus the required reserve of 20. This is not workload-reduction
  proof. Outbox remains 16,150 delivered and the same three old failed jobs,
  with no queued/processing rows in the inspected samples.
- No automatic restarts or new exception markers in the final stability window.
  Earlier checkpoints were paused to classify an existing Desktop heartbeat
  `desktop_presence_pkey` error and a membership-guard `PermissionError` on
  conversation subscription. The former also appears before deployment; the
  latter returns `forbidden` and is not a send-persistence failure. Neither
  protection nor unrelated product code was changed.
- The first script attempt under PowerShell 7 stopped before drain/restart due
  to IIS compatibility deserialization. Native Windows PowerShell 5.1 passed
  the read-only ARR preflight and ran the unchanged standard lifecycle scripts.

No production DDL/migrations, test messages, attachment-download tests, destructive
operations or data rollback were run. No natural messages were observed after
phase-two publication or in the final window; successful production sends,
production p95/p99 and WAL improvement are therefore not established.

Full evidence: `artifacts/operations/chat-db-deployment-20261118.json`.
The preparatory holds/order below record the pre-approval state, not an ongoing
deployment block. Missing authoritative historical rollback provenance and the
shared dirty source directory remain operational risks accepted for this rollout.

## Measured write cost

These measurements precede the enqueue-result/wake-up fix recorded below. They
remain the comparison for the original candidate, not a new benchmark of v2.

Disposable PostgreSQL 16.15, `fsync=on`, `synchronous_commit=on`, legacy `public`
through the real `schema_translate_map`. Each variant ran 3 x 200 measured HTTP
sends per concurrency level, plus unmeasured warmup. Variant order alternated.
There were 2,400 successful measured sends. Each cell verified unique message
IDs, contiguous conversation sequences and exactly one committed intent per
message after completing the legacy deferred INSERTs.

| HTTP ACK, milliseconds | Legacy deferred | Atomic intent |
| --- | ---: | ---: |
| One sender p50 / p95 / p99 | 13.756 / 16.237 / 17.924 | 14.019 / 16.396 / 18.705 |
| Four senders, one conversation p50 / p95 / p99 | 51.191 / 60.814 / 96.482 | 54.472 / 64.775 / 108.517 |

For 200 messages, both variants perform 800 SELECTs, 200 UPDATEs and 400 INSERTs
when the deferred intents are included. The old path uses 400 COMMITs; the new
path uses 200. The new path moves one INSERT per message before ACK rather than
eliminating it.

At concurrency four, per-round lock-hold p95 was 7.902-8.069 ms for the legacy
path and 10.562-11.524 ms for atomic intent. This change is a durability trade-off,
not faster ACK or shorter lock holding. Median batch completion including every
intent was 3291 -> 2866 ms for one sender and 3037 -> 2787 ms for four senders,
but the harness deliberately completes old deferred intents sequentially after
each batch. These are not production throughput claims.

Most local WAL deltas were approximately 990 KB legacy versus 973 KB atomic per
200 sends; one atomic round reached 1084 KB. This does not establish a reliable
WAL improvement.

Limits:

- Real TestClient routes and ORM, but in-process HTTP and a stubbed user directory;
  production network RTT, auth DB, background work and full fan-out are absent.
- The legacy persistence method comes from git revision
  `7182f02e95c69c9156e0b843911f320f68637a11`, with the prepared INSERT-time dedup
  guard retained. Common dependencies are current. It is not a historical full
  deployment image. Timed requests have distinct client IDs.
- Optional notifications, enrichment and realtime are suppressed equally.
  Old intents are explicitly completed before validating final state.
- Each pooled tail has only 600 samples. These values do not certify production
  p95/p99 or resolve intermittent WAL stalls.

Reproducer and evidence:

- `artifacts/operations/benchmark_chat_intent_20261118.py`
- `artifacts/operations/chat-intent-cost-20261118.json`
- Earlier correctness evidence: `chat-native-pg-intent-20261118.json` and
  `chat-native-pg-public-20261118.json` in the same operations directory.

## Runtime consumers and writers

The sanitized PM2 snapshot, entrypoints and source call graph establish:

| Process | Delivery-state consumer | Relevant writer |
| --- | --- | --- |
| `itinvent-chat-a`, `itinvent-chat-b` | Yes: dispatcher and immediate post-ACK claim/apply | HTTP, WS and scheduled messages |
| `itinvent-backend`, role `api` | No chat dispatcher at startup in this role | Task discussion and AI sandbox/action paths can call text persistence |
| `itinvent-ai-chat-worker` | No dispatcher started by its entrypoint | AI replies, error replies, restored results and digest |
| `itinvent-chat-push-worker` | No: starts push outbox, not event outbox | Not identified as this text write path |
| `itinvent-preview-worker` | No: attachment previews | Not identified as this text write path |
| `itinvent-chat-push-outbox-retention-worker` | No: push retention | Not this write path |
| `itinvent-mail-notification-worker` | No event dispatcher identified | No direct text-persistence caller identified |

Disabling only event polling is not a sufficient drain: HTTP/WS post-ACK work
can explicitly claim a delivery-state job. Source inspection is not a guarantee
that no manual/embedded process exists; repeat the process/role inventory at
release preflight. Producer restarts are part of scope if the atomic guarantee
is to cover more than Chat HTTP/WS.

## Exact candidate scope

The runtime candidate contains only these five files:

1. `WEB-itinvent/backend/chat/message_persistence.py`: atomic lean-send intent,
   INSERT-time dedup handling, batched file/forward preview enqueue, replay
   response outside the original write lock, committed-forward file ownership.
2. `WEB-itinvent/backend/chat/event_outbox_service.py`: new mention-snapshot reader
   and accurate enqueue counts from returned IDs.
3. `WEB-itinvent/backend/chat/chat_mentions.py`: optional send-time `@all` permission.
4. `WEB-itinvent/backend/chat/chat_attachment_preview_service.py`: batched lookup,
   pending-row reuse and processing-lease preservation.
5. `WEB-itinvent/backend/chat/service.py`: committed-forward cleanup guard and
   legacy-adapter compatibility.

Tests and documentation remain source evidence, not runtime payload. The
`_common.py` changes are comments only and are not necessary for runtime release.
Do not include unrelated dirty files, `db.py`, `.env`, PM2/IIS configuration,
frontend assets or migrations. Candidate hashes and the archive are in
`artifacts/operations/chat-db-candidate-20261118-v2/`.

## Verified two-phase composition

Phase one is a separate archive in
`artifacts/operations/chat-db-reader-stage1-20261118/`. Four files are byte-for-byte
identical to v2. Only `persist_text_message` is replaced with the previously
benchmarked deferred method, retaining INSERT-time dedup recovery. An AST check
confirms that the rest of `message_persistence.py` is unchanged. The archive is
not an exact copy of the old running release or an authoritative rollback.

The test launcher `run_chat_reader_candidate_20261118.py` imports the staged
persistence module under its real canonical module name before the app loads.
It verifies hashes and never overwrites live source. Evidence confirms:

- Phase one, legacy `public`: 17 cases passed, including four parallel retries of
  one client ID, real deferred enqueue/apply, both persisted intent formats,
  allowed/denied `@all` snapshots, file/forward retry, rollback and committed files.
- Phase one, logical `chat`: four compatibility cases passed.
- Phase two, `public`: the three new persisted-format cases passed.
- SQLite/current writer: three format cases passed; the phase-one-only assertion
  is intentionally skipped outside the intermediate artifact.

The first-phase writer still has the post-ACK intent crash window. First-phase
success is not final reliability acceptance. Phase two changes only the text
persistence method back to the atomic v2 version; the other four files are equal.

Prepared order, subsequently executed with the approvals recorded above:

1. Freeze source and obtain deployment/rollback approval. Confirm actual schema,
   pending jobs, runtime roles, no unlisted consumers, and approved PM2/environment
   values. Dirty ecosystem files or unrelated `.env` changes can be activated by
   `--update-env`; the five-file archive does not approve those changes.
2. Publish the intermediate archive only, verify exact hashes, then update both
   Chat consumers with the verified dual-node script. Check readiness and behavior
   after each node. Do not publish phase two while any old consumer remains.
3. Publish v2, verify its hashes, then update both Chat nodes and the remaining
   producers: backend API and AI Chat worker. Decide reliable commit settings
   explicitly before this phase; do not silently carry over asynchronous ACK
   guarantees. Check each process and stop the rollout if a checkpoint fails.
4. Verify queue outcomes, counters/mentions, retries, file downloads and matched
   production latency/workload intervals. No production timing is established by
   these local tests.

The source-inspected scoped script options are
`restart-chat-scale.ps1 -SkipSharedWorkers`,
`restart-backend.ps1 -SkipScanRestart`, and
`restart-ai-agents.ps1 -ChatWorkerOnly`. These are scope references, not permission
to run them. The backend default still restarts Scan; its explicit opt-out exists
in current code. The AI default also touches sandbox control; its opt-out avoids
that. Preview/push workers, Scan and sandbox control are not included in this
four-process update. Execution used native Windows PowerShell 5.1.

Once snapshot intents exist, compatible readers must remain. Reverting the writer
to phase one reintroduces the crash window for new sends and needs explicit risk
approval. Do not call that a durability-preserving automatic rollback. Restoring
old data or deleting jobs is never part of the source rollback.

## Pre-release Holds and Ordering

Historical preflight decisions follow. Reliable commit and stepwise recovery
were explicitly approved before mutation; deployment results are recorded above.

1. **Durability decision.** At preflight `.env` contained `CHAT_DB_ASYNC_COMMIT=1`. The earlier
   read-only diagnostic connection showed `synchronous_commit=on`, but it cannot
   show the mode of existing application sessions. Decide and explicitly approve
   reliable commit configuration and the affected process scope separately.
   Atomic outbox cannot rescue message and intent if both acknowledged records
   are lost through asynchronous commit.
2. **Shared source path.** `C:\Project\Image_scan` resolves to the same physical
   directory as this worktree. Current process PIDs are unchanged, but an
   automatic restart can load prepared source. This is not an isolated staging
   deployment. Freeze exact source versions before any restart; do not copy the
   entire dirty tree or call a current-file backup an old running image.
3. **Reader-before-writer rollout.** New mention intents contain `mention_body`
   and `mention_all_allowed`. An old consumer silently ignores them. First
   deploy the now-tested compatibility candidate with new readers and its
   deferred writer pinned. Update every consumer, verify versions/readiness,
   then enable/release the atomic writer and update every relevant producer.
   The combined v2 archive is not that intermediate release.
4. **Standard-script discrepancy.** Current `restart-chat.ps1` refuses the dual
   topology and directs operators to `restart-chat-scale.ps1`. The latter
   restarts one node at a time; its default also updates preview and push workers.
   Therefore the earlier generic recommendation to use `restart-chat.ps1` for
   split Chat does not match current code. Do not run either as an unreviewed
   one-step deployment of this candidate. Use the verified dual runbook after
   approval, with the intended shared-worker scope explicitly selected.
5. **Rollback provenance.** The benchmark git revision is not proof of the code
   loaded by running processes. Obtain an authoritative prior release artifact.
   Once new-format intents exist, keep compatible readers even if reverting the
   writer. Never restore an old DB backup, delete intents or replay failed jobs
   automatically as a code rollback.

Every phase needs exact file/version preflight, explicit target authorization,
readiness checks and post-checks of message ID/order, downloads, outbox outcomes,
auth errors, lock waits and latency. No restart command was executed during
preparation against production. The temporary loopback PostgreSQL was stopped
cleanly and its port was verified closed. Backend, both Chat nodes, AI/push/preview
workers and Scan retained their recorded PIDs. The sanitized final snapshot is
`artifacts/operations/chat-db-candidate-20261118/runtime-snapshot.json`.

## Additional driver finding

On this isolated PostgreSQL/psycopg stack, the legacy enqueue helper returned
False for successful INSERTs. A direct probe reproduced `rowcount=-1` with
implicit RETURNING, a generated primary key and one committed row. The helper
counts only positive rowcount, so it also misses the local dispatcher wake-up.
This is not evidence of failed database persistence. It can undercount repairs
and defer dispatch until polling.

No product code was changed during the original measurement. The subsequent
focused fix now counts explicit `RETURNING id` rows instead of rowcount. Conflict
returns no row, so duplicate enqueue remains zero and does not wake the worker.
Wake-up remains after successful commit; no SELECT or additional transaction was
added. The no-key enqueue path is unchanged.

The worker/store regression uses an HTTP-created message, a fresh session to
verify the committed row, and the real idle-wait event on an asyncio loop with
enqueue on another thread. HTTP alone cannot expose the private inserted count
or distinguish a missed wake from the next periodic poll.

- Before the fix, the native public-schema regression committed its row but
  reported zero inserts and failed to wake the dispatcher. The no-key and
  rollback cases passed.
- After the fix, PostgreSQL passed ten recovery/enqueue cases in `public` and
  three enqueue cases in logical `chat`.
- SQLite passed 18 related dispatcher, idle-backoff and recovery/enqueue cases.
- Tests cover deduplicated and no-key first/repeated inserts, wake-up, and
  second-INSERT failure rolling back the entire batch without a wake.

Evidence in `artifacts/operations/`:
`chat-enqueue-rowcount-probe-20261118.json`,
`chat-enqueue-native-red-20261118.json`,
`chat-enqueue-native-public-green-20261118.json`,
`chat-enqueue-native-chat-green-20261118.json`.
The v2 archive supersedes the original candidate and is now the deployed source
snapshot. A test expectation that previously assumed delivery-state repair was
updated to reflect the already-atomic intent.

## Next acceptance work

Enqueue result/wake-up correctness is verified locally; operational deployment
checks passed, but there were no natural messages in the final observation
window. Collect matched production send and background-peak intervals before
making p95/p99, WAL or overall workload-isolation claims. The existing Desktop
heartbeat insert race is a separate follow-up, not a fixed part of this release.
