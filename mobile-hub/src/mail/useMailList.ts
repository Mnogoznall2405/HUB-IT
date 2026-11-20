import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getMailConversations,
  getMailFolderSummary,
  getMailFolderTree,
  getMailMessages,
  type MailConversationPreview,
  type MailFolderNode,
  type MailFolderSummary,
  type MailMessagePreview,
} from '../api/mailApi';
import {
  DEFAULT_NATIVE_MAIL_PREFERENCES,
  getNativeMailPreferences,
  type NativeMailPreferences,
} from '../api/mailConfigApi';
import { formatApiError } from '../api/formatError';
import { listMailboxes, type MailMailbox } from '../api/mailMailboxesApi';
import { nativeCollectionSignature, readNativeCollectionSnapshot, writeNativeCollectionSnapshot } from '../cache/nativeSnapshotCache';
import { hubRealtimeSocket } from '../realtime/hubRealtimeSocket';
import { applyPendingMailReadOverrides } from './nativeMailReadOverrides';
import { parseNativeMailSearchQuery } from './nativeMailModel';
import {
  applyPendingUnreadToFolderTree,
  applyPendingUnreadToMailboxes,
  applyPendingUnreadToSummary,
  stageNativeMailUnreadDelta,
} from './nativeMailUnreadPending';
import { publishNativeMailUnreadDelta, subscribeNativeMailUnread } from './nativeMailUnreadEvents';

export const MAIL_PAGE_SIZE = 50;
export const MAIL_METADATA_TTL_MS = 60_000;
// Folder membership changes often (moves, new mail) — 60 s is too stale.
export const MAIL_FOLDER_TREE_TTL_MS = 15_000;
export const MAIL_FOCUS_RELOAD_GUARD_MS = 250;

export type NativeMailAdvancedFilters = {
  dateFrom: string;
  dateTo: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  importance: '' | 'low' | 'normal' | 'high';
  folderScope: 'current' | 'all';
};

export type MailListItem =
  | { kind: 'message'; key: string; value: MailMessagePreview }
  | { kind: 'conversation'; key: string; value: MailConversationPreview };

export type NativeMailInboxSnapshot = {
  signature: string;
  items: MailListItem[];
  total: number;
  hasMore: boolean;
  nextOffset?: number;
  summary: MailFolderSummary;
  folderTree: MailFolderNode[];
  mailboxes: MailMailbox[];
  preferences: NativeMailPreferences;
};

export type MailViewMode = 'messages' | 'conversations';

export function useMailList(options: {
  allowed: boolean;
  offlineMode: boolean;
  userId?: number;
  mailboxId: string;
  folder: string;
  view: MailViewMode;
  debouncedQuery: string;
  unreadOnly: boolean;
  hasAttachments: boolean;
  advancedFilters: NativeMailAdvancedFilters;
  onScopeReset?: () => void;
}) {
  const {
    allowed,
    offlineMode,
    userId,
    mailboxId,
    folder,
    view,
    debouncedQuery,
    unreadOnly,
    hasAttachments,
    advancedFilters,
    onScopeReset,
  } = options;
  const [items, setItems] = useState<MailListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [summary, setSummary] = useState<MailFolderSummary>({});
  const [folderTree, setFolderTree] = useState<MailFolderNode[]>([]);
  const [mailboxes, setMailboxes] = useState<MailMailbox[]>([]);
  const [mailViewPreferences, setMailViewPreferences] = useState<NativeMailPreferences>(DEFAULT_NATIVE_MAIL_PREFERENCES);
  const requestRef = useRef(0);
  const unreadSourceRef = useRef<symbol>(Symbol('mail-list'));
  const lastFocusLoadRef = useRef<{ key: string; pending: boolean; finishedAt: number } | null>(null);
  const loadedScopeRef = useRef('');
  // Server-authoritative page cursor: next_offset reflects the backend's own
  // scan position; items.length breaks when page sizes differ between
  // requests (search windows) or dedupe dropped a row.
  const nextOffsetRef = useRef(0);
  const metadataFreshRef = useRef({ scope: '', savedAt: 0 });
  const folderTreeFreshRef = useRef({ scope: '', savedAt: 0 });
  const onScopeResetRef = useRef(onScopeReset);
  onScopeResetRef.current = onScopeReset;
  const listScope = JSON.stringify([userId, mailboxId, folder, debouncedQuery, unreadOnly, hasAttachments, advancedFilters, view]);
  const listScopeRef = useRef(listScope);
  const listGenerationRef = useRef(0);
  if (listScopeRef.current !== listScope) listGenerationRef.current += 1;
  listScopeRef.current = listScope;
  const listGeneration = listGenerationRef.current;
  useEffect(() => () => { listGenerationRef.current += 1; }, []);

  const load = useCallback(async ({ reset, refresh = false, silent = false }: { reset: boolean; refresh?: boolean; silent?: boolean }) => {
    const requestId = ++requestRef.current;
    if (!silent) {
      if (refresh) setRefreshing(true);
      else if (reset) setLoading(true);
      else setLoadingMore(true);
    }
    setError('');
    // A reset also clears the server cursor: a stale next_offset from the
    // previous scope would skip the head of the new list on the next page.
    if (reset) nextOffsetRef.current = 0;
    const offset = nextOffsetRef.current;
    const parsedQuery = parseNativeMailSearchQuery(debouncedQuery);
    const filters = {
      mailboxId,
      folder,
      folderScope: advancedFilters.folderScope,
      q: parsedQuery.q,
      unreadOnly,
      hasAttachments: hasAttachments || parsedQuery.hasAttachments,
      dateFrom: advancedFilters.dateFrom,
      dateTo: advancedFilters.dateTo,
      from: advancedFilters.from || parsedQuery.from,
      to: advancedFilters.to || parsedQuery.to,
      subject: advancedFilters.subject || parsedQuery.subject,
      body: advancedFilters.body,
      importance: advancedFilters.importance,
      limit: MAIL_PAGE_SIZE,
      offset,
    };
    const signature = nativeCollectionSignature({ ...filters, view });
    const owner = Number(userId || 0);
    const dataScope = `${owner}:${signature}`;
    let cached = loadedScopeRef.current === dataScope;
    if (reset && !cached) {
      // The scope changed: drop the selection whether a snapshot fills the
      // list or it stays empty — bulk actions must never hit hidden messages.
      onScopeResetRef.current?.();
      let snapshotHit = false;
      if (owner) {
        const snapshot = await readNativeCollectionSnapshot<NativeMailInboxSnapshot>(
          'mail-inbox',
          owner,
          signature,
        );
        if (requestId !== requestRef.current) return;
        if (snapshot?.data.signature === signature) {
          snapshotHit = true;
          cached = true;
          loadedScopeRef.current = dataScope;
          nextOffsetRef.current = Number(snapshot.data.nextOffset ?? snapshot.data.items.length);
          setItems(snapshot.data.items.map((item) => item.kind === 'message'
            ? { ...item, value: applyPendingMailReadOverrides([item.value], mailboxId)[0] }
            : item));
          setTotal(snapshot.data.total);
          setHasMore(snapshot.data.hasMore);
          setSummary(applyPendingUnreadToSummary(mailboxId, snapshot.data.summary));
          setFolderTree(applyPendingUnreadToFolderTree(mailboxId, snapshot.data.folderTree));
          setMailboxes(applyPendingUnreadToMailboxes(snapshot.data.mailboxes));
          setMailViewPreferences(snapshot.data.preferences);
          setLoading(false);
        }
      }
      if (!snapshotHit) {
        loadedScopeRef.current = '';
        setItems([]);
        setTotal(0);
        setHasMore(false);
      }
    }
    if (offlineMode) {
      if (requestId === requestRef.current) {
        if (!cached) setError('Нет подключения и сохранённой почты.');
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
      return;
    }
    try {
      const warnings: string[] = [];
      const optional = async <T,>(request: Promise<T>, label: string): Promise<T | null> => {
        try { return await request; }
        catch { warnings.push(label); return null; }
      };
      const metadataScope = `${owner}:${mailboxId}`;
      const metadataAge = Date.now() - metadataFreshRef.current.savedAt;
      const folderTreeAge = Date.now() - folderTreeFreshRef.current.savedAt;
      const reloadMetadata = reset && (refresh || metadataFreshRef.current.scope !== metadataScope
        || metadataAge >= MAIL_METADATA_TTL_MS);
      const reloadFolderTree = reset && (refresh || folderTreeFreshRef.current.scope !== metadataScope
        || folderTreeAge >= MAIL_FOLDER_TREE_TTL_MS);
      const metadata = Promise.all([
        reset ? optional(getMailFolderSummary(mailboxId), 'Не обновлены счётчики папок.') : Promise.resolve(null),
        reloadFolderTree ? optional(getMailFolderTree(mailboxId), 'Не обновлён список папок.') : Promise.resolve(null),
        reset && mailboxes.length === 0 ? optional(listMailboxes(true), 'Не обновлён список почтовых ящиков.') : Promise.resolve(null),
        reloadMetadata ? optional(getNativeMailPreferences(), 'Не обновлены настройки отображения.') : Promise.resolve(null),
      ]);
      const pageResult = await (view === 'conversations' ? getMailConversations(filters) : getMailMessages(filters));
      if (requestId !== requestRef.current) return;
      const nextItems: MailListItem[] = view === 'conversations'
        ? (pageResult.items as MailConversationPreview[]).map((value) => ({ kind: 'conversation' as const, key: `c:${value.conversation_id}`, value }))
        : applyPendingMailReadOverrides(pageResult.items as MailMessagePreview[], mailboxId)
          .map((value) => ({ kind: 'message' as const, key: `m:${value.id}`, value }));
      const cachedItems = reset
        ? nextItems
        : [...items, ...nextItems.filter((item) => !items.some((old) => old.key === item.key))];
      nextOffsetRef.current = Number(pageResult.next_offset ?? offset + nextItems.length);
      loadedScopeRef.current = dataScope;
      setItems(cachedItems);
      setTotal(pageResult.total);
      setHasMore(pageResult.has_more);
      setLoading(false);
      setRefreshing(false);
      setLoadingMore(false);
      const [summaryResult, folderTreeResult, mailboxesResult, viewPreferencesResult] = await metadata;
      if (requestId !== requestRef.current) return;
      // Each metadata source keeps its own TTL: a successful tree response
      // refreshes only the tree ref, preferences only the preferences ref.
      if (folderTreeResult) folderTreeFreshRef.current = { scope: metadataScope, savedAt: Date.now() };
      if (viewPreferencesResult) metadataFreshRef.current = { scope: metadataScope, savedAt: Date.now() };
      const nextSummary = summaryResult
        ? applyPendingUnreadToSummary(mailboxId, summaryResult)
        : summary;
      const nextFolderTree = folderTreeResult
        ? applyPendingUnreadToFolderTree(mailboxId, folderTreeResult.items)
        : folderTree;
      if (summaryResult) {
        setSummary(nextSummary);
        if (mailboxId) {
          const inboxUnread = Math.max(0, Number(nextSummary.inbox?.unread || 0));
          setMailboxes((current) => current.map((mailbox) => String(mailbox.id) === mailboxId
            ? { ...mailbox, unread_count: inboxUnread }
            : mailbox));
        }
      }
      if (folderTreeResult) setFolderTree(nextFolderTree);
      if (viewPreferencesResult) setMailViewPreferences(viewPreferencesResult);
      const nextMailboxes = mailboxesResult
        ? applyPendingUnreadToMailboxes(mailboxesResult.filter((item) => item.is_active !== false))
        : mailboxes;
      if (mailboxesResult) {
        setMailboxes(nextMailboxes);
      }
      if (pageResult.search_limited) warnings.push('Поиск выполнен по ограниченному окну писем. Уточните запрос.');
      if (Number(pageResult.skipped_folders || 0) > 0) warnings.push('Часть папок недоступна — результаты могут быть неполными.');
      setError(warnings.join(' '));
      if (owner) {
        void writeNativeCollectionSnapshot<NativeMailInboxSnapshot>('mail-inbox', owner, signature, {
          signature,
          items: cachedItems,
          total: pageResult.total,
          hasMore: pageResult.has_more,
          nextOffset: nextOffsetRef.current,
          summary: nextSummary,
          folderTree: nextFolderTree,
          mailboxes: nextMailboxes,
          preferences: viewPreferencesResult || mailViewPreferences,
        });
      }
    } catch (cause) {
      if (requestId !== requestRef.current) return;
      setError(cached
        ? 'Нет подключения. Показана сохранённая почта.'
        : formatApiError(cause, 'Не удалось загрузить почту.'));
      if (reset && !cached && items.length === 0) setItems([]);
    } finally {
      if (requestId === requestRef.current) {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    }
  }, [advancedFilters, debouncedQuery, folder, folderTree, hasAttachments, items.length, mailboxId, mailViewPreferences, mailboxes, offlineMode, summary, unreadOnly, userId, view]);

  // Only real navigation focus (or a user/mailbox switch) invalidates the
  // metadata TTLs — a search typing change must not refetch tree/preferences.
  useFocusEffect(useCallback(() => {
    metadataFreshRef.current = { scope: '', savedAt: 0 };
    folderTreeFreshRef.current = { scope: '', savedAt: 0 };
    return undefined;
  }, [userId, mailboxId]));

  useFocusEffect(useCallback(() => {
    if (!allowed) return undefined;
    const key = JSON.stringify({ advancedFilters, debouncedQuery, folder, hasAttachments, mailboxId, unreadOnly, view, offlineMode, userId });
    const previous = lastFocusLoadRef.current;
    if (previous?.key === key && (previous.pending || Date.now() - previous.finishedAt < MAIL_FOCUS_RELOAD_GUARD_MS)) return undefined;
    const state = { key, pending: true, finishedAt: 0 };
    lastFocusLoadRef.current = state;
    void load({ reset: true }).finally(() => {
      state.pending = false;
      state.finishedAt = Date.now();
    });
    return () => { requestRef.current += 1; lastFocusLoadRef.current = null; };
  }, [advancedFilters, allowed, debouncedQuery, folder, hasAttachments, mailboxId, unreadOnly, view, offlineMode, userId])); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!allowed || offlineMode) return undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void load({ reset: true, silent: true });
      }, 100);
    };
    const releases = [
      hubRealtimeSocket.onMailChanged(refresh),
      hubRealtimeSocket.on('hub.realtime.connected', refresh),
    ];
    return () => {
      if (timer) clearTimeout(timer);
      releases.forEach((release) => release());
    };
  }, [allowed, load, offlineMode]);

  // summary/folderTree show counters of THIS mailbox only: a delta belonging
  // to another mailbox (e.g. marked read on a different account's screen)
  // must not skew them. The mailboxes list self-filters by id regardless.
  const isCurrentMailboxScope = useCallback((scopedMailboxId: string) => (
    !scopedMailboxId || !mailboxId || String(mailboxId) === String(scopedMailboxId)
  ), [mailboxId]);

  const applyUnreadDeltaLocal = useCallback((delta: number, targetFolder: string, scopedMailboxId: string) => {
    if (!delta) return;
    if (isCurrentMailboxScope(scopedMailboxId)) {
      setSummary((current) => ({
        ...current,
        [targetFolder]: {
          ...(current[targetFolder] || {}),
          unread: Math.max(0, Number(current[targetFolder]?.unread || 0) + delta),
        },
      }));
      setFolderTree((current) => adjustMailFolderTreeUnread(current, targetFolder, delta));
    }
    if (targetFolder === 'inbox') {
      setMailboxes((current) => current.map((mailbox) => String(mailbox.id) === scopedMailboxId
        ? { ...mailbox, unread_count: Math.max(0, Number(mailbox.unread_count || 0) + delta) }
        : mailbox));
    }
  }, [isCurrentMailboxScope]);

  const applyUnreadAbsoluteLocal = useCallback((targetFolder: string, scopedMailboxId: string, value: number) => {
    const unread = Math.max(0, Math.trunc(Number(value)) || 0);
    if (isCurrentMailboxScope(scopedMailboxId)) {
      setSummary((current) => ({
        ...current,
        [targetFolder]: { ...(current[targetFolder] || {}), unread },
      }));
      setFolderTree((current) => setMailFolderTreeUnread(current, targetFolder, unread));
    }
    if (targetFolder === 'inbox') {
      setMailboxes((current) => current.map((mailbox) => (!scopedMailboxId || String(mailbox.id) === scopedMailboxId)
        ? { ...mailbox, unread_count: unread }
        : mailbox));
    }
  }, [isCurrentMailboxScope]);

  const applyUnreadDelta = useCallback((delta: number, scopedMailboxId: string, targetFolder?: string) => {
    if (!delta) return;
    const effectiveFolder = targetFolder || folder;
    applyUnreadDeltaLocal(delta, effectiveFolder, scopedMailboxId);
    if (effectiveFolder === 'inbox') {
      publishNativeMailUnreadDelta(delta, { mailboxId: scopedMailboxId, folder: effectiveFolder }, unreadSourceRef.current);
    } else {
      stageNativeMailUnreadDelta(scopedMailboxId, effectiveFolder, delta);
    }
  }, [applyUnreadDeltaLocal, folder]);

  useEffect(() => {
    if (!allowed) return undefined;
    // Дельты непрочитанных от других экранов (читатель, переписка, центр
    // уведомлений): применяем к счётчикам списка сразу, а не после перезагрузки.
    return subscribeNativeMailUnread((change, source) => {
      if (source === unreadSourceRef.current) return;
      const targetFolder = String(change.folder || 'inbox');
      const targetMailbox = change.mailboxId
        ? String(change.mailboxId)
        : (change.kind === 'absolute' ? '' : String(mailboxId || ''));
      if (change.kind === 'absolute') applyUnreadAbsoluteLocal(targetFolder, targetMailbox, change.value);
      else applyUnreadDeltaLocal(change.value, targetFolder, targetMailbox);
    });
  }, [allowed, applyUnreadAbsoluteLocal, applyUnreadDeltaLocal, mailboxId]);

  return {
    items,
    setItems,
    total,
    setTotal,
    hasMore,
    loading,
    refreshing,
    loadingMore,
    error,
    setError,
    summary,
    setSummary,
    folderTree,
    setFolderTree,
    mailboxes,
    setMailboxes,
    mailViewPreferences,
    setMailViewPreferences,
    load,
    listScope,
    listScopeRef,
    listGeneration,
    listGenerationRef,
    applyUnreadDelta,
  };
}

function adjustMailFolderTreeUnread(nodes: MailFolderNode[], folderId: string, delta: number): MailFolderNode[] {
  return mapMailFolderTreeUnread(nodes, folderId, (unread) => Math.max(0, unread + delta));
}

function setMailFolderTreeUnread(nodes: MailFolderNode[], folderId: string, value: number): MailFolderNode[] {
  return mapMailFolderTreeUnread(nodes, folderId, () => Math.max(0, value));
}

function mapMailFolderTreeUnread(nodes: MailFolderNode[], folderId: string, update: (unread: number) => number): MailFolderNode[] {
  return nodes.map((node) => {
    const nodeId = String(node.id || node.folder_id || node.key || '').trim();
    const wellKnownKey = String(node.well_known_key || '').trim();
    const children = Array.isArray(node.children)
      ? mapMailFolderTreeUnread(node.children, folderId, update)
      : node.children;
    const matches = nodeId === folderId || wellKnownKey === folderId;
    if (!matches && children === node.children) return node;
    return {
      ...node,
      ...(matches ? { unread: update(Math.max(0, Number(node.unread || 0))) } : {}),
      ...(children !== node.children ? { children } : {}),
    };
  });
}


