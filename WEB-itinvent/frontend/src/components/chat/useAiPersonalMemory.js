import { useCallback, useEffect, useRef, useState } from 'react';

import { chatAPI } from '../../api/client';

const normalizeMemoryPayload = (payload) => ({
  enabled: payload?.enabled !== false,
  items: Array.isArray(payload?.items) ? payload.items : [],
  limits: payload?.limits && typeof payload.limits === 'object' ? payload.limits : {},
});

export default function useAiPersonalMemory({ available = true, conversationId = '' } = {}) {
  const requestSequenceRef = useRef(0);
  const [memory, setMemory] = useState(() => normalizeMemoryPayload(null));
  const [loading, setLoading] = useState(false);
  const [busyKey, setBusyKey] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [noticeSeverity, setNoticeSeverity] = useState('success');

  const load = useCallback(async () => {
    if (!available) {
      setMemory({ enabled: false, items: [], limits: {} });
      setLoading(false);
      setError('');
      return null;
    }
    const requestSequence = requestSequenceRef.current + 1;
    requestSequenceRef.current = requestSequence;
    setLoading(true);
    setError('');
    try {
      const payload = await chatAPI.getAiMemory();
      if (requestSequence !== requestSequenceRef.current) return null;
      const normalized = normalizeMemoryPayload(payload);
      setMemory(normalized);
      return normalized;
    } catch {
      if (requestSequence === requestSequenceRef.current) {
        setError('Не удалось загрузить личную память.');
      }
      return null;
    } finally {
      if (requestSequence === requestSequenceRef.current) setLoading(false);
    }
  }, [available]);

  useEffect(() => {
    void load();
    return () => {
      requestSequenceRef.current += 1;
    };
  }, [load]);

  const updateEnabled = useCallback(async (enabled) => {
    setBusyKey('settings');
    setError('');
    setNotice('');
    try {
      const payload = await chatAPI.updateAiMemorySettings(Boolean(enabled));
      const actualEnabled = payload?.enabled !== false;
      setMemory((current) => ({ ...current, enabled: actualEnabled }));
      if (enabled && !actualEnabled) {
        setNoticeSeverity('info');
        setNotice('Память пока недоступна администратором.');
      } else {
        setNoticeSeverity('success');
        setNotice(actualEnabled ? 'Личная память включена.' : 'Личная память выключена.');
      }
      return payload;
    } catch {
      setError('Не удалось изменить настройки памяти.');
      return null;
    } finally {
      setBusyKey('');
    }
  }, []);

  const updateItem = useCallback(async (memoryId, content) => {
    const normalizedId = String(memoryId || '').trim();
    const normalizedContent = String(content || '').trim();
    if (!normalizedId || !normalizedContent) return null;
    setBusyKey(normalizedId);
    setError('');
    try {
      const payload = await chatAPI.updateAiMemoryItem(normalizedId, normalizedContent);
      const updated = payload?.item || payload;
      setMemory((current) => ({
        ...current,
        items: current.items.map((item) => (
          String(item?.id || '') === normalizedId ? { ...item, ...updated, content: normalizedContent } : item
        )),
      }));
      setNoticeSeverity('success');
      setNotice('Факт памяти обновлён.');
      return updated;
    } catch {
      setError('Не удалось обновить факт памяти.');
      return null;
    } finally {
      setBusyKey('');
    }
  }, []);

  const deleteItem = useCallback(async (memoryId) => {
    const normalizedId = String(memoryId || '').trim();
    if (!normalizedId) return false;
    setBusyKey(normalizedId);
    setError('');
    try {
      await chatAPI.deleteAiMemoryItem(normalizedId);
      setMemory((current) => ({
        ...current,
        items: current.items.filter((item) => String(item?.id || '') !== normalizedId),
      }));
      setNoticeSeverity('success');
      setNotice('Факт удалён из памяти.');
      return true;
    } catch {
      setError('Не удалось удалить факт памяти.');
      return false;
    } finally {
      setBusyKey('');
    }
  }, []);

  const clear = useCallback(async () => {
    setBusyKey('clear');
    setError('');
    try {
      await chatAPI.clearAiMemory();
      setMemory((current) => ({ ...current, items: [] }));
      setNoticeSeverity('success');
      setNotice('Личная память очищена.');
      return true;
    } catch {
      setError('Не удалось очистить личную память.');
      return false;
    } finally {
      setBusyKey('');
    }
  }, []);

  const resetContext = useCallback(async () => {
    const normalizedConversationId = String(conversationId || '').trim();
    if (!normalizedConversationId) return null;
    setBusyKey('reset-context');
    setError('');
    try {
      const payload = await chatAPI.resetAiConversationContext(normalizedConversationId);
      setNoticeSeverity('success');
      setNotice('Контекст сброшен. История сообщений сохранена.');
      return payload;
    } catch {
      setError('Не удалось сбросить контекст диалога.');
      return null;
    } finally {
      setBusyKey('');
    }
  }, [conversationId]);

  return {
    ...memory,
    loading,
    busyKey,
    error,
    notice,
    noticeSeverity,
    load,
    updateEnabled,
    updateItem,
    deleteItem,
    clear,
    resetContext,
    dismissNotice: () => setNotice(''),
  };
}
