import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
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
  getAddressBookStatus,
  searchAddressBook,
  syncAddressBook,
  type AddressBookStatus,
} from '../../api/addressBookApi';
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
} from '../account/AccountChrome';
import { useFluentTokens } from '../../theme/fluentTokens';
import { AddressBookEntryDetail } from '../../addressBook/AddressBookEntryDetail';
import { AddressBookEntryRow } from '../../addressBook/AddressBookEntryRow';
import {
  formatDateTime,
  getEntryKey,
  isValidEmailRecipient,
  SEARCH_DEBOUNCE_MS,
  SEARCH_LIMIT,
  type AddressBookEntry,
} from '../../addressBook/addressBookFormat';
import { openExternalUrl, openTelegramChat } from '../../addressBook/messengerLinks';
import {
  getAddressBookChatErrorMessage,
  isAddressBookChatNotFound,
  openAddressBookChat,
} from '../../addressBook/openAddressBookChat';

const SEARCH_PLACEHOLDER = 'ФИО, должность, подразделение, город, телефон или e-mail';

function useDebouncedValue<T>(value: T, delayMs = SEARCH_DEBOUNCE_MS): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs, value]);
  return debounced;
}

export function NativeAddressBookScreen() {
  const { user, hasPermission } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const allowed = hasPermission('address_book.read');
  const isAdmin = isAdminUser(user);
  const canUseChat = NATIVE_CHAT_ENABLED && hasPermission('chat.read') && hasPermission('chat.write');

  const [query, setQuery] = useState('');
  const [items, setItems] = useState<AddressBookEntry[]>([]);
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
  const searchRequestRef = useRef(0);
  const debouncedQuery = useDebouncedValue(query);

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await getAddressBookStatus());
    } catch {
      // Status is optional; search still works.
    }
  }, []);

  const loadItems = useCallback(async (nextQuery: string, mode: 'load' | 'refresh' = 'load') => {
    const requestId = ++searchRequestRef.current;
    if (mode === 'refresh') setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const data = await searchAddressBook({ q: nextQuery, limit: SEARCH_LIMIT });
      if (requestId !== searchRequestRef.current) return;
      setItems(data.items);
      setTotal(data.total);
      setStatus((prev) => ({
        ...(prev || {}),
        updated_at: data.updated_at || prev?.updated_at || '',
        last_error: data.last_error || prev?.last_error || '',
      }));
    } catch (cause) {
      if (requestId !== searchRequestRef.current) return;
      setError(formatApiError(cause, 'Не удалось загрузить адресную книгу.'));
    } finally {
      if (requestId === searchRequestRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    if (allowed) void loadItems(debouncedQuery);
  }, [allowed, debouncedQuery, loadItems]);

  useEffect(() => {
    if (allowed) void loadStatus();
  }, [allowed, loadStatus]);

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
      await loadItems(debouncedQuery);
      setMessage('Адресная книга обновлена из 1С.');
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось обновить адресную книгу из 1С.'));
      await loadStatus();
    } finally {
      setSyncing(false);
    }
  }, [debouncedQuery, loadItems, loadStatus]);

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
    setChatBusyKey(entryKey);
    setError('');
    try {
      await openAddressBookChat(item);
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
  }, []);

  const countLabel = useMemo(() => (
    total > SEARCH_LIMIT ? `Найдено ${total}, показано ${SEARCH_LIMIT}` : `Найдено ${total}`
  ), [total]);

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

  if (selectedItem) {
    const selectedIndex = items.findIndex((item, index) => getEntryKey(item, index) === selectedKey);
    return (
      <AccountScreenScaffold
        title={selectedItem.full_name || 'Сотрудник'}
        tokens={tokens}
        onBack={() => {
          setSelectedKey('');
          setSelectedItem(null);
        }}
      >
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
        />
      </AccountScreenScaffold>
    );
  }

  return (
    <AccountScreenScaffold
      title="Адресная книга"
      tokens={tokens}
      scroll={false}
      rightAction={isAdmin ? (
        <Pressable
          testID="address-book-sync"
          onPress={() => { void handleSync(); }}
          disabled={syncing}
          accessibilityRole="button"
          accessibilityLabel="Обновить из 1С"
          style={styles.headerAction}
        >
          {syncing ? (
            <ActivityIndicator color={tokens.primary} />
          ) : (
            <MaterialCommunityIcons name="refresh" size={22} color={tokens.primary} />
          )}
        </Pressable>
      ) : undefined}
    >
      <Text style={[styles.count, { color: tokens.textSecondary }]}>{countLabel}</Text>
      <Text style={[styles.updated, { color: tokens.textTertiary }]}>
        Обновлено: {formatDateTime(status?.updated_at)}
      </Text>
      <View style={[styles.searchBox, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
        <MaterialCommunityIcons name="magnify" size={20} color={tokens.iconMuted} />
        <TextInput
          testID="address-book-search-input"
          value={query}
          onChangeText={setQuery}
          placeholder={SEARCH_PLACEHOLDER}
          placeholderTextColor={tokens.textTertiary}
          style={[styles.search, { color: tokens.textPrimary }]}
          accessibilityLabel="Поиск в адресной книге"
          returnKeyType="search"
        />
        {query ? (
          <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Очистить поиск">
            <MaterialCommunityIcons name="close" size={18} color={tokens.iconMuted} />
          </Pressable>
        ) : null}
      </View>
      <AccountStatusText tokens={tokens} error={error} message={message} />
      {status?.last_error ? (
        <Text style={[styles.warning, { color: tokens.warning }]}>
          Последняя синхронизация завершилась ошибкой: {status.last_error}
        </Text>
      ) : null}
      {loading && items.length === 0 ? (
        <AccountLoading tokens={tokens} />
      ) : (
        <FlatList
          style={styles.list}
          testID="address-book-entry-list"
          data={items}
          keyExtractor={(item, index) => getEntryKey(item, index)}
          keyboardShouldPersistTaps="handled"
          refreshing={refreshing}
          onRefresh={() => { void loadItems(debouncedQuery, 'refresh'); }}
          contentContainerStyle={items.length === 0 ? styles.emptyList : undefined}
          ListEmptyComponent={(
            <Text style={[styles.empty, { color: tokens.textSecondary }]}>
              {query.trim() ? 'По вашему запросу сотрудники не найдены.' : 'В адресной книге пока нет записей.'}
            </Text>
          )}
          renderItem={({ item, index }) => {
            const entryKey = getEntryKey(item, index);
            return (
              <AddressBookEntryRow
                item={item}
                entryKey={entryKey}
                query={query}
                tokens={tokens}
                showChatAction={canUseChat}
                chatBusy={chatBusyKey === entryKey}
                onSelect={() => {
                  setSelectedKey(entryKey);
                  setSelectedItem(item);
                  setMessage('');
                  setError('');
                }}
                onCall={handleCall}
                onOpenTelegram={handleOpenTelegram}
                onComposeEmail={handleComposeEmail}
                onOpenChat={() => { void handleOpenChat(item, index); }}
              />
            );
          }}
        />
      )}
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
  count: { fontSize: 13, fontWeight: '700', marginBottom: 2 },
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
});
