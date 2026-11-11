# ADR-0007: Password Vault Phase 2 operational limits

## Status

Accepted (2026-09-18)

## Context

Phase 2 of `documentation/technical/PASSWORD_VAULT_SECURITY_PLAN.md` hardened the
password vault backend: a `DELETE /passwords/unlock` (lock) endpoint, a second
per-user unlock rate bucket plus a reveal throttle, strict canonical-Fernet
enforcement for `PASSWORD_VAULT_KEY` in production, and opt-in key versioning
(`PASSWORD_VAULT_KEY_VERSIONING` → `fernet:v1:` prefix).

Three behaviors have operational consequences that must be understood before
rollout and incident response.

## Decision

1. **`lock()` is fail-secure on database unavailability.** The service deletes
   both runtime unlock keys (`<user>:<session>` and `<user>:user`) from
   `auth_runtime_store` *before* resolving the app database URL and writing the
   `lock` audit row. If the app DB is down, the audit write raises, but the
   vault is already locked. Operators must treat a failed `DELETE /unlock`
   response as "locked but audit may be missing", not as "still unlocked".

2. **Rate-limit checks have a ±1 race window.** Unlock and reveal limits are
   enforced as read-then-increment against the runtime store counters. Two
   concurrent requests at the limit boundary can both pass or both be counted,
   so the effective threshold is `limit ± 1`. This is accepted: the counters are
   a brute-force deterrent, not a hard guarantee. A `Retry-After` of the full
   window (300 s unlock / 60 s reveal) is returned on denial.

3. **Strict Fernet in production breaks create/update under a passphrase key.**
   With `APP_ENV=production`, both `PASSWORD_VAULT_KEY` and
   `PASSWORD_VAULT_KEY_LEGACY` must be canonical Fernet keys; the SHA-256
   passphrase fallback raises `SecretCryptoError`. If existing secrets were
   encrypted with a passphrase-derived key, `PASSWORD_VAULT_KEY_LEGACY` holding
   that passphrase also fails under strict mode. Required rotation order:
   - (a) issue a canonical `PASSWORD_VAULT_KEY` and place the old passphrase in
     `PASSWORD_VAULT_KEY_LEGACY` on a **non-strict** environment (or pre-strict
     build), so reads still succeed;
   - (b) re-save/re-encrypt all stored vault secrets so every row is encrypted
     under the canonical key (batch rewrite; each entry update re-encrypts);
   - (c) only then enable strict production mode and remove the passphrase from
     `PASSWORD_VAULT_KEY_LEGACY`.

   Rotating `PASSWORD_VAULT_KEY` requires a **process restart**: `_build_fernet`
   is `lru_cache`-backed, so a key change in the environment is not picked up by
   a running worker — a hot swap without restart silently keeps encrypting and
   decrypting with the old key until the process exits.

## Consequences

- Lock semantics are safe during DB outages, but audit gaps must be reconciled
  from auth logs when the DB recovers.
- Rate limits should not be asserted as exact thresholds in monitoring; alert on
  denials, not on count equality.
- Production deploys must verify `PASSWORD_VAULT_KEY` is canonical Fernet
  (`Fernet.generate_key()` output) *before* the strict code path is reached;
  startup smoke check should include a decrypt probe of one known secret.
