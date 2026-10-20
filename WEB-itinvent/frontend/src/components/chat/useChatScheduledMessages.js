import { useCallback, useEffect, useRef, useState } from 'react';

import { chatScheduledAPI } from '../../api/chatScheduled';
import { getChatConfigCached } from '../../api/chatConfig';

// Scheduled ("Send later") messages of the open conversation. The list is reloaded when the
// conversation changes and right after the earliest message is due (it then leaves the list).
export default function useChatScheduledMessages({ conversationId = '', available = true } = {}) {
  const [enabled, setEnabled] = useState(false);
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sequenceRef = useRef(0);
  const retryTimerRef = useRef(null);
  const reloadRef = useRef(null);
  const scopeKey = `${Boolean(available && enabled)}:${conversationId}`;
  const scopeRef = useRef({ key: scopeKey });
  if (scopeRef.current.key !== scopeKey) scopeRef.current = { key: scopeKey };

  useEffect(() => {
    let alive = true;
    if (!available) {
      setEnabled(false);
      return undefined;
    }
    let timer;
    let attempts = 0;
    let pending = false;
    let resolved = false;
    const load = async () => {
      if (!alive || pending || resolved) return;
      clearTimeout(timer);
      pending = true;
      try {
        const config = await getChatConfigCached();
        if (alive) {
          resolved = true;
          setEnabled(Boolean(config?.scheduled_messages_enabled));
        }
      } catch {
        if (alive && attempts < 3) {
          attempts += 1;
          timer = setTimeout(load, attempts * 5000);
        }
      } finally {
        pending = false;
      }
    };
    void load();
    window.addEventListener('online', load);
    window.addEventListener('focus', load);
    return () => {
      alive = false;
      clearTimeout(timer);
      window.removeEventListener('online', load);
      window.removeEventListener('focus', load);
    };
  }, [available]);

  const reload = useCallback(async () => {
    if (scopeRef.current.key !== scopeKey) return [];
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    const id = String(conversationId || '').trim();
    if (!available || !enabled || !id) {
      setItems([]);
      return [];
    }
    const sequence = sequenceRef.current + 1;
    sequenceRef.current = sequence;
    const scope = scopeRef.current;
    try {
      const next = await chatScheduledAPI.list(id);
      if (sequence === sequenceRef.current && scope === scopeRef.current) {
        setItems(next);
        setError('');
      }
      return next;
    } catch (caught) {
      if (sequence === sequenceRef.current && scope === scopeRef.current) {
        const detail = caught?.response?.data?.detail;
        setError(typeof detail === 'string' && detail ? detail : 'Не удалось загрузить отложенные сообщения.');
        retryTimerRef.current = setTimeout(() => { void reloadRef.current?.(); }, 10000);
      }
      return [];
    }
  }, [available, conversationId, enabled, scopeKey]);
  reloadRef.current = reload;

  useEffect(() => {
    setItems([]);
    setError('');
    setBusy(false);
    void reload();
    return () => {
      sequenceRef.current += 1;
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    };
  }, [reload]);

  useEffect(() => {
    const due = items
      .filter((item) => item.status === 'scheduled' || item.status === 'sending')
      .map((item) => new Date(item.scheduled_for).getTime())
      .filter((time) => Number.isFinite(time));
    if (!due.length) return undefined;
    const delay = Math.min(Math.max(Math.min(...due) - Date.now() + 3000, 3000), 2 ** 30);
    const timer = setTimeout(() => { void reload(); }, delay);
    return () => clearTimeout(timer);
  }, [items, reload]);

  const run = useCallback(async (action, fallback) => {
    const scope = scopeRef.current;
    setBusy(true);
    setError('');
    try {
      const result = await action();
      if (scope !== scopeRef.current) return null;
      await reload();
      return scope === scopeRef.current ? result : null;
    } catch (caught) {
      const detail = caught?.response?.data?.detail;
      if (scope === scopeRef.current) setError(typeof detail === 'string' && detail ? detail : fallback);
      return null;
    } finally {
      if (scope === scopeRef.current) setBusy(false);
    }
  }, [reload]);

  const schedule = useCallback((body, scheduledFor, replyToMessageId = null) => run(
    () => chatScheduledAPI.create(String(conversationId), { body, scheduledFor, replyToMessageId }),
    'Не удалось запланировать сообщение.',
  ), [conversationId, run]);
  const update = useCallback((scheduledId, patch) => run(
    () => chatScheduledAPI.update(scheduledId, patch),
    'Не удалось изменить сообщение.',
  ), [run]);
  const cancel = useCallback((scheduledId) => run(
    () => chatScheduledAPI.cancel(scheduledId),
    'Не удалось отменить сообщение.',
  ), [run]);

  return {
    enabled, items, busy, error, reload, schedule, update, cancel, clearError: () => setError(''),
  };
}
