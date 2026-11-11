import { useCallback, useRef } from 'react';

export default function useMailAutoReadGuard({ ttlMs } = {}) {
  const inFlightRef = useRef(new Set());
  const completedAtRef = useRef(new Map());

  const pruneCompleted = useCallback((now) => {
    const normalizedTtlMs = Number(ttlMs);
    if (!Number.isFinite(normalizedTtlMs)) return;

    for (const [key, value] of completedAtRef.current.entries()) {
      if ((now - Number(value || 0)) >= normalizedTtlMs) {
        completedAtRef.current.delete(key);
      }
    }
  }, [ttlMs]);

  const begin = useCallback((guardKey) => {
    const normalizedGuardKey = String(guardKey || '').trim();
    if (!normalizedGuardKey) return false;

    const now = Date.now();
    const normalizedTtlMs = Number(ttlMs);
    pruneCompleted(now);

    if (inFlightRef.current.has(normalizedGuardKey)) {
      return false;
    }

    const completedAt = Number(completedAtRef.current.get(normalizedGuardKey) || 0);
    if (
      Number.isFinite(normalizedTtlMs)
      && completedAt > 0
      && (now - completedAt) < normalizedTtlMs
    ) {
      return false;
    }

    inFlightRef.current.add(normalizedGuardKey);
    return true;
  }, [pruneCompleted, ttlMs]);

  const settle = useCallback((guardKey, succeeded) => {
    const normalizedGuardKey = String(guardKey || '').trim();
    if (!normalizedGuardKey) return;

    inFlightRef.current.delete(normalizedGuardKey);
    if (succeeded) {
      completedAtRef.current.set(normalizedGuardKey, Date.now());
    }
  }, []);

  return { begin, settle };
}
