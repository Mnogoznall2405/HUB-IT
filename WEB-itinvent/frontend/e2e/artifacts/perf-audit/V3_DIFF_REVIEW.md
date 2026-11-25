# Differential security review — `perf/my-files-v3` (commit `f642b3f6`)

Scope: backend `my_files_service.py` / route / response model / migration 0177, frontend api client + `MyFiles.jsx` data path. Read-only review on the committed diff; the findings below were verified against the final code, not the diff text alone.

## Verdict

No exploitable regressions found. All new code paths preserve the existing access-control shape; two residual observations are listed for the record.

## Checks performed

| Risk area | Result |
|---|---|
| `include=tree,quota` namespace leak | SAFE — `_attach_listing_includes` is driven by `owner` from `_read_owner_locked`, which yields a foreign owner namespace **only** for library folders (`owner_user_id < 0`) and only after `may_act_locked(user, owner, "view")` passes. For personal shared folders (`owner > 0`) `owner` stays the requester, so `include=tree` on `view=shared` attaches the *requester's own* tree — useless but not a leak. |
| ETag revocation safety | SAFE — `view=shared` is explicitly ETag-free (`etag_eligible = normalized_view != "shared"`), so a revoked grant always re-runs access checks. |
| ETag fingerprint coverage | SAFE for file/folder writes, soft-deletes, expiry flips, version bytes (quota), library rows, collaborator **counts**, `is_favorite` (bumps `updated_at`). |
| Library union merge | SAFE — `_merge_library_results` scans `owner_user_id IN (…)` over libraries where `library_role_locked` returned a truthy role for the caller only; per-row `my_role` tagging preserved; bound params. |
| Cursor pagination | SAFE — `(created_at, id)` compared through SQLAlchemy column expressions (parameterized); malformed cursor → `(None, None)` → page 1; pagination is opt-in and unreachable for views where it was not implemented. |
| Migration 0177 | SAFE — DDL only (`CREATE/DROP INDEX`), idempotent guards, no DML, no auto-apply in production (release-runbook command). |
| Secrets | SAFE — no tokens/keys/connection strings in the diff; probe scripts use the e2e-local credentials only. |

## Residual observations (non-blocking)

1. **Collaborator role edits don't bump the ETag.** The fingerprint tracks collaborator *counts*, not role values. Changing a member's role without add/remove can serve a stale 304 for `collaborators_count`/role metadata until any other mutation occurs. Impact: stale display data only — access decisions are re-checked server-side per action. Severity LOW; fix = add `max(collaborator updated_at)` to the aggregate if such a column exists.
2. **`include` accepts arbitrary tokens.** Unknown flags are ignored silently (forward-compatible by design); `include=tree` on `view=shared` wastes a tree query on the caller's own folders. Consider ignoring `include` for `view=shared` to save a query — cosmetic, not security.

## Coverage limits

- Frontend diff reviewed for contract/handling only (no new HTML injection surface; API data still rendered via React text nodes).
- Concurrent-write races inside one listing request were not formally modeled; sessions are per-request and short.
- Load-probe fast errors at ≥20 users × f1000 are documented in the results report as a capacity observation, not a security issue.
