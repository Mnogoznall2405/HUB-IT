import { useCallback, useEffect, useRef, useState, type MutableRefObject } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import * as chatApi from '../../api/chatApi';
import type { ChatConversationSummary, ChatConversationPage } from '../../api/types';
import { formatApiError } from '../../api/formatError';
import {
  applyConversationEnvelope,
  clearConversationUnread,
} from '../../chat/chatState';
import { chatSocket, shouldUseChatHttpFallback, type ChatSocketStatus } from '../../chat/chatSocket';
import {
  getActiveNativeChatConversationId,
  subscribeNativeChatConversationRead,
} from '../../chat/chatActiveConversation';
import {
  readNativeChatInboxSnapshot,
  writeNativeChatInboxSnapshot,
} from '../../chat/nativeChatInboxSnapshot';
import { getActiveChatFolderKey } from '../../chat/chatActiveFolder';
import { useChatAppActive } from '../../chat/useChatAppActive';
import { logChatSocketState } from '../../chat/chatDeviceEvents';
import { logChatDevice } from '../../diagnostics/chatDeviceLog';
import { trackWork } from '../../diagnostics/perfProbes';
import { noteInboxCacheReady, noteInboxLiveReady, noteInboxLoadStart } from '../../diagnostics/uiTiming';
import { listNativeChatDraftPreviews } from '../../chat/chatDrafts';
import {
  applyTypingParticipant,
  formatTypingLine,
  parseTypingEnvelope,
  type TypingParticipant,
} from '../../chat/chatTyping';

// The cache write encrypts and verifies the whole inbox on the JS thread; a busy
// chat fires conversation events every second, so batch them into one write.
export const INBOX_SNAPSHOT_DEBOUNCE_MS = 2_500;
export const UNREAD_FOLDERS_RELOAD_DEBOUNCE_MS = 2_500;
// Returning to the list while the socket is live and the list was refreshed moments
// ago needs no new HTTP round trip: realtime events already keep it current.
export const INBOX_FOCUS_REFRESH_MIN_INTERVAL_MS = 20_000;

/** Inbox list data: page loading, socket updates, durable snapshot writes,
 * HTTP fallback and focus refresh. */
export function useInboxData({
  userId,
  offlineMode,
  mountedRef,
  ownerRef,
  setActiveFolderKey,
  loadFolders,
  onConversationRead,
}: {
  userId: number;
  offlineMode: boolean;
  mountedRef: MutableRefObject<boolean>;
  ownerRef: MutableRefObject<number>;
  setActiveFolderKey: (key: string) => void;
  loadFolders: () => Promise<void>;
  onConversationRead?: (conversationId: string) => void;
}) {
  const onConversationReadRef = useRef(onConversationRead);
  onConversationReadRef.current = onConversationRead;
  const [hydratedOwner, setHydratedOwner] = useState<number | null>(null);
  const [snapshotRevision, setSnapshotRevision] = useState(0);
  // F-TYPING-INBOX: conversation_id -> "Имя печатает…" line for the row.
  const [typingByConversation, setTypingByConversation] = useState<Record<string, string>>({});
  // F-DRAFT-INBOX: conversation_id -> one-line draft preview.
  const [draftPreviews, setDraftPreviews] = useState<Map<string, string>>(new Map());
  const typingParticipantsRef = useRef(new Map<string, TypingParticipant[]>());
  const typingTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const removedConversationIdsRef = useRef(new Set<string>());
  const pendingSnapshotRef = useRef<{
    owner: number; page: ChatConversationPage; removedConversationIds: string[];
  } | null>(null);
  const flushInboxSnapshot = useCallback(() => {
    const pending = pendingSnapshotRef.current;
    pendingSnapshotRef.current = null;
    if (!pending || ownerRef.current !== pending.owner) return;
    void writeNativeChatInboxSnapshot(pending.owner, pending.page, {
      removedConversationIds: pending.removedConversationIds,
      isCurrent: () => ownerRef.current === pending.owner,
    }).catch(() => undefined);
  }, [ownerRef]);
  const loadingMoreRef = useRef(false);
  const loadStartingRef = useRef(false);
  const loadScopeRef = useRef<{ owner: number } | null>(null);
  const loadInFlightRef = useRef<Promise<void> | null>(null);
  const loadDirtyRef = useRef(false);
  const lastLiveLoadAtRef = useRef(0);
  const connectedOnceRef = useRef(chatSocket.getStatus() === 'connected');
  const socketStatusRef = useRef<ChatSocketStatus>(chatSocket.getStatus());
  const [items, setItems] = useState<ChatConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState<ChatSocketStatus>(chatSocket.getStatus());
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const remoteSearchItemsRef = useRef<ChatConversationSummary[]>([]);
  const appActive = useChatAppActive();
  // Focus gate for the fallback poll: the inbox stays mounted under freezeOnBlur
  // tabs, and returning to focus already reloads in the focus effect below.
  const [inboxFocused, setInboxFocused] = useState(false);
  useFocusEffect(useCallback(() => {
    setInboxFocused(true);
    return () => setInboxFocused(false);
  }, []));

  const load = useCallback(async (mode: 'initial' | 'refresh' | 'silent' = 'initial') => {
    if (ownerRef.current !== userId) return;
    const startedAt = Date.now();
    if (loadScopeRef.current?.owner !== userId) {
      loadScopeRef.current = { owner: userId };
      loadStartingRef.current = false;
      loadInFlightRef.current = null;
      loadDirtyRef.current = false;
      lastLiveLoadAtRef.current = 0;
      loadingMoreRef.current = false;
      setLoadingMore(false);
      // A pull-refresh interrupted by the owner switch never reaches its
      // isCurrent-gated reset — clear the spinner here or it spins forever.
      setRefreshing(false);
      setItems([]);
      setHydratedOwner(null);
      setHasMore(false);
      setNextCursor(null);
      setError('');
    }
    const scope = loadScopeRef.current;
    const isCurrent = () => mountedRef.current && ownerRef.current === userId && loadScopeRef.current === scope;
    if (loadStartingRef.current && !loadInFlightRef.current) return;
    if (loadInFlightRef.current) {
      // A deduplicated call means state changed while the page was in flight —
      // mark dirty so the runner re-fetches instead of dropping the reload.
      loadDirtyRef.current = true;
      if (mode === 'refresh') setRefreshing(true);
      await loadInFlightRef.current;
      if (mode === 'refresh' && isCurrent()) setRefreshing(false);
      return;
    }
    loadStartingRef.current = true;
    if (mode === 'initial') { setLoading(true); noteInboxLoadStart(); }
    if (mode === 'refresh') setRefreshing(true);
    let cached = false;
    if (mode === 'initial' && userId) {
      const snapshot = await readNativeChatInboxSnapshot(userId);
      if (!isCurrent()) return;
      if (snapshot) {
        cached = true;
        setItems(snapshot.data.items);
        setHasMore(snapshot.data.has_more);
        setNextCursor(snapshot.data.next_cursor);
        setHydratedOwner(userId);
        setLoading(false);
        noteInboxCacheReady();
      }
    }
    if (offlineMode) {
      if (isCurrent()) {
        if (!cached && mode !== 'silent') {
          setError('Нет подключения и сохранённых диалогов.');
        }
        if (mode === 'initial') { setLoading(false); noteInboxLiveReady(); }
        if (mode === 'refresh') setRefreshing(false);
      }
      loadStartingRef.current = false;
      return;
    }
    do {
      loadDirtyRef.current = false;
      const request = chatApi.getConversationPage({ limit: 50 });
      loadInFlightRef.current = request.then(() => undefined, () => undefined);
      try {
        const page = await request;
        if (!isCurrent()) return;
        page.items.forEach((item) => removedConversationIdsRef.current.delete(item.id));
        if (mode === 'silent') {
          const pageIds = new Set(page.items.map((item) => item.id));
          if (!page.has_more) {
            // CHAT-INBOX-07: an unpaginated first page is the complete server
            // list — rows absent from it were deleted elsewhere while the
            // conversation.removed event was missed and must not linger.
            const stale = new Set(
              itemsRef.current.map((item) => item.id).filter((id) => !pageIds.has(id)),
            );
            if (stale.size) {
              stale.forEach((id) => removedConversationIdsRef.current.add(id));
              remoteSearchItemsRef.current = remoteSearchItemsRef.current.filter((item) => !stale.has(item.id));
            }
          }
          setItems((current) => {
            const byId = new Map(current.map((item) => [item.id, item]));
            page.items.forEach((item) => byId.set(item.id, { ...byId.get(item.id), ...item }));
            const merged = [...byId.values()];
            return page.has_more ? merged : merged.filter((item) => pageIds.has(item.id));
          });
        } else {
          setItems(page.items);
        }
        setHasMore(page.has_more);
        setNextCursor(page.next_cursor);
        setHydratedOwner(userId);
        setError('');
        lastLiveLoadAtRef.current = Date.now();
        if (mode === 'initial') logChatDevice('inbox_open', { ms: Date.now() - startedAt, count: page.items.length });
        if (userId) void writeNativeChatInboxSnapshot(userId, page);
      } catch (cause) {
        if (isCurrent() && mode !== 'silent') {
          setError(cached
            ? 'Нет подключения. Показаны сохранённые диалоги.'
            : formatApiError(cause, 'Не удалось загрузить диалоги'));
        }
      }
    } while (isCurrent() && loadDirtyRef.current);
    if (isCurrent()) {
      loadStartingRef.current = false;
      loadInFlightRef.current = null;
      if (mode === 'initial') { setLoading(false); noteInboxLiveReady(); }
      if (mode === 'refresh') setRefreshing(false);
    }
  }, [itemsRef, mountedRef, offlineMode, ownerRef, userId]);

  const loadMore = useCallback(async () => {
    if (offlineMode || !hasMore || !nextCursor || loadingMoreRef.current) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const page = await chatApi.getConversationPage({ cursor: nextCursor, limit: 50 });
      if (!mountedRef.current || ownerRef.current !== userId) return;
      page.items.forEach((item) => removedConversationIdsRef.current.delete(item.id));
      setItems((current) => {
        const byId = new Map(current.map((item) => [item.id, item]));
        page.items.forEach((item) => byId.set(item.id, { ...byId.get(item.id), ...item }));
        const merged = [...byId.values()];
        if (userId) {
          void writeNativeChatInboxSnapshot(userId, {
            items: merged,
            has_more: page.has_more,
            next_cursor: page.next_cursor,
          });
        }
        return merged;
      });
      setHasMore(page.has_more);
      setNextCursor(page.next_cursor);
    } catch (cause) {
      if (mountedRef.current && ownerRef.current === userId) setError(formatApiError(cause, 'Не удалось загрузить следующие диалоги'));
    } finally {
      if (ownerRef.current === userId) {
        loadingMoreRef.current = false;
        if (mountedRef.current) setLoadingMore(false);
      }
    }
  }, [hasMore, mountedRef, nextCursor, offlineMode, ownerRef, userId]);

  useEffect(() => {
    let active = true;
    mountedRef.current = true;
    void load();
    void loadFolders();
    if (userId) {
      void getActiveChatFolderKey(userId).then((folderKey) => {
        if (active && mountedRef.current && ownerRef.current === userId) setActiveFolderKey(folderKey);
      }).catch(() => undefined);
    }
    chatSocket.subscribeInbox();
    void chatSocket.connect();

    const offStatus = chatSocket.on('status', (next) => {
      const nextStatus = next as ChatSocketStatus;
      logChatSocketState(nextStatus);
      const enteredConnected = nextStatus === 'connected' && socketStatusRef.current !== 'connected';
      socketStatusRef.current = nextStatus;
      setStatus(nextStatus);
      if (nextStatus !== 'connected') return;
      // CHAT-INBOX-02: AppLifecycle drops the socket with clearSubscriptions
      // (wantInbox=false) when /chat loses focus while this screen stays
      // mounted under Tabs freezeOnBlur, so a later reconnect never re-arms
      // the inbox subscription. subscribeInbox() is idempotent — it only sets
      // wantInbox and sends the subscribe frame when the socket is open — so
      // repeat it on every transition into 'connected'.
      if (enteredConnected) chatSocket.subscribeInbox();
      if (connectedOnceRef.current) {
        void load('silent');
        void loadFolders();
      } else {
        connectedOnceRef.current = true;
      }
    });
    const applyEnvelope = (envelope: unknown) => {
      if (ownerRef.current !== userId) return;
      const remoteIds = new Set(remoteSearchItemsRef.current.map((item) => item.id));
      if (remoteIds.size) {
        remoteSearchItemsRef.current = applyConversationEnvelope(
          remoteSearchItemsRef.current, envelope, userId, getActiveNativeChatConversationId(),
        ).items.filter((item) => remoteIds.has(item.id));
      }
      const payload = (envelope as { payload?: { conversation?: { id?: string }; item?: { id?: string } } })?.payload;
      const restoredId = String(payload?.conversation?.id || payload?.item?.id || '').trim();
      if (restoredId) removedConversationIdsRef.current.delete(restoredId);
      setItems((current) => {
        const done = trackWork('inbox-apply');
        try {
          return applyConversationEnvelope(current, envelope, userId, getActiveNativeChatConversationId()).items;
        } finally {
          done();
        }
      });
      setSnapshotRevision((revision) => revision + 1);
    };
    const offUpdated = chatSocket.on('chat.conversation.updated', applyEnvelope);
    const offMessage = chatSocket.on('chat.message.created', applyEnvelope);
    const offEdited = chatSocket.on('chat.message.updated', applyEnvelope);
    const offDeleted = chatSocket.on('chat.message.deleted', applyEnvelope);
    const offRemoved = chatSocket.on('chat.conversation.removed', (envelope: unknown) => {
      const conversationId = String(
        (envelope as { payload?: { conversation_id?: string } })?.payload?.conversation_id || '',
      ).trim();
      if (conversationId && ownerRef.current === userId) {
        removedConversationIdsRef.current.add(conversationId);
        remoteSearchItemsRef.current = remoteSearchItemsRef.current.filter((item) => item.id !== conversationId);
        setItems((current) => current.filter((item) => item.id !== conversationId));
        setSnapshotRevision((revision) => revision + 1);
      }
    });
    // M2: global unread totals arrive on chat.unread.summary. The payload only
    // carries totals — per-folder badges live in /chat/folders — so debounce a
    // folder reload like the web client (~800 ms) instead of clearing counts.
    let unreadSummaryTimer: ReturnType<typeof setTimeout> | null = null;
    const offUnreadSummary = chatSocket.on('chat.unread.summary', () => {
      if (ownerRef.current !== userId) return;
      if (unreadSummaryTimer) return;
      unreadSummaryTimer = setTimeout(() => {
        unreadSummaryTimer = null;
        if (ownerRef.current === userId) void loadFolders();
      }, UNREAD_FOLDERS_RELOAD_DEBOUNCE_MS);
    });
    const offConversationRead = subscribeNativeChatConversationRead((conversationId) => {
      if (ownerRef.current !== userId) return;
      remoteSearchItemsRef.current = clearConversationUnread(remoteSearchItemsRef.current, conversationId);
      setItems((current) => clearConversationUnread(current, conversationId));
      setSnapshotRevision((revision) => revision + 1);
      onConversationReadRef.current?.(conversationId);
    });
    const onTyping = (envelope: unknown) => {
      if (ownerRef.current !== userId) return;
      const parsed = parseTypingEnvelope(envelope);
      if (!parsed || parsed.userId === userId) return;
      const participants = typingParticipantsRef.current.get(parsed.conversationId) || [];
      typingParticipantsRef.current.set(
        parsed.conversationId,
        applyTypingParticipant(participants, { userId: parsed.userId, name: parsed.name }, parsed.isTyping),
      );
      const timerKey = `${parsed.conversationId}:${parsed.userId}`;
      const existingTimer = typingTimersRef.current.get(timerKey);
      if (existingTimer) clearTimeout(existingTimer);
      typingTimersRef.current.delete(timerKey);
      if (parsed.isTyping) {
        typingTimersRef.current.set(timerKey, setTimeout(() => {
          typingTimersRef.current.delete(timerKey);
          const current = typingParticipantsRef.current.get(parsed.conversationId) || [];
          typingParticipantsRef.current.set(
            parsed.conversationId,
            applyTypingParticipant(current, { userId: parsed.userId, name: parsed.name }, false),
          );
          setTypingByConversation((prev) => {
            const line = formatTypingLine(typingParticipantsRef.current.get(parsed.conversationId) || []);
            if (!line === !prev[parsed.conversationId] || prev[parsed.conversationId] === line) return prev;
            return { ...prev, [parsed.conversationId]: line };
          });
        }, parsed.expiresInMs + 1_000));
      }
      setTypingByConversation((prev) => {
        const line = formatTypingLine(typingParticipantsRef.current.get(parsed.conversationId) || []);
        if ((prev[parsed.conversationId] || '') === line) return prev;
        return { ...prev, [parsed.conversationId]: line };
      });
    };
    const offTypingStarted = chatSocket.on('chat.typing.started', onTyping);
    const offTypingStopped = chatSocket.on('chat.typing.stopped', onTyping);

    return () => {
      active = false;
      mountedRef.current = false;
      offStatus();
      offUpdated();
      offMessage();
      offEdited();
      offDeleted();
      offRemoved();
      offUnreadSummary();
      if (unreadSummaryTimer) clearTimeout(unreadSummaryTimer);
      offConversationRead();
      offTypingStarted();
      offTypingStopped();
      typingTimersRef.current.forEach((timer) => clearTimeout(timer));
      typingTimersRef.current.clear();
      typingParticipantsRef.current.clear();
    };
  }, [load, loadFolders, ownerRef, userId]);

  // S11: the 20s fallback poll runs only while the socket needs it, the inbox
  // is focused and the app is in the foreground. Connected sockets, background
  // and blurred tabs never poll; the reconnect gap fetch lives in the status
  // handler above and is unaffected.
  const fallbackPollActive = inboxFocused && appActive && shouldUseChatHttpFallback(status);
  useEffect(() => {
    if (!fallbackPollActive) return undefined;
    void load('silent');
    void loadFolders();
    const timer = setInterval(() => {
      void load('silent');
      void loadFolders();
    }, 20_000);
    return () => clearInterval(timer);
  }, [fallbackPollActive, load, loadFolders, status]);

  const refreshDrafts = useCallback(async () => {
    if (ownerRef.current !== userId || userId <= 0) return;
    const previews = await listNativeChatDraftPreviews(userId).catch(() => new Map<string, string>());
    if (ownerRef.current !== userId || !mountedRef.current) return;
    setDraftPreviews(previews);
  }, [mountedRef, ownerRef, userId]);

  useFocusEffect(useCallback(() => {
    const fresh = socketStatusRef.current === 'connected'
      && Date.now() - lastLiveLoadAtRef.current < INBOX_FOCUS_REFRESH_MIN_INTERVAL_MS;
    if (!fresh) {
      void load('silent');
      void loadFolders();
    }
    void refreshDrafts();
  }, [load, loadFolders, refreshDrafts]));

  useEffect(() => {
    if (!snapshotRevision || hydratedOwner !== userId || userId <= 0) return;
    pendingSnapshotRef.current = {
      owner: userId,
      page: { items, has_more: hasMore, next_cursor: nextCursor },
      removedConversationIds: [...removedConversationIdsRef.current],
    };
    const timer = setTimeout(flushInboxSnapshot, INBOX_SNAPSHOT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [snapshotRevision, hydratedOwner, userId, items, hasMore, nextCursor, flushInboxSnapshot]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') flushInboxSnapshot();
    });
    return () => {
      subscription.remove();
      flushInboxSnapshot();
    };
  }, [flushInboxSnapshot]);

  useEffect(() => {
    removedConversationIdsRef.current.clear();
    setTypingByConversation({});
    setDraftPreviews(new Map());
    void refreshDrafts();
  }, [refreshDrafts, userId]);

  return {
    items,
    setItems,
    itemsRef,
    loading,
    refreshing,
    loadingMore,
    hasMore,
    error,
    setError,
    status,
    load,
    loadMore,
    remoteSearchItemsRef,
    typingByConversation,
    draftPreviews,
  };
}
