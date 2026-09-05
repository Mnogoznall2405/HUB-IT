import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  bulkMailMessageAction,
  deleteMailMessage,
  getMailConversations,
  getMailFolderSummary,
  getMailFolderTree,
  getMailMessages,
  markAllMailMessagesRead,
  markMailMessageRead,
  markMailMessageUnread,
  restoreMailMessage,
  type MailConversationPreview,
  type MailFolderNode,
  type MailFolderSummary,
  type MailMessagePreview,
} from '../../api/mailApi';
import { listMailboxes, type MailMailbox } from '../../api/mailMailboxesApi';
import {
  DEFAULT_NATIVE_MAIL_PREFERENCES,
  getNativeMailPreferences,
  type NativeMailPreferences,
} from '../../api/mailConfigApi';
import { formatApiError } from '../../api/formatError';
import { useAuth } from '../../auth/AuthContext';
import { chatKeyboardAvoidingProps } from '../../chat/chatKeyboard';
import { hubRealtimeSocket } from '../../realtime/hubRealtimeSocket';
import {
  readNativeCollectionSnapshot,
  writeNativeCollectionSnapshot,
} from '../../cache/nativeSnapshotCache';
import {
  NativeMailInboxConversationRow,
  NativeMailInboxDivider,
  NativeMailInboxMessageRow,
} from '../../components/mail/NativeMailInboxRow';
import { buildNativeMailFolderOptions } from '../../mail/nativeMailFolders';
import { applyPendingMailReadOverrides } from '../../mail/nativeMailReadOverrides';
import { publishNativeMailUnreadDelta } from '../../mail/nativeMailUnreadEvents';
import {
  extractNativeMailTrashRestoreId,
  type NativeMailSwipeAction,
} from '../../mail/nativeMailModel';
import { useNativeBottomNavInset } from '../../navigation/useNativeBottomNavInset';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens, type FluentTokens } from '../../theme/fluentTokens';
import { AccountScreenScaffold, AccountSectionCard } from '../account/AccountChrome';

const PAGE_SIZE = 50;
const SEARCH_DELAY_MS = 320;
const UNDO_DURATION_MS = 5_000;

type NativeMailAdvancedFilters = {
  dateFrom: string;
  dateTo: string;
  from: string;
  to: string;
  subject: string;
  body: string;
  importance: '' | 'low' | 'normal' | 'high';
  folderScope: 'current' | 'all';
};

type NativeMailUndo =
  | { kind: 'read'; messageId: string; mailboxId: string; previousRead: boolean; item: MailMessagePreview; index: number; label: string }
  | { kind: 'delete'; messageId: string; mailboxId: string; targetFolder: string; label: string };

type MailListItem =
  | { kind: 'message'; key: string; value: MailMessagePreview }
  | { kind: 'conversation'; key: string; value: MailConversationPreview };

type NativeMailInboxSnapshot = {
  signature: string;
  items: MailListItem[];
  total: number;
  hasMore: boolean;
  summary: MailFolderSummary;
  folderTree: MailFolderNode[];
  mailboxes: MailMailbox[];
  preferences: NativeMailPreferences;
};

function firstParam(value: string | string[] | undefined): string {
  return String(Array.isArray(value) ? value[0] : value || '').trim();
}

function importanceParam(value: string | string[] | undefined): NativeMailAdvancedFilters['importance'] {
  const normalized = firstParam(value);
  return normalized === 'high' || normalized === 'normal' || normalized === 'low' ? normalized : '';
}

function initials(value: string): string {
  const words = String(value || '').trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return `${words[0][0]}${words[1][0]}`.toUpperCase();
  return String(words[0] || 'П').slice(0, 2).toUpperCase();
}

function folderIcon(id: string): React.ComponentProps<typeof MaterialCommunityIcons>['name'] {
  const normalized = String(id || '').toLowerCase();
  if (normalized.includes('inbox')) return 'inbox-outline';
  if (normalized.includes('sent')) return 'send-outline';
  if (normalized.includes('draft')) return 'file-document-edit-outline';
  if (normalized.includes('archive')) return 'archive-outline';
  if (normalized.includes('spam') || normalized.includes('junk')) return 'alert-octagon-outline';
  if (normalized.includes('trash') || normalized.includes('deleted')) return 'trash-can-outline';
  if (normalized.includes('flag') || normalized.includes('star')) return 'star-outline';
  return 'folder-outline';
}

function useDebouncedValue(value: string): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [value]);
  return debounced;
}

function adjustFolderTreeUnread(nodes: MailFolderNode[], folderId: string, delta: number): MailFolderNode[] {
  return nodes.map((node) => {
    const nodeId = String(node.id || node.folder_id || node.key || '').trim();
    const wellKnownKey = String(node.well_known_key || '').trim();
    const children = Array.isArray(node.children)
      ? adjustFolderTreeUnread(node.children, folderId, delta)
      : node.children;
    const matches = nodeId === folderId || wellKnownKey === folderId;
    if (!matches && children === node.children) return node;
    return {
      ...node,
      ...(matches ? { unread: Math.max(0, Number(node.unread || 0) + delta) } : {}),
      ...(children !== node.children ? { children } : {}),
    };
  });
}

function FilterChip({ label, selected, count, tokens, onPress, testID }: {
  label: string;
  selected: boolean;
  count?: number;
  tokens: FluentTokens;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={({ pressed }) => [
        styles.chip,
        {
          backgroundColor: selected ? tokens.selected : tokens.panelSolid,
          borderColor: selected ? tokens.selectedBorder : tokens.borderSoft,
          opacity: pressed ? 0.75 : 1,
        },
      ]}
      hitSlop={2}
    >
      <Text style={[styles.chipText, { color: selected ? tokens.primary : tokens.textSecondary }]}>{label}</Text>
      {count ? <Text style={[styles.chipCount, { color: selected ? tokens.primary : tokens.textTertiary }]}>{count > 99 ? '99+' : count}</Text> : null}
    </Pressable>
  );
}

export function NativeMailInboxScreen() {
  const params = useLocalSearchParams<{
    mailboxId?: string | string[];
    folder?: string | string[];
    q?: string | string[];
    view?: string | string[];
    unreadOnly?: string | string[];
    hasAttachments?: string | string[];
    dateFrom?: string | string[];
    dateTo?: string | string[];
    from?: string | string[];
    to?: string | string[];
    subject?: string | string[];
    body?: string | string[];
    importance?: string | string[];
    folderScope?: string | string[];
  }>();
  const { user, hasPermission, offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const bottomInset = useNativeBottomNavInset();
  const allowed = hasPermission('mail.access');
  const [mailboxId, setMailboxId] = useState(firstParam(params.mailboxId));
  const [folder, setFolder] = useState(firstParam(params.folder) || 'inbox');
  const [query, setQuery] = useState(firstParam(params.q));
  const [view, setView] = useState<'messages' | 'conversations'>(firstParam(params.view) === 'conversations' ? 'conversations' : 'messages');
  const [unreadOnly, setUnreadOnly] = useState(firstParam(params.unreadOnly) === '1');
  const [hasAttachments, setHasAttachments] = useState(firstParam(params.hasAttachments) === '1');
  const initialAdvancedFilters = useMemo<NativeMailAdvancedFilters>(() => ({
    dateFrom: firstParam(params.dateFrom),
    dateTo: firstParam(params.dateTo),
    from: firstParam(params.from),
    to: firstParam(params.to),
    subject: firstParam(params.subject),
    body: firstParam(params.body),
    importance: importanceParam(params.importance),
    folderScope: firstParam(params.folderScope) === 'all' ? 'all' : 'current',
  }), [params.body, params.dateFrom, params.dateTo, params.folderScope, params.from, params.importance, params.subject, params.to]);
  const [advancedFilters, setAdvancedFilters] = useState(initialAdvancedFilters);
  const [advancedDraft, setAdvancedDraft] = useState(initialAdvancedFilters);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [folderMenuOpen, setFolderMenuOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [mailboxes, setMailboxes] = useState<MailMailbox[]>([]);
  const [summary, setSummary] = useState<MailFolderSummary>({});
  const [folderTree, setFolderTree] = useState<MailFolderNode[]>([]);
  const [mailViewPreferences, setMailViewPreferences] = useState<NativeMailPreferences>(DEFAULT_NATIVE_MAIL_PREFERENCES);
  const [items, setItems] = useState<MailListItem[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [swipeBusyId, setSwipeBusyId] = useState('');
  const [undo, setUndo] = useState<NativeMailUndo | null>(null);
  const requestRef = useRef(0);
  const lastFocusLoadRef = useRef<{ key: string; pending: boolean; finishedAt: number } | null>(null);
  const debouncedQuery = useDebouncedValue(query);
  const folderOptions = useMemo(() => buildNativeMailFolderOptions(folderTree, summary, {
    favoritesFirst: mailViewPreferences.show_favorites_first,
  }), [folderTree, mailViewPreferences.show_favorites_first, summary]);
  const currentFolderLabel = folderOptions.find((entry) => entry.id === folder)?.label || folder;
  const currentFolderUnread = Math.max(0, Number(folderOptions.find((entry) => entry.id === folder)?.unread || summary[folder]?.unread || 0));
  const activeMailbox = mailboxes.find((item) => String(item.id) === mailboxId) || mailboxes.find((item) => item.is_primary) || mailboxes[0];
  const activeMailboxLabel = String(activeMailbox?.label || activeMailbox?.mailbox_email || 'Почта');
  const mailboxInitials = initials(activeMailboxLabel);
  const advancedFilterCount = useMemo(() => [
    advancedFilters.dateFrom,
    advancedFilters.dateTo,
    advancedFilters.from,
    advancedFilters.to,
    advancedFilters.subject,
    advancedFilters.body,
    advancedFilters.importance,
    advancedFilters.folderScope === 'all' ? 'all' : '',
  ].filter(Boolean).length, [advancedFilters]);
  const filtersActive = Boolean(debouncedQuery || unreadOnly || hasAttachments || advancedFilterCount);
  const selectionMode = selected.size > 0;
  const selectedHasUnread = useMemo(() => items.some((entry) => (
    entry.kind === 'message' && selected.has(entry.value.id) && entry.value.is_read === false
  )), [items, selected]);

  useEffect(() => {
    if (!undo) return undefined;
    const timer = setTimeout(() => setUndo(null), UNDO_DURATION_MS);
    return () => clearTimeout(timer);
  }, [undo]);

  const load = useCallback(async ({ reset, refresh = false }: { reset: boolean; refresh?: boolean }) => {
    const requestId = ++requestRef.current;
    if (refresh) setRefreshing(true);
    else if (reset) setLoading(true);
    else setLoadingMore(true);
    setError('');
    const offset = reset ? 0 : items.length;
    const filters = {
      mailboxId,
      folder,
      folderScope: advancedFilters.folderScope,
      q: debouncedQuery,
      unreadOnly,
      hasAttachments,
      dateFrom: advancedFilters.dateFrom,
      dateTo: advancedFilters.dateTo,
      from: advancedFilters.from,
      to: advancedFilters.to,
      subject: advancedFilters.subject,
      body: advancedFilters.body,
      importance: advancedFilters.importance,
      limit: PAGE_SIZE,
      offset,
    };
    const signature = JSON.stringify({ ...filters, offset: 0, view });
    const userId = Number(user?.id || 0);
    let cached = false;
    if (reset && !refresh && userId) {
      const snapshot = await readNativeCollectionSnapshot<NativeMailInboxSnapshot>(
        'mail-inbox',
        userId,
        signature,
      );
      if (requestId !== requestRef.current) return;
      if (snapshot?.data.signature === signature) {
        cached = true;
        setItems(snapshot.data.items.map((item) => item.kind === 'message'
          ? { ...item, value: applyPendingMailReadOverrides([item.value], mailboxId)[0] }
          : item));
        setTotal(snapshot.data.total);
        setHasMore(snapshot.data.hasMore);
        setSummary(snapshot.data.summary);
        setFolderTree(snapshot.data.folderTree);
        setMailboxes(snapshot.data.mailboxes);
        setMailViewPreferences(snapshot.data.preferences);
        setLoading(false);
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
      const [pageResult, summaryResult, folderTreeResult, mailboxesResult, viewPreferencesResult] = await Promise.all([
        view === 'conversations' ? getMailConversations(filters) : getMailMessages(filters),
        reset ? getMailFolderSummary(mailboxId) : Promise.resolve(null),
        reset ? getMailFolderTree(mailboxId).catch(() => null) : Promise.resolve(null),
        reset && mailboxes.length === 0 ? listMailboxes(true) : Promise.resolve(null),
        reset ? getNativeMailPreferences().catch(() => null) : Promise.resolve(null),
      ]);
      if (requestId !== requestRef.current) return;
      const nextItems: MailListItem[] = view === 'conversations'
        ? (pageResult.items as MailConversationPreview[]).map((value) => ({ kind: 'conversation' as const, key: `c:${value.conversation_id}`, value }))
        : applyPendingMailReadOverrides(pageResult.items as MailMessagePreview[], mailboxId)
          .map((value) => ({ kind: 'message' as const, key: `m:${value.id}`, value }));
      const cachedItems = reset
        ? nextItems
        : [...items, ...nextItems.filter((item) => !items.some((old) => old.key === item.key))];
      setItems(cachedItems);
      setTotal(pageResult.total);
      setHasMore(pageResult.has_more);
      if (summaryResult) {
        setSummary(summaryResult);
        if (mailboxId) {
          const inboxUnread = Math.max(0, Number(summaryResult.inbox?.unread || 0));
          setMailboxes((current) => current.map((mailbox) => String(mailbox.id) === mailboxId
            ? { ...mailbox, unread_count: inboxUnread }
            : mailbox));
        }
      }
      if (folderTreeResult) setFolderTree(folderTreeResult.items);
      if (viewPreferencesResult) setMailViewPreferences(viewPreferencesResult);
      const nextMailboxes = mailboxesResult
        ? mailboxesResult.filter((item) => item.is_active !== false)
        : mailboxes;
      if (mailboxesResult) {
        setMailboxes(nextMailboxes);
      }
      if (pageResult.search_limited) setError('Поиск выполнен по ограниченному окну писем. Уточните запрос.');
      if (userId) {
        void writeNativeCollectionSnapshot<NativeMailInboxSnapshot>('mail-inbox', userId, signature, {
          signature,
          items: cachedItems,
          total: pageResult.total,
          hasMore: pageResult.has_more,
          summary: summaryResult || summary,
          folderTree: folderTreeResult?.items || folderTree,
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
  }, [advancedFilters, debouncedQuery, folder, folderTree, hasAttachments, items.length, mailboxId, mailViewPreferences, mailboxes, offlineMode, summary, unreadOnly, user?.id, view]);

  useFocusEffect(useCallback(() => {
    if (!allowed) return undefined;
    const key = JSON.stringify({ advancedFilters, debouncedQuery, folder, hasAttachments, mailboxId, unreadOnly, view });
    const previous = lastFocusLoadRef.current;
    if (previous?.key === key && (previous.pending || Date.now() - previous.finishedAt < 250)) return undefined;
    const state = { key, pending: true, finishedAt: 0 };
    lastFocusLoadRef.current = state;
    void load({ reset: true }).finally(() => {
      state.pending = false;
      state.finishedAt = Date.now();
    });
    return undefined;
  }, [advancedFilters, allowed, debouncedQuery, folder, hasAttachments, mailboxId, unreadOnly, view])); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!allowed || offlineMode) return undefined;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const refresh = () => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void load({ reset: true, refresh: true });
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

  const toggleSelected = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const openMessage = useCallback((item: MailMessagePreview) => {
    const messageIds = items
      .filter((entry): entry is Extract<MailListItem, { kind: 'message' }> => entry.kind === 'message')
      .map((entry) => entry.value.id);
    const currentIndex = messageIds.indexOf(item.id);
    const sequence = currentIndex >= 0
      ? messageIds.slice(Math.max(0, currentIndex - 2), currentIndex + 3)
      : [item.id];
    router.push({
      pathname: '/(shell)/mail/[messageId]',
      params: {
        messageId: item.id,
        mailboxId: String(item.mailbox_id || mailboxId),
        folder,
        sequence: JSON.stringify(sequence),
      },
    } as never);
  }, [folder, items, mailboxId]);

  const openConversation = useCallback((item: MailConversationPreview) => {
    router.push({
      pathname: '/(shell)/mail/conversation/[conversationId]',
      params: { conversationId: item.conversation_id, mailboxId, folder },
    } as never);
  }, [folder, mailboxId]);

  const applyUnreadDelta = useCallback((delta: number, scopedMailboxId: string) => {
    if (!delta) return;
    setSummary((current) => ({
      ...current,
      [folder]: {
        ...(current[folder] || {}),
        unread: Math.max(0, Number(current[folder]?.unread || 0) + delta),
      },
    }));
    setFolderTree((current) => adjustFolderTreeUnread(current, folder, delta));
    setMailboxes((current) => current.map((mailbox) => String(mailbox.id) === scopedMailboxId
      ? { ...mailbox, unread_count: Math.max(0, Number(mailbox.unread_count || 0) + delta) }
      : mailbox));
    if (folder === 'inbox') publishNativeMailUnreadDelta(delta);
  }, [folder]);

  const openAccountMenu = useCallback(() => {
    setAccountMenuOpen(true);
    void listMailboxes(true).then((result) => {
      setMailboxes(result.filter((item) => item.is_active !== false));
    }).catch((cause) => {
      setError(formatApiError(cause, 'Не удалось обновить счётчики почтовых аккаунтов.'));
    });
  }, []);

  const runSwipeAction = useCallback(async (
    item: MailMessagePreview,
    action: Exclude<NativeMailSwipeAction, null>,
  ) => {
    if (swipeBusyId || offlineMode || selectionMode || (action === 'delete' && folder === 'trash')) return;
    const scopedMailboxId = String(item.mailbox_id || mailboxId);
    setSwipeBusyId(item.id);
    setUndo(null);
    setError('');
    try {
      if (action === 'toggle-read') {
        const previousRead = item.is_read !== false;
        const nextRead = !previousRead;
        const originalIndex = items.findIndex((entry) => entry.kind === 'message' && entry.value.id === item.id);
        if (previousRead) await markMailMessageUnread(item.id, scopedMailboxId);
        else await markMailMessageRead(item.id, scopedMailboxId);
        if (unreadOnly && nextRead) {
          setItems((current) => current.filter((entry) => entry.kind !== 'message' || entry.value.id !== item.id));
          setTotal((current) => Math.max(0, current - 1));
        } else {
          setItems((current) => current.map((entry) => entry.kind === 'message' && entry.value.id === item.id
            ? { ...entry, value: { ...entry.value, is_read: nextRead } }
            : entry));
        }
        applyUnreadDelta(nextRead ? -1 : 1, scopedMailboxId);
        setUndo({
          kind: 'read',
          messageId: item.id,
          mailboxId: scopedMailboxId,
          previousRead,
          item,
          index: Math.max(0, originalIndex),
          label: previousRead ? 'Письмо отмечено непрочитанным.' : 'Письмо отмечено прочитанным.',
        });
      } else {
        const result = await deleteMailMessage(item.id, scopedMailboxId, false);
        const restoreId = extractNativeMailTrashRestoreId(result);
        setItems((current) => current.filter((entry) => entry.kind !== 'message' || entry.value.id !== item.id));
        setTotal((current) => Math.max(0, current - 1));
        if (restoreId) {
          setUndo({
            kind: 'delete',
            messageId: restoreId,
            mailboxId: scopedMailboxId,
            targetFolder: folder,
            label: 'Письмо перемещено в удалённые.',
          });
        }
      }
    } catch (cause) {
      setError(formatApiError(cause, action === 'delete' ? 'Не удалось удалить письмо.' : 'Не удалось изменить статус письма.'));
    } finally {
      setSwipeBusyId('');
    }
  }, [applyUnreadDelta, folder, items, mailboxId, offlineMode, selectionMode, swipeBusyId, unreadOnly]);

  const undoLastAction = useCallback(async () => {
    if (!undo || swipeBusyId || offlineMode) return;
    const pending = undo;
    setUndo(null);
    setSwipeBusyId(pending.messageId);
    setError('');
    try {
      if (pending.kind === 'delete') {
        await restoreMailMessage(pending.messageId, pending.mailboxId, pending.targetFolder);
        await load({ reset: true });
      } else {
        if (pending.previousRead) await markMailMessageRead(pending.messageId, pending.mailboxId);
        else await markMailMessageUnread(pending.messageId, pending.mailboxId);
        if (unreadOnly && pending.previousRead === false) {
          setItems((current) => {
            if (current.some((entry) => entry.kind === 'message' && entry.value.id === pending.messageId)) return current;
            const next = [...current];
            next.splice(Math.min(pending.index, next.length), 0, {
              kind: 'message',
              key: `m:${pending.messageId}`,
              value: { ...pending.item, is_read: false },
            });
            return next;
          });
          setTotal((current) => current + 1);
        } else {
          setItems((current) => current.map((entry) => entry.kind === 'message' && entry.value.id === pending.messageId
            ? { ...entry, value: { ...entry.value, is_read: pending.previousRead } }
            : entry));
        }
        applyUnreadDelta(pending.previousRead ? -1 : 1, pending.mailboxId);
      }
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось отменить действие. Обновите список писем.'));
    } finally {
      setSwipeBusyId('');
    }
  }, [applyUnreadDelta, load, offlineMode, swipeBusyId, undo, unreadOnly]);

  const runBulk = useCallback(async (action: 'read' | 'unread' | 'delete' | 'move', targetFolder = '', permanent = false) => {
    const ids = [...selected];
    if (!ids.length || bulkBusy || offlineMode) return;
    setBulkBusy(true);
    setError('');
    try {
      const selectedMessages = items.filter((entry): entry is Extract<MailListItem, { kind: 'message' }> => (
        entry.kind === 'message' && selected.has(entry.value.id)
      ));
      const result = await bulkMailMessageAction({ mailboxId, action, messageIds: ids, targetFolder, permanent });
      const failed = Math.max(0, Number(result.failed || 0));
      if (result.ok === false || failed > 0) {
        const failedIds = Array.isArray(result.errors)
          ? result.errors.map((entry) => String((entry as { message_id?: unknown })?.message_id || '')).filter(Boolean)
          : [];
        setSelected(new Set(failedIds.length ? failedIds : ids));
        await load({ reset: true });
        setError(failed ? `Не удалось применить действие к ${failed} ${failed === 1 ? 'письму' : 'письмам'}.` : 'Не удалось применить действие к выбранным письмам.');
        return;
      }
      const selectedUnread = selectedMessages.filter((entry) => entry.value.is_read === false).length;
      const selectedRead = selectedMessages.length - selectedUnread;
      if (action === 'read') applyUnreadDelta(-selectedUnread, mailboxId);
      else if (action === 'unread') applyUnreadDelta(selectedRead, mailboxId);
      else if (folder === 'inbox' && (action === 'delete' || action === 'move')) applyUnreadDelta(-selectedUnread, mailboxId);
      setSelected(new Set());
      await load({ reset: true });
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось применить действие к письмам.'));
    } finally {
      setBulkBusy(false);
    }
  }, [applyUnreadDelta, bulkBusy, folder, items, load, mailboxId, offlineMode, selected]);

  const confirmDelete = useCallback(() => {
    const permanent = folder === 'trash';
    Alert.alert(permanent ? 'Удалить выбранные письма навсегда?' : 'Удалить выбранные письма?', permanent ? 'Это действие нельзя отменить.' : 'Письма будут перемещены в папку «Удалённые».', [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Удалить', style: 'destructive', onPress: () => { void runBulk('delete', '', permanent); } },
    ]);
  }, [folder, runBulk]);

  const markAllRead = useCallback(async () => {
    if (bulkBusy || offlineMode) return;
    setBulkBusy(true);
    setError('');
    try {
      const result = await markAllMailMessagesRead({ mailboxId, folder, folderScope: 'current' });
      const changed = Math.max(0, Number(result.changed ?? result.affected ?? currentFolderUnread));
      applyUnreadDelta(-changed, mailboxId);
      await load({ reset: true });
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось отметить папку прочитанной.'));
    } finally {
      setBulkBusy(false);
    }
  }, [applyUnreadDelta, bulkBusy, currentFolderUnread, folder, load, mailboxId, offlineMode]);

  const applyAdvancedFilters = useCallback(() => {
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if ((advancedDraft.dateFrom && !datePattern.test(advancedDraft.dateFrom))
      || (advancedDraft.dateTo && !datePattern.test(advancedDraft.dateTo))) {
      setError('Введите даты в формате ГГГГ-ММ-ДД.');
      return;
    }
    if (advancedDraft.dateFrom && advancedDraft.dateTo && advancedDraft.dateFrom > advancedDraft.dateTo) {
      setError('Начальная дата не может быть позже конечной.');
      return;
    }
    setError('');
    setAdvancedFilters({
      ...advancedDraft,
      dateFrom: advancedDraft.dateFrom.trim(),
      dateTo: advancedDraft.dateTo.trim(),
      from: advancedDraft.from.trim(),
      to: advancedDraft.to.trim(),
      subject: advancedDraft.subject.trim(),
      body: advancedDraft.body.trim(),
    });
    setAdvancedOpen(false);
  }, [advancedDraft]);

  const resetAdvancedFilters = useCallback(() => {
    const reset: NativeMailAdvancedFilters = {
      dateFrom: '', dateTo: '', from: '', to: '', subject: '', body: '', importance: '', folderScope: 'current',
    };
    setAdvancedDraft(reset);
    setAdvancedFilters(reset);
    setError('');
  }, []);

  if (!allowed) {
    return (
      <AccountScreenScaffold title="Почта" tokens={tokens}>
        <AccountSectionCard tokens={tokens} title="Нет доступа" description="Для почты нужно право mail.access.">{null}</AccountSectionCard>
      </AccountScreenScaffold>
    );
  }

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: tokens.pageBg }]} edges={['top', 'left', 'right']}>
      {selectionMode ? (
        <View testID="native-mail-selection-header" style={[styles.selectionHeader, { backgroundColor: tokens.headerBandBg, borderBottomColor: tokens.borderSoft }]}>
          <SelectionAction icon="close" label="Отменить выбор" tokens={tokens} onPress={() => setSelected(new Set())} />
          <Text numberOfLines={1} accessibilityLiveRegion="polite" style={[styles.selectionCount, { color: tokens.textPrimary }]}>Выбрано: {selected.size}</Text>
          <SelectionAction icon={selectedHasUnread ? 'email-open-outline' : 'email-outline'} label={selectedHasUnread ? 'Прочитано' : 'Не прочитано'} disabled={bulkBusy || offlineMode} tokens={tokens} onPress={() => { void runBulk(selectedHasUnread ? 'read' : 'unread'); }} />
          <SelectionAction icon="archive-arrow-down-outline" label="Архивировать" disabled={bulkBusy || offlineMode} tokens={tokens} onPress={() => { void runBulk('move', 'archive'); }} />
          <SelectionAction icon="trash-can-outline" label="Удалить" disabled={bulkBusy || offlineMode} danger tokens={tokens} onPress={confirmDelete} />
          <SelectionAction icon="dots-horizontal" label="Переместить" disabled={bulkBusy || offlineMode} tokens={tokens} onPress={() => setBulkMoveOpen(true)} />
        </View>
      ) : (
        <View style={[styles.searchHeader, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
          <Pressable testID="native-mail-folder-menu" accessibilityRole="button" accessibilityLabel="Открыть папки" onPress={() => setFolderMenuOpen(true)} style={styles.headerButton}>
            <MaterialCommunityIcons name="menu" size={24} color={tokens.iconMuted} />
          </Pressable>
          <View style={styles.searchCenter}>
            <MaterialCommunityIcons name="magnify" size={20} color={tokens.iconMuted} />
            <TextInput
              testID="native-mail-search"
              value={query}
              onChangeText={setQuery}
              placeholder="Поиск в почте"
              placeholderTextColor={tokens.textTertiary}
              accessibilityLabel="Поиск по отправителю, теме и тексту письма"
              returnKeyType="search"
              style={[styles.searchInput, { color: tokens.textPrimary }]}
            />
            {query ? <Pressable accessibilityRole="button" accessibilityLabel="Очистить поиск" onPress={() => setQuery('')} style={styles.clearButton}><MaterialCommunityIcons name="close" size={18} color={tokens.iconMuted} /></Pressable> : null}
          </View>
          <Pressable testID="native-mail-account-menu" accessibilityRole="button" accessibilityLabel={`Почтовый аккаунт: ${activeMailboxLabel}`} onPress={openAccountMenu} style={[styles.accountAvatar, { backgroundColor: tokens.primary }]}>
            <Text numberOfLines={1} maxFontSizeMultiplier={1.15} style={styles.accountInitials}>{mailboxInitials}</Text>
          </Pressable>
        </View>
      )}
      <View style={styles.folderHeader}>
        <View style={styles.folderTitleRow}>
          <Text numberOfLines={1} maxFontSizeMultiplier={1.3} style={[styles.folderTitle, { color: tokens.textPrimary }]}>{currentFolderLabel}</Text>
          {currentFolderUnread ? <View style={[styles.unreadBadge, { backgroundColor: tokens.accentSoft }]}><Text testID="native-mail-folder-unread-count" style={[styles.unreadBadgeText, { color: tokens.primary }]}>{currentFolderUnread > 99 ? '99+' : currentFolderUnread}</Text></View> : null}
        </View>
        <Pressable testID="native-mail-view-menu" accessibilityRole="button" accessibilityLabel="Настройки списка почты" onPress={() => setViewMenuOpen(true)} style={styles.headerButton}>
          <MaterialCommunityIcons name="tune-variant" size={21} color={tokens.iconMuted} />
        </Pressable>
      </View>
      <ScrollView testID="native-mail-filter-row" horizontal showsHorizontalScrollIndicator={false} style={styles.filterRow} contentContainerStyle={styles.filterScroll}>
        <FilterChip label="Непрочитанные" selected={unreadOnly} tokens={tokens} onPress={() => setUnreadOnly((value) => !value)} />
        <FilterChip label="С файлами" selected={hasAttachments} tokens={tokens} onPress={() => setHasAttachments((value) => !value)} />
        <FilterChip testID="native-mail-important-filter" label="Важные" selected={advancedFilters.importance === 'high'} tokens={tokens} onPress={() => setAdvancedFilters((current) => ({ ...current, importance: current.importance === 'high' ? '' : 'high' }))} />
        <FilterChip testID="native-mail-advanced-filter" label={advancedFilterCount ? `Ещё (${advancedFilterCount})` : 'Ещё'} selected={advancedFilterCount > 0} tokens={tokens} onPress={() => { setAdvancedDraft(advancedFilters); setAdvancedOpen(true); }} />
      </ScrollView>
      {error && items.length > 0 ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{error}</Text> : null}
      {loading && items.length === 0 ? (
        <MailListSkeleton tokens={tokens} />
      ) : error && items.length === 0 ? (
        <View testID="native-mail-error-state" style={styles.centerState}>
          <MaterialCommunityIcons name="cloud-alert-outline" size={38} color={tokens.error} />
          <Text accessibilityRole="alert" style={[styles.stateTitle, { color: tokens.textPrimary }]}>Не удалось загрузить почту</Text>
          <Text style={[styles.stateBody, { color: tokens.textSecondary }]}>{error}</Text>
          <Pressable testID="native-mail-retry" accessibilityRole="button" onPress={() => { void load({ reset: true }); }} style={[styles.retryButton, { backgroundColor: tokens.primary }]}><Text style={styles.retryText}>Повторить</Text></Pressable>
        </View>
      ) : (
        <FlatList
          testID="native-mail-list"
          style={[styles.listSurface, { backgroundColor: tokens.panelSolid }]}
          data={items}
          keyExtractor={(item) => item.key}
          extraData={selected}
          refreshing={refreshing}
          onRefresh={() => { void load({ reset: true, refresh: true }); }}
          onEndReached={() => { if (hasMore && !loadingMore) void load({ reset: false }); }}
          onEndReachedThreshold={0.35}
          initialNumToRender={10}
          maxToRenderPerBatch={12}
          windowSize={7}
          contentContainerStyle={[items.length ? styles.list : styles.emptyList, { paddingBottom: bottomInset + 92 }]}
          ItemSeparatorComponent={() => <NativeMailInboxDivider tokens={tokens} />}
          ListFooterComponent={loadingMore ? <View testID="native-mail-loading-footer" style={styles.footer}><ActivityIndicator color={tokens.primary} /><Text style={[styles.footerText, { color: tokens.textSecondary }]}>Загружаем письма…</Text></View> : null}
          ListEmptyComponent={(
            <View testID={filtersActive ? 'native-mail-search-empty' : 'native-mail-folder-empty'} style={styles.centerState}>
              <MaterialCommunityIcons name={filtersActive ? 'email-search-outline' : 'inbox-arrow-down-outline'} size={38} color={tokens.iconMuted} />
              <Text style={[styles.stateTitle, { color: tokens.textPrimary }]}>{filtersActive ? 'Ничего не найдено' : 'В папке нет писем'}</Text>
              <Text style={[styles.stateBody, { color: tokens.textSecondary }]}>{filtersActive ? 'Измените запрос или фильтры.' : 'Новые письма появятся здесь.'}</Text>
            </View>
          )}
          renderItem={({ item }) => item.kind === 'message' ? (
            <NativeMailInboxMessageRow
              item={item.value}
              selected={selected.has(item.value.id)}
              selectionMode={selectionMode}
              tokens={tokens}
              showPreview={mailViewPreferences.show_preview_snippets}
              compact={mailViewPreferences.density === 'compact'}
              canDelete={folder !== 'trash'}
              actionsDisabled={offlineMode || Boolean(swipeBusyId)}
              onOpen={openMessage}
              onToggleSelected={toggleSelected}
              onAction={runSwipeAction}
            />
          ) : <NativeMailInboxConversationRow item={item.value} tokens={tokens} showPreview={mailViewPreferences.show_preview_snippets} compact={mailViewPreferences.density === 'compact'} onOpen={openConversation} />}
        />
      )}
      {!selectionMode && !undo ? (
        <Pressable
          testID="native-mail-compose-fab"
          accessibilityRole="button"
          accessibilityLabel="Написать письмо"
          onPress={() => router.push({ pathname: '/(shell)/mail/compose', params: { mode: 'new', mailboxId } } as never)}
          style={({ pressed }) => [styles.fab, { bottom: bottomInset + 14, backgroundColor: tokens.primary, opacity: pressed ? 0.82 : 1 }]}
        >
          <MaterialCommunityIcons name="square-edit-outline" size={22} color="#fff" />
          <Text style={styles.fabText}>Написать</Text>
        </Pressable>
      ) : null}
      {undo ? (
        <View accessibilityLiveRegion="polite" accessibilityRole="summary" style={[styles.undoBar, { bottom: bottomInset + 14, backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
          <Text numberOfLines={2} style={[styles.undoText, { color: tokens.textPrimary }]}>{undo.label}</Text>
          <Pressable testID="native-mail-undo" accessibilityRole="button" accessibilityLabel="Отменить последнее действие с письмом" disabled={Boolean(swipeBusyId) || offlineMode} onPress={() => { void undoLastAction(); }} style={styles.undoAction}>
            <Text style={[styles.undoActionText, { color: tokens.primary }]}>Отменить</Text>
          </Pressable>
        </View>
      ) : null}
      <Modal visible={folderMenuOpen} transparent animationType="fade" onRequestClose={() => setFolderMenuOpen(false)}>
        <View style={styles.sideBackdrop}>
          <Pressable style={styles.backdropDismissLayer} accessibilityRole="button" accessibilityLabel="Закрыть меню папок" onPress={() => setFolderMenuOpen(false)} />
          <View testID="native-mail-folder-sheet" style={[styles.sideSheet, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
            <SheetHeader title="Папки" subtitle={activeMailbox?.mailbox_email || activeMailboxLabel} tokens={tokens} onClose={() => setFolderMenuOpen(false)} />
            <ScrollView style={styles.sheetList} contentContainerStyle={styles.sheetListContent}>
              {folderOptions.map((entry) => (
                <Pressable key={entry.id} testID={`native-mail-folder-${entry.id}`} accessibilityRole="button" accessibilityState={{ selected: folder === entry.id }} onPress={() => { setFolder(entry.id); setSelected(new Set()); setFolderMenuOpen(false); }} style={[styles.folderMenuRow, { backgroundColor: folder === entry.id ? tokens.selected : 'transparent' }]}>
                  <MaterialCommunityIcons name={folderIcon(entry.id)} size={21} color={folder === entry.id ? tokens.primary : tokens.iconMuted} />
                  <Text numberOfLines={2} style={[styles.folderMenuLabel, { color: folder === entry.id ? tokens.primary : tokens.textPrimary }]}>{entry.pathLabel}</Text>
                  {entry.unread ? <Text style={[styles.folderMenuCount, { color: folder === entry.id ? tokens.primary : tokens.textSecondary }]}>{entry.unread > 99 ? '99+' : entry.unread}</Text> : null}
                </Pressable>
              ))}
            </ScrollView>
            <Pressable testID="native-mail-manage-folders" accessibilityRole="button" onPress={() => { setFolderMenuOpen(false); router.push({ pathname: '/(shell)/mail/folders', params: { mailboxId } } as never); }} style={styles.sheetFooterAction}>
              <MaterialCommunityIcons name="folder-cog-outline" size={21} color={tokens.primary} /><Text style={[styles.sheetFooterText, { color: tokens.primary }]}>Управление папками</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal visible={accountMenuOpen} transparent animationType="slide" onRequestClose={() => setAccountMenuOpen(false)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={styles.backdropDismissLayer} accessibilityRole="button" accessibilityLabel="Закрыть выбор почтового аккаунта" onPress={() => setAccountMenuOpen(false)} />
          <View testID="native-mail-account-sheet" style={[styles.accountSheet, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
            <SheetHeader title="Почтовые аккаунты" subtitle="Выберите основной или делегированный ящик" tokens={tokens} onClose={() => setAccountMenuOpen(false)} />
            <ScrollView style={styles.sheetList} contentContainerStyle={styles.sheetListContent}>
              {mailboxes.map((mailbox) => {
                const active = mailboxId === String(mailbox.id);
                const label = String(mailbox.label || mailbox.mailbox_email || 'Почтовый ящик');
                return <Pressable key={mailbox.id} testID={`native-mail-account-${mailbox.id}`} accessibilityRole="button" accessibilityState={{ selected: active }} onPress={() => { setMailboxId(String(mailbox.id)); setFolder('inbox'); setSelected(new Set()); setAccountMenuOpen(false); }} style={[styles.accountRow, { backgroundColor: active ? tokens.selected : 'transparent' }]}><View style={[styles.accountRowAvatar, { backgroundColor: active ? tokens.primary : tokens.panelInset }]}><Text style={[styles.accountRowInitials, { color: active ? '#fff' : tokens.textSecondary }]}>{initials(label)}</Text></View><View style={styles.accountRowText}><Text numberOfLines={1} style={[styles.accountRowLabel, { color: tokens.textPrimary }]}>{label}</Text><Text numberOfLines={1} style={[styles.accountRowEmail, { color: tokens.textSecondary }]}>{mailbox.mailbox_email || 'Email не указан'}{mailbox.is_primary ? ' · основной' : ''}</Text></View>{Number(mailbox.unread_count || 0) ? <Text testID={`native-mail-account-unread-${mailbox.id}`} style={[styles.accountUnread, { color: tokens.primary }]}>{Number(mailbox.unread_count) > 99 ? '99+' : mailbox.unread_count}</Text> : null}{active ? <MaterialCommunityIcons name="check-circle" size={21} color={tokens.primary} /> : null}</Pressable>;
              })}
            </ScrollView>
          </View>
        </View>
      </Modal>
      <Modal visible={viewMenuOpen} transparent animationType="slide" onRequestClose={() => setViewMenuOpen(false)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={styles.backdropDismissLayer} accessibilityRole="button" accessibilityLabel="Закрыть настройки списка" onPress={() => setViewMenuOpen(false)} />
          <View testID="native-mail-view-sheet" style={[styles.viewSheet, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
            <SheetHeader title="Отображение и действия" subtitle="Группировка писем и почтовые настройки" tokens={tokens} onClose={() => setViewMenuOpen(false)} />
            <View style={styles.viewSwitchRow}><FilterChip label="Письма" selected={view === 'messages'} tokens={tokens} onPress={() => { setView('messages'); setSelected(new Set()); setViewMenuOpen(false); }} /><FilterChip label="Цепочки" selected={view === 'conversations'} tokens={tokens} onPress={() => { setView('conversations'); setSelected(new Set()); setViewMenuOpen(false); }} /></View>
            {currentFolderUnread ? <MenuAction testID="native-mail-mark-all-read" icon="email-open-outline" label="Прочитать все в папке" tokens={tokens} disabled={bulkBusy || offlineMode} onPress={() => { setViewMenuOpen(false); void markAllRead(); }} /> : null}
            <MenuAction testID="native-mail-settings" icon="cog-outline" label="Настройки почты" tokens={tokens} onPress={() => { setViewMenuOpen(false); router.push({ pathname: '/(shell)/mail/settings', params: { mailboxId } } as never); }} />
          </View>
        </View>
      </Modal>
      <Modal visible={advancedOpen} transparent animationType="slide" onRequestClose={() => setAdvancedOpen(false)}>
        <KeyboardAvoidingView style={styles.modalBackdrop} {...chatKeyboardAvoidingProps()}>
          <Pressable style={styles.backdropDismissLayer} accessibilityRole="button" accessibilityLabel="Закрыть расширенные фильтры" onPress={() => setAdvancedOpen(false)} />
          <View testID="native-mail-advanced-filter-sheet" style={[styles.filterSheet, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
            <View style={styles.moveHeader}>
              <View style={styles.moveHeaderText}>
                <Text style={[styles.moveTitle, { color: tokens.textPrimary }]}>Расширенный поиск</Text>
                <Text style={[styles.moveHint, { color: tokens.textSecondary }]}>Поля соответствуют серверному поиску Exchange.</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Закрыть" onPress={() => setAdvancedOpen(false)} style={styles.modalClose}>
                <MaterialCommunityIcons name="close" size={22} color={tokens.iconMuted} />
              </Pressable>
            </View>
            <ScrollView style={styles.filterList} contentContainerStyle={styles.filterContent} keyboardShouldPersistTaps="handled">
              <View style={styles.dateFields}>
                <AdvancedField testID="native-mail-filter-date-from" label="Дата от" value={advancedDraft.dateFrom} placeholder="ГГГГ-ММ-ДД" tokens={tokens} onChangeText={(dateFrom) => setAdvancedDraft((current) => ({ ...current, dateFrom }))} />
                <AdvancedField testID="native-mail-filter-date-to" label="Дата до" value={advancedDraft.dateTo} placeholder="ГГГГ-ММ-ДД" tokens={tokens} onChangeText={(dateTo) => setAdvancedDraft((current) => ({ ...current, dateTo }))} />
              </View>
              <AdvancedField testID="native-mail-filter-from" label="Отправитель" value={advancedDraft.from} tokens={tokens} onChangeText={(from) => setAdvancedDraft((current) => ({ ...current, from }))} />
              <AdvancedField testID="native-mail-filter-to" label="Получатель" value={advancedDraft.to} tokens={tokens} onChangeText={(to) => setAdvancedDraft((current) => ({ ...current, to }))} />
              <AdvancedField testID="native-mail-filter-subject" label="Тема" value={advancedDraft.subject} tokens={tokens} onChangeText={(subject) => setAdvancedDraft((current) => ({ ...current, subject }))} />
              <AdvancedField testID="native-mail-filter-body" label="Содержимое" value={advancedDraft.body} tokens={tokens} onChangeText={(body) => setAdvancedDraft((current) => ({ ...current, body }))} />
              <Text style={[styles.fieldLabel, { color: tokens.textSecondary }]}>Важность</Text>
              <View style={styles.optionRow}>
                {([['', 'Любая'], ['high', 'Высокая'], ['normal', 'Обычная'], ['low', 'Низкая']] as const).map(([value, label]) => (
                  <FilterChip key={value || 'any'} testID={`native-mail-filter-importance-${value || 'any'}`} label={label} selected={advancedDraft.importance === value} tokens={tokens} onPress={() => setAdvancedDraft((current) => ({ ...current, importance: value }))} />
                ))}
              </View>
              <Text style={[styles.fieldLabel, { color: tokens.textSecondary }]}>Область поиска</Text>
              <View style={styles.optionRow}>
                <FilterChip label="Текущая папка" selected={advancedDraft.folderScope === 'current'} tokens={tokens} onPress={() => setAdvancedDraft((current) => ({ ...current, folderScope: 'current' }))} />
                <FilterChip testID="native-mail-filter-all-folders" label="Все папки" selected={advancedDraft.folderScope === 'all'} tokens={tokens} onPress={() => setAdvancedDraft((current) => ({ ...current, folderScope: 'all' }))} />
              </View>
            </ScrollView>
            <View style={styles.filterActions}>
              <Pressable accessibilityRole="button" accessibilityLabel="Сбросить расширенные фильтры" onPress={resetAdvancedFilters} style={[styles.secondaryFilterAction, { borderColor: tokens.borderSoft }]}><Text style={[styles.filterActionText, { color: tokens.textSecondary }]}>Сбросить</Text></Pressable>
              <Pressable testID="native-mail-apply-filters" accessibilityRole="button" accessibilityLabel="Применить расширенные фильтры" onPress={applyAdvancedFilters} style={[styles.primaryFilterAction, { backgroundColor: tokens.primary }]}><Text style={[styles.filterActionText, { color: '#fff' }]}>Применить</Text></Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={bulkMoveOpen} transparent animationType="slide" onRequestClose={() => setBulkMoveOpen(false)}>
        <View style={styles.modalBackdrop}>
          <Pressable style={styles.backdropDismissLayer} accessibilityRole="button" accessibilityLabel="Закрыть выбор папки" onPress={() => setBulkMoveOpen(false)} />
          <View testID="native-mail-bulk-move-sheet" style={[styles.moveSheet, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
            <View style={styles.moveHeader}>
              <View style={styles.moveHeaderText}>
                <Text style={[styles.moveTitle, { color: tokens.textPrimary }]}>Переместить выбранные письма</Text>
                <Text style={[styles.moveHint, { color: tokens.textSecondary }]}>Выбрано: {selected.size}. Укажите папку назначения.</Text>
              </View>
              <Pressable accessibilityRole="button" accessibilityLabel="Закрыть" onPress={() => setBulkMoveOpen(false)} style={styles.modalClose}>
                <MaterialCommunityIcons name="close" size={22} color={tokens.iconMuted} />
              </Pressable>
            </View>
            <ScrollView style={styles.moveList} contentContainerStyle={styles.moveListContent}>
              {folderOptions.filter((target) => target.id !== folder).map((target) => (
                <Pressable
                  key={target.id}
                  testID={`native-mail-bulk-move-target-${target.id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Переместить выбранные письма в папку ${target.pathLabel}`}
                  accessibilityState={{ disabled: bulkBusy || offlineMode }}
                  disabled={bulkBusy || offlineMode}
                  onPress={() => {
                    setBulkMoveOpen(false);
                    void runBulk('move', target.id);
                  }}
                  style={({ pressed }) => [styles.moveTarget, { borderColor: tokens.borderSoft, backgroundColor: pressed ? tokens.panelInset : tokens.panelSolid }]}
                >
                  <MaterialCommunityIcons name="folder-outline" size={21} color={tokens.iconMuted} />
                  <Text numberOfLines={2} style={[styles.moveTargetLabel, { color: tokens.textPrimary }]}>{target.pathLabel}</Text>
                  {target.unread ? <Text style={[styles.moveTargetCount, { color: tokens.textSecondary }]}>{target.unread}</Text> : null}
                  <MaterialCommunityIcons name="chevron-right" size={20} color={tokens.iconMuted} />
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function SelectionAction({ icon, label, disabled = false, danger, tokens, onPress }: {
  icon: React.ComponentProps<typeof MaterialCommunityIcons>['name'];
  label: string;
  disabled?: boolean;
  danger?: boolean;
  tokens: FluentTokens;
  onPress: () => void;
}) {
  const color = danger ? tokens.error : tokens.iconMuted;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.selectionAction, { opacity: disabled ? 0.5 : 1 }]}>
      <MaterialCommunityIcons name={icon} size={22} color={color} />
    </Pressable>
  );
}

function SheetHeader({ title, subtitle, tokens, onClose }: { title: string; subtitle?: string | null; tokens: FluentTokens; onClose: () => void }) {
  return <View style={styles.moveHeader}><View style={styles.moveHeaderText}><Text style={[styles.moveTitle, { color: tokens.textPrimary }]}>{title}</Text>{subtitle ? <Text numberOfLines={2} style={[styles.moveHint, { color: tokens.textSecondary }]}>{subtitle}</Text> : null}</View><Pressable accessibilityRole="button" accessibilityLabel="Закрыть" onPress={onClose} style={styles.modalClose}><MaterialCommunityIcons name="close" size={22} color={tokens.iconMuted} /></Pressable></View>;
}

function MenuAction({ testID, icon, label, disabled = false, tokens, onPress }: { testID?: string; icon: React.ComponentProps<typeof MaterialCommunityIcons>['name']; label: string; disabled?: boolean; tokens: FluentTokens; onPress: () => void }) {
  return <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={onPress} style={[styles.menuAction, { opacity: disabled ? 0.5 : 1 }]}><MaterialCommunityIcons name={icon} size={21} color={tokens.iconMuted} /><Text style={[styles.menuActionText, { color: tokens.textPrimary }]}>{label}</Text><MaterialCommunityIcons name="chevron-right" size={19} color={tokens.iconMuted} /></Pressable>;
}

function MailListSkeleton({ tokens }: { tokens: FluentTokens }) {
  return (
    <View testID="native-mail-loading-skeleton" accessibilityLabel="Загружаем письма" style={[styles.skeletonList, { backgroundColor: tokens.panelSolid }]}>
      {Array.from({ length: 6 }, (_, index) => <View key={index} style={styles.skeletonRow}><View style={[styles.skeletonAvatar, { backgroundColor: tokens.panelInset }]} /><View style={styles.skeletonBody}><View style={[styles.skeletonLineWide, { backgroundColor: tokens.panelInset }]} /><View style={[styles.skeletonLine, { backgroundColor: tokens.panelInset }]} /><View style={[styles.skeletonLineShort, { backgroundColor: tokens.panelInset }]} /></View></View>)}
    </View>
  );
}

function AdvancedField({ testID, label, value, placeholder, tokens, onChangeText }: {
  testID: string;
  label: string;
  value: string;
  placeholder?: string;
  tokens: FluentTokens;
  onChangeText: (value: string) => void;
}) {
  return (
    <View style={styles.advancedField}>
      <Text style={[styles.fieldLabel, { color: tokens.textSecondary }]}>{label}</Text>
      <TextInput
        testID={testID}
        value={value}
        onChangeText={onChangeText}
        accessibilityLabel={label}
        placeholder={placeholder || label}
        placeholderTextColor={tokens.textTertiary}
        autoCapitalize="none"
        style={[styles.fieldInput, { color: tokens.textPrimary, borderColor: tokens.borderSoft, backgroundColor: tokens.panelInset }]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  searchHeader: { height: 56, marginTop: 8, marginHorizontal: 12, borderWidth: 1, borderRadius: 16, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center' },
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  searchCenter: { flex: 1, minWidth: 0, height: 48, flexDirection: 'row', alignItems: 'center', gap: 7 },
  searchInput: { flex: 1, minWidth: 0, height: 48, fontSize: 15, paddingVertical: 8 },
  clearButton: { width: 40, height: 44, alignItems: 'center', justifyContent: 'center' },
  accountAvatar: { width: 40, height: 40, marginHorizontal: 2, borderRadius: 20, alignItems: 'center', justifyContent: 'center', flexShrink: 0 },
  accountInitials: { color: '#fff', fontSize: 13, lineHeight: 18, fontWeight: '900' },
  selectionHeader: { minHeight: 56, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center', borderBottomWidth: StyleSheet.hairlineWidth },
  selectionCount: { flex: 1, minWidth: 42, fontSize: 15, fontWeight: '900' },
  selectionAction: { width: 44, height: 48, alignItems: 'center', justifyContent: 'center' },
  folderHeader: { minHeight: 44, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  folderTitleRow: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 8 },
  folderTitle: { flexShrink: 1, minWidth: 0, fontSize: 18, lineHeight: 24, fontWeight: '900' },
  unreadBadge: { minWidth: 25, height: 22, borderRadius: 11, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center' },
  unreadBadgeText: { fontSize: 11, lineHeight: 15, fontWeight: '900' },
  filterRow: { flexGrow: 0, flexShrink: 0, height: 48 },
  filterScroll: { minHeight: 48, gap: 8, paddingHorizontal: 16, paddingBottom: 8, alignItems: 'center' },
  chip: { height: 40, borderWidth: 1, borderRadius: 20, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipText: { fontSize: 12, fontWeight: '800' },
  chipCount: { fontSize: 11, fontWeight: '900' },
  banner: { marginHorizontal: 16, marginBottom: 5, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  error: { marginHorizontal: 16, marginBottom: 5, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  listSurface: { flex: 1 },
  list: {},
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  footer: { minHeight: 58, paddingVertical: 14, alignItems: 'center', justifyContent: 'center', gap: 6 },
  footerText: { fontSize: 12, fontWeight: '700' },
  centerState: { flex: 1, minHeight: 220, alignItems: 'center', justifyContent: 'center', padding: 24 },
  stateTitle: { marginTop: 10, textAlign: 'center', fontSize: 17, lineHeight: 23, fontWeight: '900' },
  stateBody: { marginTop: 5, textAlign: 'center', fontSize: 13, lineHeight: 19 },
  retryButton: { minWidth: 128, minHeight: 48, marginTop: 16, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  retryText: { color: '#fff', fontSize: 13, fontWeight: '900' },
  skeletonList: { flex: 1 },
  skeletonRow: { minHeight: 92, paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', gap: 12 },
  skeletonAvatar: { width: 42, height: 42, borderRadius: 21 },
  skeletonBody: { flex: 1, minWidth: 0, paddingTop: 2, gap: 8 },
  skeletonLineWide: { width: '78%', height: 12, borderRadius: 6 },
  skeletonLine: { width: '88%', height: 10, borderRadius: 5 },
  skeletonLineShort: { width: '62%', height: 10, borderRadius: 5 },
  fab: { position: 'absolute', right: 16, zIndex: 8, elevation: 8, height: 56, borderRadius: 18, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  fabText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  undoBar: { position: 'absolute', left: 12, right: 12, zIndex: 10, minHeight: 56, borderWidth: 1, borderRadius: 14, paddingLeft: 12, flexDirection: 'row', alignItems: 'center', gap: 8, elevation: 10 },
  undoText: { flex: 1, minWidth: 0, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  undoAction: { minWidth: 88, minHeight: 52, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 12 },
  undoActionText: { fontSize: 12, fontWeight: '900' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.48)', justifyContent: 'flex-end' },
  sideBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.48)', flexDirection: 'row' },
  backdropDismissLayer: { position: 'absolute', inset: 0 },
  sideSheet: { width: '86%', maxWidth: 360, borderRightWidth: 1, paddingTop: 18, paddingHorizontal: 12, paddingBottom: 24 },
  accountSheet: { maxHeight: '72%', borderTopWidth: 1, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, paddingBottom: 24 },
  viewSheet: { borderTopWidth: 1, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, paddingBottom: 24 },
  moveSheet: { maxHeight: '78%', borderTopWidth: 1, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, paddingBottom: 24 },
  filterSheet: { height: '90%', borderTopWidth: 1, borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 16, paddingBottom: 24 },
  moveHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  moveHeaderText: { flex: 1 },
  moveTitle: { fontSize: 19, lineHeight: 25, fontWeight: '900' },
  moveHint: { marginTop: 3, fontSize: 12, lineHeight: 17 },
  modalClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  sheetList: { marginTop: 10 },
  sheetListContent: { paddingBottom: 8 },
  folderMenuRow: { minHeight: 48, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  folderMenuLabel: { flex: 1, minWidth: 0, fontSize: 14, lineHeight: 19, fontWeight: '700' },
  folderMenuCount: { minWidth: 24, textAlign: 'right', fontSize: 11, fontWeight: '900' },
  sheetFooterAction: { minHeight: 48, marginTop: 8, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  sheetFooterText: { fontSize: 13, fontWeight: '900' },
  accountRow: { minHeight: 64, borderRadius: 13, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  accountRowAvatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  accountRowInitials: { fontSize: 13, fontWeight: '900' },
  accountRowText: { flex: 1, minWidth: 0 },
  accountRowLabel: { fontSize: 14, lineHeight: 19, fontWeight: '800' },
  accountRowEmail: { marginTop: 2, fontSize: 12, lineHeight: 17 },
  accountUnread: { minWidth: 24, textAlign: 'right', fontSize: 11, fontWeight: '900' },
  viewSwitchRow: { minHeight: 56, flexDirection: 'row', alignItems: 'center', gap: 8 },
  menuAction: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 10 },
  menuActionText: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: '700' },
  moveList: { marginTop: 10 },
  filterList: { marginTop: 10 },
  filterContent: { gap: 12, paddingBottom: 16 },
  dateFields: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  advancedField: { flexGrow: 1, minWidth: 150 },
  fieldLabel: { marginBottom: 5, fontSize: 12, lineHeight: 17, fontWeight: '800' },
  fieldInput: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, fontSize: 15 },
  optionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  filterActions: { flexDirection: 'row', gap: 10, paddingTop: 10 },
  secondaryFilterAction: { flex: 1, minHeight: 48, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  primaryFilterAction: { flex: 1, minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  filterActionText: { fontSize: 13, fontWeight: '900' },
  moveListContent: { gap: 7, paddingBottom: 8 },
  moveTarget: { minHeight: 54, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  moveTargetLabel: { flex: 1, minWidth: 0, fontSize: 13, lineHeight: 18, fontWeight: '800' },
  moveTargetCount: { fontSize: 11, fontWeight: '800' },
});
