import { useCallback, useEffect, useRef, useState } from 'react';
import chatThreadMessagesAPI from '../../api/chatThreadMessages';

export default function useChatPanelHistory(conversationId, enabled, messages) {
  const [state, setState] = useState({ id: '', items: [], hasMore: false, loading: false, error: '' });
  const request = useRef(0);
  const busy = useRef(false);
  const cursor = useRef(undefined);
  const load = useCallback(async (append = false) => {
    if (!conversationId || busy.current) return;
    busy.current = true;
    const seq = ++request.current;
    setState((current) => ({ ...current, id: conversationId, loading: true, error: '' }));
    try {
      const payload = await chatThreadMessagesAPI.getMessages(conversationId, { limit: 100, before_message_id: append ? cursor.current : undefined });
      if (seq !== request.current) return;
      const items = Array.isArray(payload?.items) ? payload.items : [];
      const next = items[0]?.id;
      const hasMore = Boolean(payload?.has_more && next && next !== cursor.current);
      cursor.current = next;
      setState((current) => ({ id: conversationId, items: append ? [...items, ...current.items] : items, hasMore, loading: false, error: '' }));
    } catch (error) {
      if (seq === request.current) setState((current) => ({ ...current, loading: false, error: error?.message || 'Не удалось загрузить историю чата.' }));
    } finally { if (seq === request.current) busy.current = false; }
  }, [conversationId]);
  useEffect(() => {
    cursor.current = undefined;
    busy.current = false;
    setState({ id: conversationId, items: [], hasMore: false, loading: false, error: '' });
    if (enabled) void load();
    return () => { request.current += 1; busy.current = false; };
  }, [conversationId, enabled, load]);
  const unique = new Map();
  (state.id === conversationId ? state.items : []).forEach((item) => unique.set(item.id, item));
  (messages || []).forEach((item) => unique.set(item.id, item));
  return { ...state, items: [...unique.values()].filter((item) => !item.is_deleted), loadMore: () => load(true), retry: () => load(Boolean(cursor.current)) };
}
