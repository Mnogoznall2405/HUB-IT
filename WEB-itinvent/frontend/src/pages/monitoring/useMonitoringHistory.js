import { useCallback, useEffect, useMemo, useState } from 'react';
import { monitoringAPI } from '../../api/monitoring';
import { errorMessage, isNumber } from './monitoringFormat';

// The cache belongs to one mounted page and one access context. It never survives logout.
export default function useMonitoringHistory({ accessKey, targetId, interfaceId = '', hours, start, end, enabled, version, latency = false }) {
  const cache = useMemo(() => new Map(), [accessKey]);
  const key = JSON.stringify([accessKey, targetId, interfaceId, hours, start, end, latency]);
  const [result, setResult] = useState({});
  const [attempt, setAttempt] = useState(0);
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === 'visible');
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  const reload = useCallback(() => { cache.delete(key); setAttempt((value) => value + 1); }, [cache, key]);
  const clearTarget = useCallback((id) => {
    for (const [entryKey, entry] of cache) if (entry.targetId === id) cache.delete(entryKey);
  }, [cache]);
  useEffect(() => {
    if (!enabled || !targetId || !visible) return undefined;
    const cached = cache.get(key);
    if (cached?.version === version && Date.now() - cached.updatedAt < 60000) return undefined;
    const controller = new AbortController();
    setResult((old) => ({ key, data: cached?.data || (old.key === key ? old.data : null), loading: true, error: '', updatedAt: cached?.updatedAt }));
    const previous = cached?.data;
    const lastAt = previous?.points?.at(-1)?.at;
    const after = latency && previous?.resolution_seconds === 10 && lastAt
      ? new Date(Date.parse(lastAt) - 60000).toISOString() : undefined;
    const fetch = latency ? monitoringAPI.latencyHistory : monitoringAPI.history;
    fetch(targetId, { interfaceId, hours: hours || 24, start, end, after, signal: controller.signal }).then((incoming) => {
      if (controller.signal.aborted) return;
      let data = incoming;
      if (latency && previous && after && incoming.resolution_seconds === previous.resolution_seconds) {
        const first = Date.parse(incoming.window_start);
        const replace = Date.parse(incoming.replace_from);
        const points = [...previous.points.filter((p) => Date.parse(p.at) >= first && Date.parse(p.at) < replace), ...incoming.points];
        data = { ...incoming, points, has_data: points.some((p) => isNumber(p.latency_ms)) };
      }
      const entry = { data, version, updatedAt: Date.now(), targetId };
      cache.delete(key); cache.set(key, entry);
      while (cache.size > (latency ? 4 : 16)) cache.delete(cache.keys().next().value);
      setResult({ key, ...entry, loading: false, error: '' });
    }).catch((error) => {
      if (!controller.signal.aborted) setResult((old) => ({ ...old, key, loading: false, error: errorMessage(error) }));
    });
    return () => controller.abort();
  }, [cache, key, targetId, interfaceId, hours, start, end, enabled, visible, version, attempt, latency]);
  const current = result.key === key ? result : cache.get(key) || {};
  return { ...current, data: enabled ? current.data : null, error: enabled ? current.error : '',
    loading: Boolean(enabled && visible && (current.loading || (!current.data && !current.error))), reload, clearTarget };
}
