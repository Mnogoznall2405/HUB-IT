export const DEFAULT_MAILBOX_QUOTA_BYTES = 5 * 1024 * 1024 * 1024;

export function resolveEffectiveQuotaBytes(row) {
  if (row?.quota_bytes != null && row.quota_bytes !== '') {
    return Number(row.quota_bytes);
  }
  if (row?.uses_default_quota) {
    return DEFAULT_MAILBOX_QUOTA_BYTES;
  }
  return null;
}

export function resolveEffectiveUsedPercent(row) {
  const usedPercent = Number(row?.used_percent);
  if (Number.isFinite(usedPercent)) {
    return usedPercent;
  }
  const usedBytes = Number(row?.used_bytes);
  const quotaBytes = resolveEffectiveQuotaBytes(row);
  if (!Number.isFinite(usedBytes) || !quotaBytes) {
    return null;
  }
  return Math.round((usedBytes / quotaBytes) * 10000) / 100;
}
