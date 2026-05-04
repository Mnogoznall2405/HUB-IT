import { useCallback, useRef } from 'react';

export default function useMailAsyncTaskGate({ cooldownMs = 0 } = {}) {
  const inFlightRef = useRef(new Map());
  const completedAtRef = useRef(new Map());

  const run = useCallback((gateKey, task, { force = false, bypassCooldown = false } = {}) => {
    const normalizedGateKey = String(gateKey || '').trim();
    if (!normalizedGateKey || typeof task !== 'function') return null;

    const inFlight = inFlightRef.current.get(normalizedGateKey);
    if (inFlight) return inFlight;

    const normalizedCooldownMs = Number(cooldownMs);
    const lastCompletedAt = Number(completedAtRef.current.get(normalizedGateKey) || 0);
    if (
      !force
      && !bypassCooldown
      && Number.isFinite(normalizedCooldownMs)
      && normalizedCooldownMs > 0
      && (Date.now() - lastCompletedAt) < normalizedCooldownMs
    ) {
      return null;
    }

    let promise;
    try {
      promise = Promise.resolve(task());
    } catch (error) {
      promise = Promise.reject(error);
    }

    promise = promise.finally(() => {
      completedAtRef.current.set(normalizedGateKey, Date.now());
      inFlightRef.current.delete(normalizedGateKey);
    });

    inFlightRef.current.set(normalizedGateKey, promise);
    return promise;
  }, [cooldownMs]);

  const clear = useCallback((gateKey) => {
    const normalizedGateKey = String(gateKey || '').trim();
    if (!normalizedGateKey) return;
    completedAtRef.current.delete(normalizedGateKey);
    inFlightRef.current.delete(normalizedGateKey);
  }, []);

  return { run, clear };
}
