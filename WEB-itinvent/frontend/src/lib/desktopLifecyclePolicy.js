export const MAX_LIFECYCLE_EVENT_AGE_MS = 120_000;
export const MAX_LIFECYCLE_FUTURE_SKEW_MS = 5_000;
export const DESKTOP_LIFECYCLE_COOLDOWN_MS = 15_000;

const OCCURRED_UTC_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u;

export const parseOccurredUtcMs = (value) => {
  if (typeof value !== 'string' || !OCCURRED_UTC_PATTERN.test(value)) {
    return null;
  }
  const occurredMs = Date.parse(value);
  return Number.isFinite(occurredMs) ? occurredMs : null;
};

export const isLifecycleEventFresh = (
  event,
  nowMs,
  maxAgeMs = MAX_LIFECYCLE_EVENT_AGE_MS,
  maxFutureSkewMs = MAX_LIFECYCLE_FUTURE_SKEW_MS,
) => {
  const occurredMs = parseOccurredUtcMs(event?.occurredUtc);
  if (occurredMs == null) return false;
  const ageMs = nowMs - occurredMs;
  if (ageMs > maxAgeMs) return false;
  if (ageMs < -maxFutureSkewMs) return false;
  return true;
};

export const isPendingLifecycleEnvelopeFresh = (
  envelope,
  nowMs,
  maxAgeMs = MAX_LIFECYCLE_EVENT_AGE_MS,
) => {
  const receivedAt = Number(envelope?.receivedAt || 0);
  if (!Number.isFinite(receivedAt) || (nowMs - receivedAt) > maxAgeMs) {
    return false;
  }
  return isLifecycleEventFresh(envelope?.event, nowMs, maxAgeMs);
};
