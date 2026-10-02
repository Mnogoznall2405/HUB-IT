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

  useEffect(() => {
    let alive = true;
    if (!available) {
      setEnabled(false);
      return undefined;
    }
    getChatConfigCached()
      .then((config) => { if (alive) setEnabled(Boolean(config?.scheduled_messages_enabled)); })
      .catch(() => { if (alive) setEnabled(false); });
    return () => { alive = false; };
  }, [available]);

  const reload = useCallback(async () => {
    const id = String(conversationId || '').trim();
    if (!enabled || !id) {
      setItems([]);
      return [];
    }
    const sequence = sequenceRef.current + 1;
    sequenceRef.current = sequence;
    try {
      const next = await chatScheduledAPI.list(id);
      if (sequence === sequenceRef.current) setItems(next);
      return next;
    } catch {
      if (sequence === sequenceRef.current) setItems([]);
      return [];
    }
  }, [conversationId, enabled]);

  useEffect(() => {
    setItems([]);
    setError('');
    void reload();
    return () => { sequenceRef.current += 1; };
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
    setBusy(true);
    setError('');
    try {
      const result = await action();
      await reload();
      return result;
    } catch (caught) {
      const detail = caught?.response?.data?.detail;
      setError(typeof detail === 'string' && detail ? detail : fallback);
      return null;
    } finally {
      setBusy(false);
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
