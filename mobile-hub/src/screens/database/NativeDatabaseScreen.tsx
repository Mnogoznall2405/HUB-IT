import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Clipboard from 'expo-clipboard';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  getCurrentDatabase,
  deleteConsumable,
  listRecentEquipmentCards,
  listRecentEquipmentActs,
  listAvailableDatabases,
  listConsumables,
  listEquipment,
  searchEquipment,
  searchEquipmentActs,
  switchDatabase,
  touchRecentEquipmentAct,
  touchRecentEquipmentCard,
  updateConsumableQuantity,
  type ConsumableRecord,
  type CurrentDatabase,
  type EquipmentAct,
  type EquipmentRecord,
  type RecentEquipmentCard,
  type RecentEquipmentAct,
} from '../../api/databaseApi';
import { formatApiError } from '../../api/formatError';
import { useAuth } from '../../auth/AuthContext';
import { NativeEquipmentActCard } from '../../components/database/NativeEquipmentActCard';
import { NativeDatabaseActUploadModal } from '../../components/database/NativeDatabaseActUploadModal';
import { NativeDatabaseCreateModal } from '../../components/database/NativeDatabaseCreateModal';
import { NativeDatabaseQrScannerModal } from '../../components/database/NativeDatabaseQrScannerModal';
import { NativeConsumableRow } from '../../components/database/NativeConsumableRow';
import { NativeEquipmentActions } from '../../components/database/NativeEquipmentActions';
import { NativeEquipmentRow } from '../../components/database/NativeEquipmentRow';
import { openNativeFile } from '../../files/nativeAttachmentDownloads';
import { downloadEquipmentAct } from '../../database/nativeDatabaseFiles';
import { nativeEquipmentDestination } from '../../database/nativeDatabaseFeature';
import { filterConsumables, parseInventoryQrPayload, type DatabaseViewMode, type InventoryQrPayload } from '../../database/nativeDatabaseModel';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens } from '../../theme/fluentTokens';
import { AccountScreenScaffold, AccountSectionCard } from '../account/AccountChrome';

const SEARCH_DEBOUNCE_MS = 500;
const SEARCH_LIMIT = 50;

function first(value: string | string[] | undefined): string {
  return String(Array.isArray(value) ? value[0] : value || '').trim();
}

function useDebouncedValue(value: string): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value]);
  return debounced;
}

export function NativeDatabaseScreen() {
  const params = useLocalSearchParams<{ q?: string | string[]; mode?: string | string[] }>();
  const { hasPermission, offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const accentColor = tokens.scheme === 'dark' ? tokens.primaryLight : tokens.primary;
  const allowed = hasPermission('database.read');
  const canWrite = hasPermission('database.write');
  const canDelete = hasPermission('database.delete');
  const [query, setQuery] = useState(first(params.q));
  const initialMode = first(params.mode);
  const [mode, setMode] = useState<DatabaseViewMode>(initialMode === 'acts' || initialMode === 'consumables' ? initialMode : 'equipment');
  const [databases, setDatabases] = useState<Awaited<ReturnType<typeof listAvailableDatabases>>>([]);
  const [currentDatabase, setCurrentDatabase] = useState<CurrentDatabase | null>(null);
  const [equipment, setEquipment] = useState<EquipmentRecord[]>([]);
  const [consumables, setConsumables] = useState<ConsumableRecord[]>([]);
  const [acts, setActs] = useState<EquipmentAct[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMoreEquipment, setHasMoreEquipment] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [bootstrapReady, setBootstrapReady] = useState(false);
  const [switchingDatabase, setSwitchingDatabase] = useState('');
  const [busyAct, setBusyAct] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [quantityItem, setQuantityItem] = useState<ConsumableRecord | null>(null);
  const [quantityDraft, setQuantityDraft] = useState('');
  const [quantityBusy, setQuantityBusy] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteItem, setDeleteItem] = useState<ConsumableRecord | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [recentCards, setRecentCards] = useState<RecentEquipmentCard[]>([]);
  const [recentActs, setRecentActs] = useState<RecentEquipmentAct[]>([]);
  const [selectedInvNos, setSelectedInvNos] = useState<Set<string>>(() => new Set());
  const [uploadActOpen, setUploadActOpen] = useState(false);
  const [qrScannerOpen, setQrScannerOpen] = useState(false);
  const requestRef = useRef(0);
  const equipmentPageRef = useRef(1);
  const debouncedQuery = useDebouncedValue(query.trim());
  const contentQuery = mode === 'consumables' ? '' : debouncedQuery;
  const visibleConsumables = useMemo(
    () => filterConsumables(consumables, debouncedQuery),
    [consumables, debouncedQuery],
  );
  const selectedEquipment = useMemo(
    () => equipment.filter((item) => selectedInvNos.has(item.inv_no)),
    [equipment, selectedInvNos],
  );
  const selectionMode = selectedEquipment.length > 0;

  useEffect(() => {
    setSelectedInvNos(new Set());
  }, [currentDatabase?.id, mode]);

  useEffect(() => {
    const visible = new Set(equipment.map((item) => item.inv_no));
    setSelectedInvNos((current) => {
      const next = new Set([...current].filter((invNo) => visible.has(invNo)));
      return next.size === current.size ? current : next;
    });
  }, [equipment]);

  const bootstrap = useCallback(async () => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [available, current] = await Promise.all([
        listAvailableDatabases(),
        getCurrentDatabase(),
      ]);
      setDatabases(available);
      setCurrentDatabase(current);
      setBootstrapReady(true);
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось загрузить доступные базы данных.'));
    } finally {
      setLoading(false);
    }
  }, [allowed]);

  useEffect(() => { void bootstrap(); }, [bootstrap]);

  useEffect(() => {
    if (!currentDatabase?.id || offlineMode) return;
    let active = true;
    void Promise.all([
      listRecentEquipmentCards(8, currentDatabase.id),
      listRecentEquipmentActs(8, currentDatabase.id),
    ]).then(([cards, actItems]) => {
      if (!active) return;
      setRecentCards(cards);
      setRecentActs(actItems);
    }).catch(() => {
      if (!active) return;
      setRecentCards([]);
      setRecentActs([]);
    });
    return () => { active = false; };
  }, [currentDatabase?.id, offlineMode]);

  const loadContent = useCallback(async (refresh = false, append = false) => {
    if (!allowed || !bootstrapReady || !currentDatabase?.id) return;
    const requestId = ++requestRef.current;
    if (refresh) setRefreshing(true);
    else if (append) setLoadingMore(true);
    else setLoading(true);
    setError('');
    setNotice('');
    try {
      if (mode === 'equipment') {
        const targetPage = append ? equipmentPageRef.current + 1 : 1;
        const result = debouncedQuery.length >= 2
          ? await searchEquipment(debouncedQuery, targetPage, SEARCH_LIMIT, currentDatabase.id)
          : await listEquipment(targetPage, SEARCH_LIMIT, currentDatabase.id);
        if (requestId !== requestRef.current) return;
        setEquipment((current) => append
          ? [...current, ...result.equipment.filter((item) => !current.some((old) => old.inv_no === item.inv_no))]
          : result.equipment);
        equipmentPageRef.current = result.page;
        setHasMoreEquipment(result.page < result.pages);
        setConsumables([]);
        setActs([]);
        setTotal(result.total);
      } else if (mode === 'consumables') {
        const result = await listConsumables({
          onlyPositiveQty: true,
          limit: 1000,
          databaseId: currentDatabase.id,
        });
        if (requestId !== requestRef.current) return;
        setConsumables(result.consumables);
        setHasMoreEquipment(false);
        setEquipment([]);
        setActs([]);
        setTotal(result.total);
        if (result.truncated) setNotice('Показаны первые 1000 позиций с положительным остатком. Уточните фильтр.');
      } else {
        const result = await searchEquipmentActs(debouncedQuery, SEARCH_LIMIT, currentDatabase.id);
        if (requestId !== requestRef.current) return;
        setActs(result.acts);
        setHasMoreEquipment(false);
        setEquipment([]);
        setConsumables([]);
        setTotal(result.total);
        if (result.truncated) setNotice('Показаны первые 50 актов. Уточните запрос.');
      }
    } catch (cause) {
      if (requestId === requestRef.current) {
        setError(formatApiError(cause, mode === 'acts' ? 'Не удалось загрузить акты.' : mode === 'consumables' ? 'Не удалось загрузить расходники.' : 'Не удалось найти оборудование.'));
      }
    } finally {
      if (requestId === requestRef.current) {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    }
  }, [allowed, bootstrapReady, currentDatabase?.id, contentQuery, mode]);

  useEffect(() => { void loadContent(); }, [loadContent]);

  const changeDatabase = useCallback(async (databaseId: string) => {
    if (!databaseId || databaseId === currentDatabase?.id || currentDatabase?.locked || switchingDatabase) return;
    requestRef.current += 1;
    setSwitchingDatabase(databaseId);
    setError('');
    try {
      const selected = await switchDatabase(databaseId);
      setCurrentDatabase(selected);
      setQuery('');
      setEquipment([]);
      equipmentPageRef.current = 1;
      setHasMoreEquipment(false);
      setConsumables([]);
      setActs([]);
      setTotal(0);
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось переключить базу данных.'));
    } finally {
      setSwitchingDatabase('');
    }
  }, [currentDatabase?.id, currentDatabase?.locked, switchingDatabase]);

  const openEquipment = useCallback((item: EquipmentRecord | string) => {
    const invNo = typeof item === 'string' ? item : item.inv_no;
    const snapshot = typeof item === 'string' ? null : item;
    if (!invNo) return;
    if (snapshot) void touchRecentEquipmentCard(invNo, snapshot, 'view', currentDatabase?.id).catch(() => undefined);
    router.push(nativeEquipmentDestination(invNo, 'general', currentDatabase?.id) as never);
  }, [currentDatabase?.id]);

  const openEquipmentFromQr = useCallback((payload: InventoryQrPayload) => {
    setQrScannerOpen(false);
    setError('');
    router.push(nativeEquipmentDestination(
      payload.inventoryNumber,
      'general',
      payload.databaseId || currentDatabase?.id,
    ) as never);
  }, [currentDatabase?.id]);

  const toggleEquipmentSelection = useCallback((invNo: string) => {
    setSelectedInvNos((current) => {
      const next = new Set(current);
      if (next.has(invNo)) next.delete(invNo);
      else next.add(invNo);
      return next;
    });
  }, []);

  const openActFile = useCallback(async (act: EquipmentAct) => {
    if (busyAct !== null) return;
    setBusyAct(act.doc_no);
    setError('');
    try {
      const firstItem = act.items[0];
      const file = await downloadEquipmentAct(act.doc_no, {
        itemId: firstItem?.item_id,
        invNo: firstItem?.inv_no,
        fileName: `act-${act.doc_number || act.doc_no}.pdf`,
        databaseId: currentDatabase?.id,
      });
      await openNativeFile(file, 'application/pdf');
      void touchRecentEquipmentAct(act, 'file', currentDatabase?.id).catch(() => undefined);
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось открыть файл акта.'));
    } finally {
      setBusyAct(null);
    }
  }, [busyAct, currentDatabase?.id]);

  const saveQuantity = useCallback(async () => {
    if (!quantityItem || quantityBusy || offlineMode) return;
    const qty = Number(quantityDraft.trim());
    if (!Number.isInteger(qty) || qty < 0) {
      setError('Количество должно быть целым неотрицательным числом.');
      return;
    }
    setQuantityBusy(true);
    setError('');
    try {
      await updateConsumableQuantity(quantityItem, qty, currentDatabase?.id);
      setConsumables((current) => current.map((item) => item.id === quantityItem.id ? { ...item, qty } : item));
      setQuantityItem(null);
      setNotice('Остаток расходника обновлён.');
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось изменить остаток расходника.'));
    } finally {
      setQuantityBusy(false);
    }
  }, [currentDatabase?.id, offlineMode, quantityBusy, quantityDraft, quantityItem]);

  const pasteInventoryCode = useCallback(async () => {
    if (offlineMode) return;
    const payload = parseInventoryQrPayload(await Clipboard.getStringAsync());
    if (!payload) {
      setError('В буфере нет поддерживаемого инвентарного QR-кода.');
      return;
    }
    openEquipmentFromQr(payload);
  }, [offlineMode, openEquipmentFromQr]);

  const confirmDeleteConsumable = useCallback(async () => {
    if (!deleteItem || deleteBusy || offlineMode || !canDelete) return;
    setDeleteBusy(true);
    setError('');
    try {
      await deleteConsumable(deleteItem.id, currentDatabase?.id);
      setConsumables((current) => current.filter((item) => item.id !== deleteItem.id));
      setDeleteItem(null);
      setNotice('Расходник удалён.');
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось удалить расходник.'));
    } finally {
      setDeleteBusy(false);
    }
  }, [canDelete, currentDatabase?.id, deleteBusy, deleteItem, offlineMode]);

  const listLength = mode === 'equipment' ? equipment.length : mode === 'consumables' ? visibleConsumables.length : acts.length;
  const displayTotal = mode === 'consumables' ? visibleConsumables.length : total;
  const emptyMessage = useMemo(() => {
    if (loading) return '';
    if (mode === 'equipment') return debouncedQuery ? 'По вашему запросу оборудование не найдено.' : 'В этой базе пока нет оборудования.';
    if (mode === 'consumables') return debouncedQuery ? 'По вашему запросу расходники не найдены.' : 'В этой базе нет расходников с положительным остатком.';
    return debouncedQuery ? 'По вашему запросу ничего не найдено.' : 'В этой базе пока нет доступных актов.';
  }, [debouncedQuery, loading, mode]);

  if (!allowed) {
    return (
      <AccountScreenScaffold title="Инвентарь" tokens={tokens}>
        <AccountSectionCard tokens={tokens} title="Нет доступа" description="Для раздела нужно право database.read.">{null}</AccountSectionCard>
      </AccountScreenScaffold>
    );
  }

  return (
    <AccountScreenScaffold
      title="Инвентарь"
      tokens={tokens}
      scroll={false}
    >
      {offlineMode ? <Text accessibilityRole="alert" style={[styles.warning, { color: tokens.warning }]}>Автономный режим: поиск и переключение базы недоступны.</Text> : null}
      {error ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{error}</Text> : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={[styles.notice, { color: tokens.textSecondary }]}>{notice}</Text> : null}

      <View style={styles.databaseHeading}>
        <Text style={[styles.databaseLabel, { color: tokens.textSecondary }]}>База данных</Text>
        {currentDatabase?.locked ? (
          <View style={[styles.lockBadge, { backgroundColor: tokens.panelInset }]}>
            <MaterialCommunityIcons name="lock-outline" size={14} color={tokens.iconMuted} />
            <Text style={[styles.lockText, { color: tokens.textSecondary }]}>закреплена</Text>
          </View>
        ) : null}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.databaseStrip}
        accessibilityRole="tablist"
        accessibilityLabel="Выбор базы данных"
        accessibilityHint="Проведите в сторону, чтобы увидеть остальные базы"
      >
        {databases.map((database) => {
          const selected = database.id === currentDatabase?.id;
          const busy = switchingDatabase === database.id;
          const disabled = offlineMode || Boolean(switchingDatabase) || Boolean(currentDatabase?.locked);
          return (
            <Pressable
              key={database.id}
              testID={`native-database-option-${database.id}`}
              onPress={() => { void changeDatabase(database.id); }}
              disabled={disabled || selected}
              accessibilityRole="tab"
              accessibilityState={{ selected, disabled: disabled || selected, busy }}
              accessibilityLabel={`${database.name}${selected ? ', выбрана' : ''}`}
              style={[styles.databaseChip, { backgroundColor: selected ? tokens.primary : tokens.panelSolid, borderColor: selected ? tokens.primary : tokens.border }]}
            >
              {busy ? <ActivityIndicator size="small" color={selected ? '#fff' : accentColor} /> : null}
              <Text numberOfLines={1} style={[styles.databaseText, { color: selected ? '#fff' : tokens.textPrimary }]}>{database.name}</Text>
              {selected && currentDatabase?.locked ? <MaterialCommunityIcons name="lock-outline" size={15} color="#fff" /> : null}
            </Pressable>
          );
        })}
      </ScrollView>

      {!query.trim() && (mode === 'acts' ? recentActs.length : recentCards.length) ? (
        <View style={styles.recentSection}>
          <Text style={[styles.recentLabel, { color: tokens.textSecondary }]}>Недавние</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.recentStrip}
            accessibilityLabel="Недавно открытые карточки"
            accessibilityHint="Проведите в сторону, чтобы увидеть остальные карточки"
          >
            {(mode === 'acts' ? recentActs : recentCards).map((recent) => 'doc_no' in recent ? (
              <Pressable
                key={`${recent.db_id}:${recent.doc_no}`}
                testID={`native-database-recent-act-${recent.doc_no}`}
                accessibilityRole="button"
                accessibilityLabel={`Открыть недавний акт ${recent.doc_number || recent.doc_no}`}
                onPress={() => { if (recent.snapshot) void openActFile(recent.snapshot); }}
                disabled={!recent.snapshot}
                style={[styles.recentCard, { backgroundColor: tokens.panelSolid, borderColor: tokens.border, opacity: recent.snapshot ? 1 : 0.55 }]}
              >
                <Text numberOfLines={2} style={[styles.recentTitle, { color: tokens.textPrimary }]}>Акт {recent.doc_number || recent.doc_no}</Text>
                <Text numberOfLines={1} style={[styles.recentMeta, { color: tokens.textSecondary }]}>{recent.last_action_label || 'Просмотрено'}</Text>
              </Pressable>
            ) : (
              <Pressable
                key={`${recent.db_id}:${recent.inv_no}`}
                testID={`native-database-recent-${recent.inv_no}`}
                accessibilityRole="button"
                accessibilityLabel={`Открыть недавнюю карточку ${recent.inv_no}`}
                onPress={() => openEquipment(recent.snapshot || recent.inv_no)}
                style={[styles.recentCard, { backgroundColor: tokens.panelSolid, borderColor: tokens.border }]}
              >
                <Text numberOfLines={2} style={[styles.recentTitle, { color: tokens.textPrimary }]}>{recent.snapshot?.model_name || `Инв. № ${recent.inv_no}`}</Text>
                <Text numberOfLines={1} style={[styles.recentMeta, { color: tokens.textSecondary }]}>{recent.last_action_label || 'Просмотрено'}</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      ) : null}

      <View style={[styles.modeTabs, { backgroundColor: tokens.panelInset }]} accessibilityRole="tablist">
        {(['equipment', 'consumables', 'acts'] as const).map((value) => {
          const selected = mode === value;
          return (
            <Pressable
              key={value}
              testID={`native-database-mode-${value}`}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => setMode(value)}
              style={[styles.modeTab, { backgroundColor: selected ? tokens.panelSolid : 'transparent' }]}
            >
              <Text numberOfLines={2} style={[styles.modeText, { color: selected ? accentColor : tokens.textSecondary }]}>
                {value === 'equipment' ? 'Оборудование' : value === 'consumables' ? 'Расходники' : 'Акты'}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.searchRow}>
        <View style={[styles.searchBox, { backgroundColor: tokens.panelSolid, borderColor: tokens.border }]}>
          <MaterialCommunityIcons name="magnify" size={22} color={tokens.iconMuted} />
          <TextInput
            testID="native-database-search"
            value={query}
            onChangeText={setQuery}
            editable={!offlineMode}
            placeholder={mode === 'acts' ? 'Номер акта или сотрудник' : mode === 'consumables' ? 'Модель, P/N, размещение' : 'Инв. №, S/N, модель, сотрудник'}
            placeholderTextColor={tokens.textTertiary}
            accessibilityLabel={mode === 'acts' ? 'Поиск актов' : mode === 'consumables' ? 'Фильтр расходников' : 'Поиск оборудования'}
            returnKeyType="search"
            style={[styles.searchInput, { color: tokens.textPrimary }]}
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Очистить поиск" hitSlop={4} style={styles.clearButton}>
              <MaterialCommunityIcons name="close" size={20} color={tokens.iconMuted} />
            </Pressable>
          ) : null}
        </View>
        <Pressable
          testID="native-database-scan-qr"
          onPress={() => setQrScannerOpen(true)}
          disabled={offlineMode}
          accessibilityRole="button"
          accessibilityLabel="Сканировать инвентарный QR-код камерой"
          accessibilityState={{ disabled: offlineMode }}
          style={[styles.searchAction, { backgroundColor: tokens.panelSolid, borderColor: tokens.border, opacity: offlineMode ? 0.5 : 1 }]}
        >
          <MaterialCommunityIcons name="qrcode-scan" size={22} color={accentColor} />
        </Pressable>
        <Pressable
          testID="native-database-paste-qr"
          onPress={() => { void pasteInventoryCode(); }}
          disabled={offlineMode}
          accessibilityRole="button"
          accessibilityLabel="Вставить инвентарный QR-код из буфера"
          accessibilityState={{ disabled: offlineMode }}
          style={[styles.searchAction, { backgroundColor: tokens.panelSolid, borderColor: tokens.border, opacity: offlineMode ? 0.5 : 1 }]}
        >
          <MaterialCommunityIcons name="content-paste" size={21} color={accentColor} />
        </Pressable>
      </View>

      <View style={styles.countRow}>
        <Text accessibilityLiveRegion="polite" style={[styles.count, { color: tokens.textSecondary }]}> 
          {mode === 'acts' ? `Актов: ${displayTotal}` : mode === 'consumables' ? `Расходников: ${displayTotal}` : `Найдено: ${displayTotal}`}
        </Text>
        <View style={styles.countActions}>
          {canWrite && mode !== 'acts' ? (
            <Pressable testID="native-database-create" onPress={() => setCreateOpen(true)} disabled={offlineMode} accessibilityRole="button" accessibilityLabel={mode === 'consumables' ? 'Добавить расходник' : 'Добавить оборудование'} accessibilityState={{ disabled: offlineMode }} style={[styles.resultAction, { borderColor: tokens.border, opacity: offlineMode ? 0.5 : 1 }]}>
              <MaterialCommunityIcons name="plus" size={19} color={accentColor} />
              <Text style={[styles.resultActionText, { color: accentColor }]}>Добавить</Text>
            </Pressable>
          ) : null}
          {canWrite && mode === 'acts' ? (
            <Pressable testID="native-database-upload-act" onPress={() => setUploadActOpen(true)} disabled={offlineMode} accessibilityRole="button" accessibilityLabel="Загрузить подписанный PDF-акт" accessibilityState={{ disabled: offlineMode }} style={[styles.resultAction, { borderColor: tokens.border, opacity: offlineMode ? 0.5 : 1 }]}>
              <MaterialCommunityIcons name="file-upload-outline" size={19} color={accentColor} />
              <Text style={[styles.resultActionText, { color: accentColor }]}>Загрузить</Text>
            </Pressable>
          ) : null}
          <Pressable testID="native-database-refresh" onPress={() => { void loadContent(true); }} disabled={loading || offlineMode} accessibilityRole="button" accessibilityLabel="Обновить результаты" accessibilityState={{ disabled: loading || offlineMode }} style={[styles.resultAction, { borderColor: tokens.border, opacity: loading || offlineMode ? 0.5 : 1 }]}>
            <MaterialCommunityIcons name="refresh" size={19} color={accentColor} />
            <Text style={[styles.resultActionText, { color: accentColor }]}>Обновить</Text>
          </Pressable>
        </View>
      </View>

      {mode === 'equipment' && selectionMode ? (
        <View testID="native-database-selection" style={[styles.selectionPanel, { backgroundColor: tokens.panelInset, borderColor: tokens.border }]}> 
          <View style={styles.selectionHeader}>
            <Text accessibilityLiveRegion="polite" style={[styles.selectionTitle, { color: tokens.textPrimary }]}>Выбрано: {selectedEquipment.length}</Text>
            <Pressable testID="native-database-selection-clear" accessibilityRole="button" accessibilityLabel="Снять выбор со всех карточек" onPress={() => setSelectedInvNos(new Set())} style={styles.selectionClear}>
              <MaterialCommunityIcons name="close" size={19} color={tokens.iconMuted} />
              <Text style={[styles.selectionClearText, { color: tokens.textSecondary }]}>Снять</Text>
            </Pressable>
          </View>
          <Text style={[styles.selectionHint, { color: tokens.textSecondary }]}>Групповые операции выполняются сервером одним запросом. Обслуживание остаётся доступно только в отдельной карточке.</Text>
          <NativeEquipmentActions
            equipment={selectedEquipment[0]}
            targets={selectedEquipment}
            databaseId={currentDatabase?.id}
            canWrite={canWrite}
            canDeleteEquipment={false}
            offline={offlineMode}
            surface="general"
            tokens={tokens}
            testIDPrefix="native-database-bulk"
            onChanged={() => loadContent(true)}
            onDeleted={() => undefined}
          />
        </View>
      ) : null}

      {loading && listLength === 0 ? (
        <View style={styles.loading}><ActivityIndicator color={accentColor} /></View>
      ) : mode === 'equipment' ? (
        <FlatList
          testID="native-database-results"
          data={equipment}
          keyExtractor={(item) => `e:${item.inv_no}`}
          keyboardShouldPersistTaps="handled"
          refreshing={refreshing}
          onRefresh={() => { void loadContent(true); }}
          onEndReached={() => { if (hasMoreEquipment && !loadingMore && !loading) void loadContent(false, true); }}
          onEndReachedThreshold={0.35}
          contentContainerStyle={equipment.length ? styles.listContent : styles.emptyContent}
          ListEmptyComponent={<Text style={[styles.empty, { color: tokens.textSecondary }]}>{emptyMessage}</Text>}
          ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.footer} color={accentColor} /> : null}
          renderItem={({ item }) => (
            <NativeEquipmentRow
              item={item}
              tokens={tokens}
              selectionMode={selectionMode}
              selected={selectedInvNos.has(item.inv_no)}
              onLongPress={canWrite && !offlineMode ? () => toggleEquipmentSelection(item.inv_no) : undefined}
              onPress={() => selectionMode ? toggleEquipmentSelection(item.inv_no) : openEquipment(item)}
            />
          )}
        />
      ) : mode === 'consumables' ? (
        <FlatList
          testID="native-database-results"
          data={visibleConsumables}
          keyExtractor={(item) => `c:${item.id}`}
          keyboardShouldPersistTaps="handled"
          refreshing={refreshing}
          onRefresh={() => { void loadContent(true); }}
          contentContainerStyle={visibleConsumables.length ? styles.listContent : styles.emptyContent}
          ListEmptyComponent={<Text style={[styles.empty, { color: tokens.textSecondary }]}>{emptyMessage}</Text>}
          renderItem={({ item }) => (
            <NativeConsumableRow
              item={item}
              tokens={tokens}
              onEditQuantity={canWrite && !offlineMode ? () => { setQuantityItem(item); setQuantityDraft(String(item.qty)); } : undefined}
              onDelete={canDelete && !offlineMode ? () => setDeleteItem(item) : undefined}
            />
          )}
        />
      ) : (
        <FlatList
          testID="native-database-results"
          data={acts}
          keyExtractor={(item) => `a:${item.doc_no}`}
          keyboardShouldPersistTaps="handled"
          refreshing={refreshing}
          onRefresh={() => { void loadContent(true); }}
          contentContainerStyle={acts.length ? styles.listContent : styles.emptyContent}
          ListEmptyComponent={<Text style={[styles.empty, { color: tokens.textSecondary }]}>{emptyMessage}</Text>}
          renderItem={({ item }) => (
            <NativeEquipmentActCard
              act={item}
              tokens={tokens}
              fileBusy={busyAct === item.doc_no}
              onOpenEquipment={openEquipment}
              onOpenFile={() => { void openActFile(item); }}
            />
          )}
        />
      )}
      <Modal
        visible={Boolean(quantityItem)}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!quantityBusy) setQuantityItem(null); }}
        accessibilityViewIsModal
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.quantityDialog, { backgroundColor: tokens.panelSolid, borderColor: tokens.border }]}> 
            <Text accessibilityRole="header" style={[styles.quantityTitle, { color: tokens.textPrimary }]}>Остаток расходника</Text>
            <Text numberOfLines={2} style={[styles.quantityDescription, { color: tokens.textSecondary }]}>{quantityItem?.model_name || quantityItem?.type_name || quantityItem?.inv_no}</Text>
            <TextInput
              testID="native-consumable-quantity-input"
              value={quantityDraft}
              onChangeText={setQuantityDraft}
              editable={!quantityBusy}
              keyboardType="number-pad"
              accessibilityLabel="Новое количество"
              style={[styles.quantityInput, { color: tokens.textPrimary, borderColor: tokens.border, backgroundColor: tokens.pageBg }]}
            />
            <View style={styles.dialogActions}>
              <Pressable disabled={quantityBusy} accessibilityRole="button" onPress={() => setQuantityItem(null)} style={styles.dialogButton}><Text style={[styles.dialogButtonText, { color: tokens.textSecondary }]}>Отмена</Text></Pressable>
              <Pressable testID="native-consumable-quantity-save" disabled={quantityBusy} accessibilityRole="button" accessibilityState={{ disabled: quantityBusy }} onPress={() => { void saveQuantity(); }} style={[styles.dialogButton, { backgroundColor: tokens.primary }]}>
                {quantityBusy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={[styles.dialogButtonText, { color: '#fff' }]}>Сохранить</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        visible={Boolean(deleteItem)}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!deleteBusy) setDeleteItem(null); }}
        accessibilityViewIsModal
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.quantityDialog, { backgroundColor: tokens.panelSolid, borderColor: tokens.border }]}> 
            <Text accessibilityRole="header" style={[styles.quantityTitle, { color: tokens.error }]}>Удалить расходник?</Text>
            <Text style={[styles.quantityDescription, { color: tokens.textSecondary }]}>{deleteItem?.model_name || deleteItem?.type_name || deleteItem?.inv_no}</Text>
            <Text style={[styles.deleteHint, { color: tokens.textSecondary }]}>Удаление необратимо. Сервер отклонит запрос, если позиция связана с другими данными.</Text>
            <View style={styles.dialogActions}>
              <Pressable disabled={deleteBusy} accessibilityRole="button" onPress={() => setDeleteItem(null)} style={styles.dialogButton}><Text style={[styles.dialogButtonText, { color: tokens.textSecondary }]}>Отмена</Text></Pressable>
              <Pressable testID="native-consumable-delete-confirm" disabled={deleteBusy} accessibilityRole="button" accessibilityState={{ disabled: deleteBusy }} onPress={() => { void confirmDeleteConsumable(); }} style={[styles.dialogButton, { backgroundColor: tokens.error }]}> 
                {deleteBusy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={[styles.dialogButtonText, { color: '#fff' }]}>Удалить</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <NativeDatabaseCreateModal
        visible={createOpen}
        initialKind={mode === 'consumables' ? 'consumable' : 'equipment'}
        databaseId={currentDatabase?.id}
        tokens={tokens}
        onClose={() => setCreateOpen(false)}
        onCreated={async (message, createdInvNo) => {
          setNotice(message);
          await loadContent(true);
          if (createdInvNo && mode === 'equipment') openEquipment(createdInvNo);
        }}
      />
      <NativeDatabaseActUploadModal
        visible={uploadActOpen}
        databaseId={currentDatabase?.id}
        offline={offlineMode}
        tokens={tokens}
        onClose={() => setUploadActOpen(false)}
        onCommitted={async (message) => {
          setNotice(message);
          await loadContent(true);
          if (currentDatabase?.id) {
            const latest = await listRecentEquipmentActs(8, currentDatabase.id).catch(() => []);
            setRecentActs(latest);
          }
        }}
      />
      <NativeDatabaseQrScannerModal
        visible={qrScannerOpen}
        tokens={tokens}
        onClose={() => setQrScannerOpen(false)}
        onScanned={openEquipmentFromQr}
      />
    </AccountScreenScaffold>
  );
}

const styles = StyleSheet.create({
  headerAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  warning: { marginBottom: 7, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  error: { marginBottom: 7, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  notice: { marginBottom: 7, fontSize: 12, lineHeight: 17, fontWeight: '600' },
  databaseHeading: { minHeight: 24, marginBottom: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  databaseLabel: { fontSize: 12, lineHeight: 17, fontWeight: '800' },
  lockBadge: { minHeight: 24, borderRadius: 12, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 4 },
  lockText: { fontSize: 10, lineHeight: 14, fontWeight: '700' },
  databaseStrip: { gap: 8, paddingRight: 20, paddingBottom: 9 },
  databaseChip: { minHeight: 44, maxWidth: 260, borderRadius: 22, borderWidth: 1, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 7 },
  databaseText: { flexShrink: 1, fontSize: 13, lineHeight: 18, fontWeight: '800' },
  recentSection: { marginBottom: 9 },
  recentLabel: { marginBottom: 6, fontSize: 12, lineHeight: 17, fontWeight: '800' },
  recentStrip: { gap: 8, paddingRight: 20, paddingBottom: 2 },
  recentCard: { width: 184, minHeight: 68, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, justifyContent: 'center' },
  recentTitle: { fontSize: 13, lineHeight: 17, fontWeight: '800' },
  recentMeta: { marginTop: 3, fontSize: 11, lineHeight: 15 },
  modeTabs: { minHeight: 48, borderRadius: 12, padding: 3, flexDirection: 'row', alignItems: 'stretch', marginBottom: 9 },
  modeTab: { flex: 1, minHeight: 42, borderRadius: 10, paddingHorizontal: 4, paddingVertical: 7, alignItems: 'center', justifyContent: 'center' },
  modeText: { flexShrink: 1, textAlign: 'center', fontSize: 13, lineHeight: 17, fontWeight: '800' },
  searchRow: { flexDirection: 'row', alignItems: 'stretch', gap: 7 },
  searchBox: { flex: 1, minWidth: 0, minHeight: 48, borderRadius: 13, borderWidth: 1, paddingLeft: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, minWidth: 0, minHeight: 46, paddingVertical: 8, fontSize: 16, lineHeight: 21 },
  clearButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  searchAction: { width: 48, minHeight: 48, borderRadius: 13, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  countRow: { minHeight: 52, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  count: { flexGrow: 1, fontSize: 12, lineHeight: 17, fontWeight: '700', fontVariant: ['tabular-nums'] },
  countActions: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'flex-end', gap: 6 },
  resultAction: { minHeight: 44, borderRadius: 11, borderWidth: 1, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  resultActionText: { fontSize: 12, lineHeight: 16, fontWeight: '800' },
  selectionPanel: { borderWidth: 1, borderRadius: 14, padding: 11, marginBottom: 9 },
  selectionHeader: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  selectionTitle: { fontSize: 14, fontWeight: '900' },
  selectionClear: { minHeight: 44, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 5 },
  selectionClearText: { fontSize: 12, fontWeight: '800' },
  selectionHint: { marginBottom: 9, fontSize: 11, lineHeight: 16 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingBottom: 8 },
  emptyContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, paddingBottom: 60 },
  empty: { textAlign: 'center', fontSize: 14, lineHeight: 20 },
  footer: { paddingVertical: 16 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.42)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  quantityDialog: { width: '100%', maxWidth: 420, borderWidth: 1, borderRadius: 18, padding: 18 },
  quantityTitle: { fontSize: 18, fontWeight: '900' },
  quantityDescription: { marginTop: 5, fontSize: 13, lineHeight: 18 },
  deleteHint: { marginTop: 9, fontSize: 12, lineHeight: 17 },
  quantityInput: { minHeight: 50, marginTop: 16, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 18, fontWeight: '800' },
  dialogActions: { marginTop: 18, flexDirection: 'row', justifyContent: 'flex-end', gap: 9 },
  dialogButton: { minWidth: 104, minHeight: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  dialogButtonText: { fontSize: 13, fontWeight: '900' },
});
