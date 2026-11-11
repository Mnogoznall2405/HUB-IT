import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  InteractionManager,
  type ListRenderItemInfo,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import * as Clipboard from 'expo-clipboard';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { NATIVE_CHAT_ENABLED } from '../../chat/nativeChatFeature';
import { formatApiError } from '../../api/formatError';
import {
  getCompleteAddressBook,
  getAddressBookStatus,
  searchAddressBook,
  syncAddressBook,
  type AddressBookSearchResponse,
  type AddressBookStatus,
} from '../../api/addressBookApi';
import {
  readNativeAddressBookSnapshot,
  writeNativeAddressBookSnapshot,
} from '../../cache/nativeAddressBookSnapshot';
import {
  readNativeEntitySnapshot,
  writeNativeEntitySnapshot,
} from '../../cache/nativeSnapshotCache';
import { useAuth } from '../../auth/AuthContext';
import { useAndroidBackHandler } from '../../chat/useAndroidBackHandler';
import { isAdminUser } from '../../navigation/mobileNavItems';
import { openPortalPath } from '../../navigation/moduleRegistry';
import { usePreferences } from '../../preferences/PreferencesContext';
import {
  AccountLoading,
  AccountScreenScaffold,
  AccountSectionCard,
  AccountStatusText,
  AccountSubpage,
} from '../account/AccountChrome';
import { useNativeBottomNavInset } from '../../navigation/useNativeBottomNavInset';
import { useFluentTokens, type FluentTokens } from '../../theme/fluentTokens';
import { AddressBookEntryDetail } from '../../addressBook/AddressBookEntryDetail';
import { AddressBookEntryRow } from '../../addressBook/AddressBookEntryRow';
import {
  formatDateTime,
  getEntryKey,
  isValidEmailRecipient,
  LOCAL_SEARCH_DEBOUNCE_MS,
  SEARCH_DEBOUNCE_MS,
  SEARCH_LIMIT,
  type AddressBookEntry,
} from '../../addressBook/addressBookFormat';
import {
  addressBookEntryIndicesByCode,
  buildAddressBookSearchIndex,
  normalizeAddressBookSearch,
  searchAddressBookIndex,
  type AddressBookSearchIndex,
} from '../../addressBook/addressBookSearchIndex';
import {
  clearRecentEmployees,
  getFavoriteEmployeeCodes,
  getRecentEmployeeCodes,
  pushRecentEmployee,
  toggleFavoriteEmployee,
} from '../../addressBook/addressBookFavorites';
import { openExternalUrl, openTelegramChat } from '../../addressBook/messengerLinks';
import {
  getAddressBookChatErrorMessage,
  getAddressBookChatCacheKey,
  isAddressBookChatNotFound,
  openCachedAddressBookChat,
  openAddressBookChat,
  type AddressBookChatLink,
} from '../../addressBook/openAddressBookChat';

const SEARCH_PLACEHOLDER = 'ФИО, телефон, отдел';

type AddressBookListMode = 'all' | 'favorites' | 'recent';

const entryCode = (item: AddressBookEntry | null | undefined): string => (
  String(item?.employee_code || '').trim()
);

// N4 fallback: used only until the per-snapshot search index is built.
function filterAddressBookEntries(items: AddressBookEntry[], query: string): AddressBookEntry[] {
  const tokens = normalizeAddressBookSearch(query).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return items;
  return items.filter((item) => {
    const contacts = [
      ...(item.work_phones || []),
      ...(item.personal_phones || []),
      ...(item.work_emails || []),
      ...(item.personal_emails || []),
    ].flatMap((value) => [value.kind, value.value, value.normalized]);
    const haystack = normalizeAddressBookSearch([
      item.full_name,
      item.position,
      item.department,
      item.department_location,
      item.office_address,
      item.office_room,
      item.workplace_number,
      ...contacts,
    ].join(' '));
    return tokens.every((token) => haystack.includes(token));
  });
}

function useDebouncedValue<T>(value: T, delayMs = SEARCH_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs, value]);
  return debounced;
}

const AddressBookListRow = memo(function AddressBookListRow({
  item,
  index,
  query,
  tokens,
  showChatAction,
  chatBusy,
  isFavorite,
  dismissed = false,
  onSelect,
  onCall,
  onOpenTelegram,
  onComposeEmail,
  onOpenChat,
}: {
  item: AddressBookEntry;
  index: number;
  query: string;
  tokens: FluentTokens;
  showChatAction: boolean;
  chatBusy: boolean;
  isFavorite: boolean;
  dismissed?: boolean;
  onSelect: (item: AddressBookEntry, entryKey: string) => void;
  onCall: (telHref: string) => void;
  onOpenTelegram: (digits: string) => void;
  onComposeEmail: (email: string) => void;
  onOpenChat: (item: AddressBookEntry, index: number) => void;
}) {
  const entryKey = getEntryKey(item, index);
  return (
    <AddressBookEntryRow
      item={item}
      entryKey={entryKey}
      query={query}
      tokens={tokens}
      showChatAction={showChatAction && !dismissed}
      chatBusy={chatBusy}
      isFavorite={isFavorite}
      dismissed={dismissed}
      onSelect={() => onSelect(item, entryKey)}
      onCall={onCall}
      onOpenTelegram={onOpenTelegram}
      onComposeEmail={onComposeEmail}
      onOpenChat={() => onOpenChat(item, index)}
    />
  );
});

// N4: the input keeps its own text state so every keystroke re-renders only
// this tiny component; the screen receives the query after a short debounce
// and heavy work (filter + snapshot writes) keys off that emitted value.
const AddressBookSearchField = memo(function AddressBookSearchField({
  tokens,
  onCommit,
}: {
  tokens: FluentTokens;
  onCommit: (value: string) => void;
}) {
  const [text, setText] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => onCommit(text), LOCAL_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [onCommit, text]);
  return (
    <View style={[styles.searchBox, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
      <MaterialCommunityIcons name="magnify" size={20} color={tokens.iconMuted} />
      <TextInput
        testID="address-book-search-input"
        value={text}
        onChangeText={setText}
        placeholder={SEARCH_PLACEHOLDER}
        placeholderTextColor={tokens.textTertiary}
        style={[styles.search, { color: tokens.textPrimary }]}
        accessibilityLabel="Поиск в адресной книге"
        returnKeyType="search"
      />
      {text ? (
        <Pressable onPress={() => setText('')} accessibilityRole="button" accessibilityLabel="Очистить поиск" style={styles.headerAction}>
          <MaterialCommunityIcons name="close" size={18} color={tokens.iconMuted} />
        </Pressable>
      ) : null}
    </View>
  );
});

// P1–P4 native: favorites and recents are list modes over the local snapshot,
// not a horizontally scrolling strip. The row renders only when at least one
// saved code exists in the snapshot (the caller decides).
const AddressBookModesRow = memo(function AddressBookModesRow({
  mode,
  favoritesCount,
  recentsCount,
  tokens,
  onChange,
  onClearRecent,
}: {
  mode: AddressBookListMode;
  favoritesCount: number;
  recentsCount: number;
  tokens: FluentTokens;
  onChange: (mode: AddressBookListMode) => void;
  onClearRecent: () => void;
}) {
  const segments: { key: AddressBookListMode; label: string; testID: string }[] = [
    { key: 'all', label: 'Все', testID: 'address-book-mode-all' },
    ...(favoritesCount > 0 ? [{
      key: 'favorites' as const,
      label: `★ Избранные (${favoritesCount})`,
      testID: 'address-book-mode-favorites',
    }] : []),
    ...(recentsCount > 0 ? [{
      key: 'recent' as const,
      label: `Недавние (${recentsCount})`,
      testID: 'address-book-mode-recent',
    }] : []),
  ];
  return (
    <View
      testID="address-book-list-modes"
      accessibilityLabel="Показать"
      style={styles.modesRow}
    >
      {segments.map((segment) => {
        const active = mode === segment.key;
        return (
          <Pressable
            key={segment.key}
            testID={segment.testID}
            onPress={() => onChange(segment.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={segment.label}
            style={[
              styles.modeSegment,
              {
                borderColor: active ? tokens.primary : tokens.borderSoft,
                backgroundColor: active ? tokens.accentSoft : tokens.panelSolid,
              },
            ]}
          >
            <Text
              numberOfLines={1}
              style={[
                styles.modeSegmentLabel,
                { color: active ? tokens.primary : tokens.textSecondary },
              ]}
            >
              {segment.label}
            </Text>
          </Pressable>
        );
      })}
      {mode === 'recent' ? (
        <Pressable
          testID="address-book-clear-recent"
          onPress={onClearRecent}
          accessibilityRole="button"
          accessibilityLabel="Очистить недавние"
          hitSlop={4}
          style={styles.modeClear}
        >
          <Text style={[styles.modeClearLabel, { color: tokens.textSecondary }]}>
            Очистить недавние
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
});

export function NativeAddressBookScreen() {
  const { user, hasPermission, offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const allowed = hasPermission('address_book.read');
  const isAdmin = isAdminUser(user);
  const canUseChat = NATIVE_CHAT_ENABLED && hasPermission('chat.read') && hasPermission('chat.write');

  const [query, setQuery] = useState('');
  const [directoryItems, setDirectoryItems] = useState<AddressBookEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState<AddressBookStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [selectedKey, setSelectedKey] = useState('');
  const [selectedItem, setSelectedItem] = useState<AddressBookEntry | null>(null);
  const [chatBusyKey, setChatBusyKey] = useState('');
  const [remoteItems, setRemoteItems] = useState<AddressBookEntry[]>([]);
  const [remoteLoading, setRemoteLoading] = useState(false);
  // N2: list modes — 'all' | 'favorites' | 'recent'. The code set is frozen on
  // mode entry so opening a card (pushRecentEmployee) never reshuffles the
  // visible "Недавние" list on the fly.
  const [listMode, setListMode] = useState<AddressBookListMode>('all');
  const [modeCodes, setModeCodes] = useState<string[]>([]);
  // N5: dismissed employees are server-only (≈51 000 records) — never cached
  // locally, paginated by 50, gated by address_book.dismissed.read.
  const canViewDismissed = hasPermission('address_book.dismissed.read');
  const [tab, setTab] = useState<'active' | 'dismissed'>('active');
  const dismissedTab = tab === 'dismissed' && canViewDismissed;
  const [dismissedItems, setDismissedItems] = useState<AddressBookEntry[]>([]);
  const [dismissedTotal, setDismissedTotal] = useState(0);
  const [dismissedHasMore, setDismissedHasMore] = useState(false);
  const [dismissedLoading, setDismissedLoading] = useState(false);
  const [dismissedLoadingMore, setDismissedLoadingMore] = useState(false);
  const [dismissedFailed, setDismissedFailed] = useState(false);
  // An append failure keeps the loaded pages visible — the footer offers a
  // retry resuming at the same offset instead of a full-screen error.
  const [dismissedAppendFailed, setDismissedAppendFailed] = useState(false);
  const dismissedRequestRef = useRef(0);
  const dismissedAbortRef = useRef<AbortController | null>(null);
  const [favoriteCodes, setFavoriteCodes] = useState<string[]>([]);
  const [recentCodes, setRecentCodes] = useState<string[]>([]);
  const searchRequestRef = useRef(0);
  const remoteSearchRef = useRef(0);
  const remoteAbortRef = useRef<AbortController | null>(null);
  // N4: query arrives already debounced (LOCAL_SEARCH_DEBOUNCE_MS) from the
  // isolated search field; the remote fallback keeps ~SEARCH_DEBOUNCE_MS total.
  const [searchIndex, setSearchIndex] = useState<AddressBookSearchIndex | null>(null);
  const indexJobRef = useRef(0);
  const remoteQuery = useDebouncedValue(query, SEARCH_DEBOUNCE_MS - LOCAL_SEARCH_DEBOUNCE_MS);
  const lastInputAtRef = useRef(0);
  const pendingSnapshotWriteRef = useRef<AddressBookSearchResponse | null>(null);
  const snapshotWriteTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deferredWriteJobRef = useRef(0);
  const listInset = useNativeBottomNavInset();
  const userId = Number(user?.id || 0);
  const liveCodes = useMemo(() => {
    const set = new Set<string>();
    for (const item of directoryItems) {
      const code = entryCode(item);
      if (code) set.add(code);
    }
    return set;
  }, [directoryItems]);
  // Segment counts reflect only codes that exist in the local snapshot —
  // stale codes (dismissed employees) are not counted.
  const favoritesCount = useMemo(
    () => favoriteCodes.reduce((count, code) => count + (liveCodes.has(code) ? 1 : 0), 0),
    [favoriteCodes, liveCodes],
  );
  const recentsCount = useMemo(
    () => recentCodes.reduce((count, code) => count + (liveCodes.has(code) ? 1 : 0), 0),
    [recentCodes, liveCodes],
  );
  const showModesRow = directoryItems.length > 0 && (favoritesCount > 0 || recentsCount > 0);
  const favoriteSet = useMemo(() => new Set(favoriteCodes), [favoriteCodes]);
  const items = useMemo(() => {
    if (!directoryItems.length) return remoteItems;
    const hasQuery = Boolean(query.trim());
    let scoped: AddressBookEntry[];
    if (listMode !== 'all' && modeCodes.length > 0) {
      if (searchIndex) {
        const indices = addressBookEntryIndicesByCode(searchIndex, modeCodes);
        // With a query, "Недавние" follows the directory order like "Все";
        // without one, indices already arrive in stored recency order.
        if (listMode === 'recent' && hasQuery) indices.sort((a, b) => a - b);
        scoped = searchAddressBookIndex(searchIndex, query, indices);
      } else {
        const codes = new Set(modeCodes);
        scoped = filterAddressBookEntries(
          directoryItems.filter((item) => codes.has(entryCode(item))),
          query,
        );
        if (listMode === 'recent' && !hasQuery) {
          const order = new Map(modeCodes.map((code, position) => [code, position]));
          const rank = (entry: AddressBookEntry) => order.get(entryCode(entry)) ?? Number.MAX_SAFE_INTEGER;
          scoped = [...scoped].sort((a, b) => rank(a) - rank(b));
        }
      }
    } else {
      scoped = searchIndex
        ? searchAddressBookIndex(searchIndex, query)
        : filterAddressBookEntries(directoryItems, query);
    }
    if (listMode === 'favorites') {
      scoped = [...scoped].sort((a, b) => (
        String(a.full_name || '').localeCompare(String(b.full_name || ''), 'ru')
      ));
    }
    return scoped;
  }, [directoryItems, listMode, modeCodes, query, remoteItems, searchIndex]);

  const loadStatus = useCallback(async () => {
    if (offlineMode) return;
    try {
      setStatus(await getAddressBookStatus());
    } catch {
      // Status is optional; search still works.
    }
  }, [offlineMode]);

  // N4: defer the heavy snapshot write until interactions are done and the
  // input has been quiet for a moment. Keeps integrity verification intact —
  // only the start time moves.
  const scheduleSnapshotWrite = useCallback((payload: AddressBookSearchResponse) => {
    const job = ++deferredWriteJobRef.current;
    pendingSnapshotWriteRef.current = payload;
    if (snapshotWriteTimerRef.current) clearTimeout(snapshotWriteTimerRef.current);
    const QUIET_MS = 500;
    const attempt = () => {
      if (job !== deferredWriteJobRef.current) return;
      const idleFor = Date.now() - lastInputAtRef.current;
      if (idleFor < QUIET_MS) {
        snapshotWriteTimerRef.current = setTimeout(attempt, QUIET_MS - idleFor);
        return;
      }
      pendingSnapshotWriteRef.current = null;
      snapshotWriteTimerRef.current = null;
      void writeNativeAddressBookSnapshot(userId, payload)
        .then((stored) => {
          if (!stored && job === deferredWriteJobRef.current) {
            setError('Адресная книга загружена, но offline-копию обновить не удалось.');
          }
        });
    };
    InteractionManager.runAfterInteractions(() => {
      if (job === deferredWriteJobRef.current) snapshotWriteTimerRef.current = setTimeout(attempt, 0);
    });
  }, [userId]);

  // Leaving the screen must not lose the offline copy: flush a pending write
  // immediately instead of waiting for the quiet window.
  useEffect(() => () => {
    deferredWriteJobRef.current += 1;
    if (snapshotWriteTimerRef.current) clearTimeout(snapshotWriteTimerRef.current);
    const pending = pendingSnapshotWriteRef.current;
    pendingSnapshotWriteRef.current = null;
    if (pending && userId > 0) void writeNativeAddressBookSnapshot(userId, pending);
    dismissedAbortRef.current?.abort();
  }, [userId]);

  const loadItems = useCallback(async (mode: 'load' | 'refresh' = 'load') => {
    const requestId = ++searchRequestRef.current;
    let hadCachedSnapshot = false;
    if (mode === 'refresh') setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const snapshot = await readNativeAddressBookSnapshot<AddressBookSearchResponse>(userId);
      if (requestId !== searchRequestRef.current) return;
      if (snapshot) {
        hadCachedSnapshot = true;
        setDirectoryItems(snapshot.data.items);
        setTotal(snapshot.data.total);
        setStatus((prev) => ({
          ...(prev || {}),
          updated_at: snapshot.data.updated_at || prev?.updated_at || '',
          last_error: snapshot.data.last_error || prev?.last_error || '',
        }));
        setLoading(false);
      }
      if (offlineMode) {
        if (!hadCachedSnapshot) {
          setDirectoryItems([]);
          setTotal(0);
          setError('Адресная книга ещё не сохранена на устройстве. Загрузите её при подключении к сети.');
        }
        return;
      }

      // Дешёвая проверка свежести: если снимок на устройстве совпадает с
      // серверным updated_at, полная выгрузка не нужна.
      if (hadCachedSnapshot) {
        try {
          const remoteStatus = await getAddressBookStatus();
          if (requestId !== searchRequestRef.current) return;
          setStatus(remoteStatus);
          if (remoteStatus?.updated_at && remoteStatus.updated_at === snapshot?.data.updated_at) {
            return;
          }
        } catch {
          // Статус опционален — при ошибке делаем полную перезагрузку.
        }
      }

      const data = await getCompleteAddressBook();
      if (requestId !== searchRequestRef.current) return;
      setDirectoryItems(data.items);
      setTotal(data.total);
      setStatus((prev) => ({
        ...(prev || {}),
        updated_at: data.updated_at || prev?.updated_at || '',
        last_error: data.last_error || prev?.last_error || '',
      }));
      // N4: the shard split + encrypt + re-verify of a multi-MiB snapshot must
      // not compete with ongoing input — run it once the screen is idle.
      scheduleSnapshotWrite(data);
    } catch (cause) {
      if (requestId !== searchRequestRef.current) return;
      if (!hadCachedSnapshot) {
        setError(formatApiError(cause, 'Не удалось загрузить адресную книгу.'));
      }
    } finally {
      if (requestId === searchRequestRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [offlineMode, scheduleSnapshotWrite, userId]);

  useEffect(() => {
    if (allowed && userId > 0) void loadItems();
  }, [allowed, loadItems, userId]);

  useEffect(() => {
    if (allowed) void loadStatus();
  }, [allowed, loadStatus]);

  // N1/N2: saved codes live in the encrypted per-user cache; they load once per
  // user and are re-read only after explicit mutations.
  useEffect(() => {
    if (!allowed || userId <= 0) return undefined;
    let alive = true;
    void Promise.all([getFavoriteEmployeeCodes(userId), getRecentEmployeeCodes(userId)])
      .then(([favorites, recents]) => {
        if (!alive) return;
        setFavoriteCodes(favorites);
        setRecentCodes(recents);
      })
      .catch(() => undefined);
    return () => { alive = false; };
  }, [allowed, userId]);

  // N4: build the per-snapshot search index in chunks right after the
  // directory loads — outside the first keystroke. Until it is ready, the
  // previous per-query filter keeps working.
  useEffect(() => {
    const job = ++indexJobRef.current;
    setSearchIndex(null);
    if (!directoryItems.length) return undefined;
    let cancelled = false;
    void buildAddressBookSearchIndex(directoryItems).then((index) => {
      if (!cancelled && indexJobRef.current === job) setSearchIndex(index);
    });
    return () => { cancelled = true; };
  }, [directoryItems]);

  // A mode whose saved set became empty falls back to "Все" — its segment is
  // hidden, so the active mode must not stay selected.
  useEffect(() => {
    if (listMode === 'favorites' && favoritesCount === 0) {
      setListMode('all');
      setModeCodes([]);
    } else if (listMode === 'recent' && recentsCount === 0) {
      setListMode('all');
      setModeCodes([]);
    }
  }, [favoritesCount, listMode, recentsCount]);

  // Losing the permission (or a 403) must not leave the dismissed tab active.
  useEffect(() => {
    if (tab === 'dismissed' && !canViewDismissed) setTab('active');
  }, [canViewDismissed, tab]);

  const loadDismissedPage = useCallback(async (q: string, offset: number, append: boolean) => {
    // Server search over ~51 000 dismissed rows is expensive for one letter —
    // the <2 rule must hold for retry/pull-to-refresh too, not just the effect.
    if (q.length === 1) return;
    const requestId = ++dismissedRequestRef.current;
    dismissedAbortRef.current?.abort();
    const controller = new AbortController();
    dismissedAbortRef.current = controller;
    if (append) { setDismissedLoadingMore(true); setDismissedAppendFailed(false); }
    else { setDismissedLoading(true); setDismissedFailed(false); setDismissedAppendFailed(false); }
    try {
      const result = await searchAddressBook({
        q,
        limit: SEARCH_LIMIT,
        offset,
        dismissed: true,
        signal: controller.signal,
      });
      if (requestId !== dismissedRequestRef.current || controller.signal.aborted) return;
      setDismissedItems((prev) => (append ? [...prev, ...result.items] : result.items));
      setDismissedTotal(result.total);
      setDismissedHasMore(Boolean(result.has_more));
      setDismissedAppendFailed(false);
    } catch (cause) {
      if (controller.signal.aborted || requestId !== dismissedRequestRef.current) return;
      const statusCode = Number((cause as { response?: { status?: unknown } } | null)?.response?.status || 0);
      if (statusCode === 403) {
        // Permission denied on the server side: neutral message, back to the
        // active directory.
        setMessage('Список уволенных недоступен для вашей учётной записи.');
        setTab('active');
        return;
      }
      if (append) setDismissedAppendFailed(true);
      else setDismissedFailed(true);
    } finally {
      // A superseding request has already bumped the id and manages its own
      // flags; a plain abort (tab switch/offline/unmount) leaves this request
      // as the current one, so it still owns the flags.
      if (requestId === dismissedRequestRef.current) {
        setDismissedLoading(false);
        setDismissedLoadingMore(false);
      }
    }
  }, []);

  // Dismissed tab drives its own remote query on the ~300 ms debounced value.
  // Single-character queries are too expensive over ~51 000 rows — show a hint.
  const dismissedQuery = remoteQuery.trim();
  const dismissedQueryShort = dismissedTab && dismissedQuery.length === 1;
  useEffect(() => {
    dismissedAbortRef.current?.abort();
    if (!dismissedTab || offlineMode || dismissedQueryShort) return;
    void loadDismissedPage(dismissedQuery, 0, false);
  }, [dismissedTab, dismissedQuery, dismissedQueryShort, offlineMode, loadDismissedPage]);

  const handleDismissedEndReached = useCallback(() => {
    if (!dismissedTab || dismissedLoading || dismissedLoadingMore || dismissedFailed || dismissedAppendFailed || !dismissedHasMore) return;
    void loadDismissedPage(remoteQuery.trim(), dismissedItems.length, true);
  }, [
    dismissedTab,
    dismissedLoading,
    dismissedLoadingMore,
    dismissedFailed,
    dismissedAppendFailed,
    dismissedHasMore,
    dismissedItems.length,
    remoteQuery,
    loadDismissedPage,
  ]);

  const handleTabChange = useCallback((next: 'active' | 'dismissed') => {
    setTab(next);
    // List modes belong to the local snapshot — leaving the active tab drops
    // them; the open card is dismissed too. Search text is kept.
    setListMode('all');
    setModeCodes([]);
    setSelectedKey('');
    setSelectedItem(null);
    setError('');
  }, []);

  // Пока локальный снимок ещё не загружен, ищем на сервере — иначе первый
  // ввод ждал бы полной выгрузки всей адресной книги.
  useEffect(() => {
    remoteAbortRef.current?.abort();
    const requestId = ++remoteSearchRef.current;
    const normalized = remoteQuery.trim();
    if (!normalized || directoryItems.length > 0 || offlineMode || !allowed || dismissedTab) {
      setRemoteItems([]);
      setRemoteLoading(false);
      return;
    }
    const controller = new AbortController();
    remoteAbortRef.current = controller;
    setRemoteLoading(true);
    void searchAddressBook({ q: normalized, limit: SEARCH_LIMIT, signal: controller.signal })
      .then((result) => {
        if (requestId === remoteSearchRef.current && !controller.signal.aborted) setRemoteItems(result.items);
      })
      .catch(() => {
        if (requestId === remoteSearchRef.current && !controller.signal.aborted) setRemoteItems([]);
      })
      .finally(() => {
        if (requestId === remoteSearchRef.current && !controller.signal.aborted) setRemoteLoading(false);
      });
  }, [allowed, remoteQuery, directoryItems.length, offlineMode, dismissedTab]);

  useAndroidBackHandler(() => {
    if (selectedItem) {
      setSelectedKey('');
      setSelectedItem(null);
      return true;
    }
    return false;
  });

  const handleSync = useCallback(async () => {
    setSyncing(true);
    setError('');
    setMessage('');
    try {
      const nextStatus = await syncAddressBook();
      setStatus(nextStatus);
      await loadItems('refresh');
      setMessage('Адресная книга обновлена из 1С.');
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось обновить адресную книгу из 1С.'));
      await loadStatus();
    } finally {
      setSyncing(false);
    }
  }, [loadItems, loadStatus]);

  const handleCopy = useCallback(async (value: string) => {
    const text = String(value || '').trim();
    if (!text) return;
    try {
      await Clipboard.setStringAsync(text);
      setMessage(isValidEmailRecipient(text) ? 'E-mail скопирован' : 'Номер скопирован');
      setError('');
    } catch {
      setError(isValidEmailRecipient(text) ? 'Не удалось скопировать e-mail' : 'Не удалось скопировать номер');
    }
  }, []);

  const handleCall = useCallback((telHref: string) => {
    void openExternalUrl(telHref).then((opened) => {
      if (!opened) setError('Не удалось открыть звонок.');
    });
  }, []);

  const handleOpenTelegram = useCallback((digits: string) => {
    void openTelegramChat(digits).then((opened) => {
      if (!opened) setError('Номер не подходит для Telegram');
    });
  }, []);

  const handleOpenMax = useCallback(async (digits: string) => {
    const phone = String(digits || '').trim();
    if (!/^\d{11,15}$/.test(phone)) {
      setError('Номер не подходит для MAX');
      return;
    }
    const formatted = `+${phone}`;
    try {
      await Clipboard.setStringAsync(formatted);
      setMessage('Номер скопирован для MAX');
      Alert.alert(
        'Как найти контакт в MAX',
        `Откройте приложение MAX, нажмите поиск и вставьте скопированный номер: ${formatted}`,
      );
    } catch {
      setError('Не удалось скопировать номер');
    }
  }, []);

  const handleComposeEmail = useCallback((email: string) => {
    const recipient = String(email || '').trim();
    if (!isValidEmailRecipient(recipient)) {
      setError('Некорректный e-mail');
      return;
    }
    openPortalPath(`/mail?folder=inbox&compose_to=${encodeURIComponent(recipient)}`);
  }, []);

  const handleSelectEntry = useCallback((item: AddressBookEntry, entryKey: string) => {
    setSelectedKey(entryKey);
    setSelectedItem(item);
    setMessage('');
    setError('');
    const code = entryCode(item);
    // N5: dismissed cards never touch recents.
    if (code && userId > 0 && !dismissedTab) {
      void pushRecentEmployee(userId, code)
        .then(setRecentCodes)
        .catch(() => undefined);
    }
  }, [dismissedTab, userId]);

  const handleToggleFavorite = useCallback((item: AddressBookEntry) => {
    const code = entryCode(item);
    if (!code || userId <= 0) return;
    void toggleFavoriteEmployee(userId, code)
      .then(({ codes }) => setFavoriteCodes(codes))
      .catch(() => undefined);
  }, [userId]);

  const handleListModeChange = useCallback((nextMode: AddressBookListMode) => {
    setModeCodes(
      nextMode === 'favorites' ? [...favoriteCodes]
        : nextMode === 'recent' ? [...recentCodes]
          : [],
    );
    setListMode(nextMode);
  }, [favoriteCodes, recentCodes]);

  const handleClearRecent = useCallback(() => {
    setListMode('all');
    setModeCodes([]);
    setRecentCodes([]);
    if (userId > 0) void clearRecentEmployees(userId).catch(() => undefined);
  }, [userId]);

  const handleOpenExternalMail = useCallback((email: string) => {
    const recipient = String(email || '').trim();
    if (!isValidEmailRecipient(recipient)) {
      setError('Некорректный e-mail');
      return;
    }
    void openExternalUrl(`mailto:${recipient}`);
  }, []);

  const handleOpenChat = useCallback(async (item: AddressBookEntry, index: number) => {
    const entryKey = getEntryKey(item, index);
    const cacheKey = getAddressBookChatCacheKey(item);
    setChatBusyKey(entryKey);
    setError('');
    try {
      const cached = cacheKey
        ? await readNativeEntitySnapshot<AddressBookChatLink>('address-book-chat-links', userId, cacheKey)
        : null;
      if (cached) {
        openCachedAddressBookChat(cached.data);
        return;
      }
      if (offlineMode) {
        throw new Error('Этот чат ещё не открывался на устройстве. Подключитесь к сети для первого перехода.');
      }
      const link = await openAddressBookChat(item);
      if (cacheKey) {
        await writeNativeEntitySnapshot('address-book-chat-links', userId, cacheKey, link);
      }
    } catch (cause) {
      if (isAddressBookChatNotFound(cause)) {
        setError(getAddressBookChatErrorMessage(
          cause,
          'Сотрудник не найден в HUB-чате. Возможно, у него нет учётной записи.',
        ));
      } else {
        setError(formatApiError(cause, 'Не удалось открыть корпоративный чат.'));
      }
    } finally {
      setChatBusyKey('');
    }
  }, [offlineMode, userId]);

  const handleSearchCommit = useCallback((value: string) => {
    lastInputAtRef.current = Date.now();
    setQuery(value);
  }, []);

  const countLabel = useMemo(
    () => `Найдено ${dismissedTab ? dismissedTotal : (listMode !== 'all' || query.trim() ? items.length : total)}`,
    [dismissedTab, dismissedTotal, items.length, listMode, query, total],
  );

  const renderAddressBookItem = useCallback(({ item, index }: ListRenderItemInfo<AddressBookEntry>) => {
    const entryKey = getEntryKey(item, index);
    return (
      <AddressBookListRow
        item={item}
        index={index}
        query={query}
        tokens={tokens}
        showChatAction={canUseChat}
        chatBusy={chatBusyKey === entryKey}
        onSelect={handleSelectEntry}
        onCall={handleCall}
        onOpenTelegram={handleOpenTelegram}
        onComposeEmail={handleComposeEmail}
        onOpenChat={handleOpenChat}
        isFavorite={!dismissedTab && favoriteSet.has(entryCode(item))}
        dismissed={dismissedTab}
      />
    );
  }, [
    canUseChat,
    chatBusyKey,
    query,
    favoriteSet,
    dismissedTab,
    handleCall,
    handleComposeEmail,
    handleOpenChat,
    handleOpenTelegram,
    handleSelectEntry,
    tokens,
  ]);

  if (!allowed) {
    return (
      <AccountScreenScaffold title="Адресная книга" tokens={tokens}>
        <AccountSectionCard
          tokens={tokens}
          title="Нет доступа"
          description="Раздел доступен сотрудникам с правом чтения адресной книги."
        >
          {null}
        </AccountSectionCard>
      </AccountScreenScaffold>
    );
  }

  const selectedIndex = selectedItem
    ? items.findIndex((item, index) => getEntryKey(item, index) === selectedKey)
    : -1;

  return (
    <AccountScreenScaffold
      title="Адресная книга"
      tokens={tokens}
      scroll={false}
      contentUnderNav
    >
      <AddressBookSearchField tokens={tokens} onCommit={handleSearchCommit} />
      {canViewDismissed ? (
        <View style={styles.modesRow} accessibilityLabel="Вкладки адресной книги">
          {([
            { key: 'active', label: 'Сотрудники', testID: 'address-book-tab-active' },
            { key: 'dismissed', label: 'Уволенные', testID: 'address-book-tab-dismissed' },
          ] as const).map((segment) => {
            const active = (tab === 'dismissed') === (segment.key === 'dismissed');
            return (
              <Pressable
                key={segment.key}
                testID={segment.testID}
                onPress={() => handleTabChange(segment.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                accessibilityLabel={segment.label}
                style={[
                  styles.modeSegment,
                  {
                    borderColor: active ? tokens.primary : tokens.borderSoft,
                    backgroundColor: active ? tokens.accentSoft : tokens.panelSolid,
                  },
                ]}
              >
                <Text
                  numberOfLines={1}
                  style={[
                    styles.modeSegmentLabel,
                    { color: active ? tokens.primary : tokens.textSecondary },
                  ]}
                >
                  {segment.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <View style={styles.metaRow}>
        <Text
          numberOfLines={1}
          style={[styles.meta, { color: tokens.textSecondary, flex: 1, minWidth: 0 }]}
        >
          {countLabel} · Обновлено: {formatDateTime(
            dismissedTab ? (status?.dismissed_updated_at || status?.updated_at) : status?.updated_at,
          )}
        </Text>
        {isAdmin ? (
          <Pressable
            testID="address-book-sync"
            onPress={() => { void handleSync(); }}
            disabled={syncing || offlineMode}
            accessibilityRole="button"
            accessibilityLabel="Обновить из 1С"
            accessibilityState={{ disabled: syncing || offlineMode, busy: syncing }}
            hitSlop={4}
            style={styles.syncButton}
          >
            {syncing
              ? <ActivityIndicator color={tokens.primary} size="small" />
              : (
                <MaterialCommunityIcons
                  name="database-sync-outline"
                  size={20}
                  color={offlineMode ? tokens.textTertiary : tokens.primary}
                />
              )}
          </Pressable>
        ) : null}
      </View>
      {loading && remoteItems.length > 0 ? (
        <Text style={[styles.updated, { color: tokens.textSecondary }]}>
          Показаны результаты сервера — адресная книга ещё загружается.
        </Text>
      ) : null}
      {showModesRow && !dismissedTab ? (
        <AddressBookModesRow
          mode={listMode}
          favoritesCount={favoritesCount}
          recentsCount={recentsCount}
          tokens={tokens}
          onChange={handleListModeChange}
          onClearRecent={handleClearRecent}
        />
      ) : null}
      <AccountStatusText tokens={tokens} error={error} message={message} />
      {status?.last_error ? (
        <Text style={[styles.warning, { color: tokens.warning }]}>
          Последняя синхронизация завершилась ошибкой: {status.last_error}
        </Text>
      ) : null}
      {dismissedTab ? (
        offlineMode ? (
          <Text
            testID="address-book-dismissed-offline"
            style={[styles.empty, { color: tokens.textSecondary }]}
          >
            Список уволенных доступен при подключении к сети
          </Text>
        ) : dismissedQueryShort ? (
          <Text style={[styles.empty, { color: tokens.textSecondary }]}>
            Введите минимум 2 символа
          </Text>
        ) : dismissedFailed ? (
          <View style={styles.emptyList}>
            <Text style={[styles.empty, { color: tokens.textSecondary }]}>
              Не удалось загрузить список уволенных
            </Text>
            <Pressable
              testID="address-book-dismissed-retry"
              onPress={() => { void loadDismissedPage(remoteQuery.trim(), 0, false); }}
              accessibilityRole="button"
              accessibilityLabel="Повторить загрузку списка уволенных"
              style={[styles.retryButton, { borderColor: tokens.borderSoft, backgroundColor: tokens.panelSolid }]}
            >
              <Text style={[styles.retryLabel, { color: tokens.primary }]}>Повторить</Text>
            </Pressable>
          </View>
        ) : dismissedLoading && dismissedItems.length === 0 ? (
          <AccountLoading tokens={tokens} />
        ) : (
          <FlatList
            initialNumToRender={12}
            maxToRenderPerBatch={10}
            windowSize={7}
            style={styles.list}
            testID="address-book-entry-list"
            data={dismissedItems}
            keyExtractor={(item, index) => getEntryKey(item, index)}
            keyboardShouldPersistTaps="handled"
            onEndReachedThreshold={0.4}
            onEndReached={handleDismissedEndReached}
            refreshing={dismissedLoading}
            onRefresh={() => { void loadDismissedPage(remoteQuery.trim(), 0, false); }}
            contentContainerStyle={[dismissedItems.length === 0 ? styles.emptyList : null, { paddingBottom: listInset + 8 }]}
            ListEmptyComponent={(
              <Text style={[styles.empty, { color: tokens.textSecondary }]}>
                {remoteQuery.trim()
                  ? 'По вашему запросу уволенные сотрудники не найдены.'
                  : 'Список уволенных пуст.'}
              </Text>
            )}
            // A failed append keeps the loaded list and offers retry in the
            // footer; resume from where it stopped instead of page 0.
            ListFooterComponent={dismissedAppendFailed ? (
              <Pressable
                testID="address-book-dismissed-retry"
                onPress={() => { void loadDismissedPage(remoteQuery.trim(), dismissedItems.length, true); }}
                accessibilityRole="button"
                accessibilityLabel="Повторить загрузку списка уволенных"
                style={[styles.retryButton, { borderColor: tokens.borderSoft, backgroundColor: tokens.panelSolid }]}
              >
                <Text style={[styles.retryLabel, { color: tokens.primary }]}>
                  Не удалось загрузить список уволенных — Повторить
                </Text>
              </Pressable>
            ) : dismissedLoadingMore ? <AccountLoading tokens={tokens} /> : null}
            renderItem={renderAddressBookItem}
          />
        )
      ) : loading && items.length === 0 ? (
        <AccountLoading tokens={tokens} />
      ) : (
        <FlatList
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={7}
          style={styles.list}
          testID="address-book-entry-list"
          data={items}
          keyExtractor={(item, index) => getEntryKey(item, index)}
          keyboardShouldPersistTaps="handled"
          refreshing={refreshing}
          onRefresh={() => { void loadItems('refresh'); }}
          contentContainerStyle={[items.length === 0 ? styles.emptyList : null, { paddingBottom: listInset + 8 }]}
          ListEmptyComponent={(
            <Text style={[styles.empty, { color: tokens.textSecondary }]}>
              {listMode === 'favorites'
                ? (query.trim()
                  ? 'Среди избранных по текущему запросу никого не найдено.'
                  : 'В избранном пока никого нет — нажмите ★ у сотрудника.')
                : listMode === 'recent'
                  ? (query.trim()
                    ? 'Среди недавних по текущему запросу никого не найдено.'
                    : 'Недавних пока нет — откройте карточку сотрудника.')
                  : (query.trim()
                    ? 'По вашему запросу сотрудники не найдены.'
                    : 'В адресной книге пока нет записей.')}
            </Text>
          )}
          renderItem={renderAddressBookItem}
        />
      )}
      <AccountSubpage
        visible={Boolean(selectedItem)}
        title={selectedItem?.full_name || 'Сотрудник'}
        tokens={tokens}
        onClose={() => {
          setSelectedKey('');
          setSelectedItem(null);
        }}
      >
        {selectedItem ? (
          <>
            <AccountStatusText tokens={tokens} error={error} message={message} />
            <AddressBookEntryDetail
              item={selectedItem}
              query={query}
              tokens={tokens}
              onCopy={(value) => { void handleCopy(value); }}
              onCall={handleCall}
              onOpenTelegram={handleOpenTelegram}
              onOpenMax={(digits) => { void handleOpenMax(digits); }}
              onComposeEmail={handleComposeEmail}
              onOpenExternalMail={handleOpenExternalMail}
              showChatAction={canUseChat}
              chatBusy={Boolean(chatBusyKey)}
              onOpenChat={() => { void handleOpenChat(selectedItem, selectedIndex < 0 ? 0 : selectedIndex); }}
              isFavorite={!dismissedTab && favoriteSet.has(entryCode(selectedItem))}
              onToggleFavorite={!dismissedTab && entryCode(selectedItem) ? () => handleToggleFavorite(selectedItem) : undefined}
              dismissed={dismissedTab}
            />
          </>
        ) : null}
      </AccountSubpage>
    </AccountScreenScaffold>
  );
}

const styles = StyleSheet.create({
  headerAction: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  meta: { fontSize: 13, fontWeight: '700' },
  syncButton: {
    width: 44,
    height: 44,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -6,
    marginBottom: -6,
  },
  modesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginBottom: 8,
  },
  modeSegment: {
    flexGrow: 1,
    flexBasis: '28%',
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 6,
  },
  modeSegmentLabel: { fontSize: 13, fontWeight: '600' },
  modeClear: {
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  modeClearLabel: { fontSize: 13 },
  updated: { fontSize: 12, marginBottom: 10 },
  searchBox: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 8,
  },
  search: { flex: 1, minHeight: 40, fontSize: 15 },
  list: { flex: 1 },
  warning: { fontSize: 12, fontWeight: '600', marginBottom: 8 },
  emptyList: { flexGrow: 1, justifyContent: 'center', paddingVertical: 32 },
  empty: { textAlign: 'center', fontSize: 14 },
  retryButton: {
    alignSelf: 'center',
    minHeight: 44,
    minWidth: 120,
    borderWidth: 1,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    marginTop: 12,
  },
  retryLabel: { fontSize: 14, fontWeight: '600' },
});
