import { NativeModal as Modal } from '../../components/ui/NativeModal';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import axios from 'axios';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  type ListRenderItemInfo,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import {
  getCurrentDatabase,
  consumeConsumableStock,
  deleteConsumable,
  getConsumableById,
  listCompatiblePrinterModels,
  listRecentEquipmentCards,
  listRecentEquipmentActs,
  listAvailableDatabases,
  listConsumables,
  listEquipment,
  getEquipment,
  recordEquipmentWork,
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
  type TransferResult,
} from '../../api/databaseApi';
import { formatApiError } from '../../api/formatError';
import { useAuth } from '../../auth/AuthContext';
import {
  readNativeCollectionSnapshot,
  readNativeSnapshot,
  writeNativeCollectionSnapshot,
  writeNativeEntitySnapshot,
  writeNativeSnapshot,
} from '../../cache/nativeSnapshotCache';
import { readNativeEquipmentCatalogSnapshot } from '../../cache/nativeEquipmentCatalogSnapshot';
import { chatKeyboardAvoidingProps } from '../../chat/chatKeyboard';
import { NativeEquipmentActCard } from '../../components/database/NativeEquipmentActCard';
import { NativeDatabaseActUploadModal } from '../../components/database/NativeDatabaseActUploadModal';
import { NativeDatabaseCreateModal } from '../../components/database/NativeDatabaseCreateModal';
import { NativeDatabaseQrScannerModal } from '../../components/database/NativeDatabaseQrScannerModal';
import { NativeDatabasePickerSheet } from '../../components/database/NativeDatabasePickerSheet';
import { NativeScanBatchPanel } from '../../components/database/NativeScanBatchPanel';
import { NativeConsumableRow } from '../../components/database/NativeConsumableRow';
import { NativeEquipmentActions } from '../../components/database/NativeEquipmentActions';
import { NativeEquipmentRow } from '../../components/database/NativeEquipmentRow';
import { openNativeFile } from '../../files/nativeAttachmentDownloads';
import { downloadEquipmentAct } from '../../database/nativeDatabaseFiles';
import { nativeEquipmentDestination } from '../../database/nativeDatabaseFeature';
import { equipmentTitle, filterConsumables, isCartridgeLikeConsumable, isPrinterLikeEquipment, parseInventoryQrPayload, type DatabaseViewMode, type InventoryQrPayload } from '../../database/nativeDatabaseModel';
import { useNativeScanBatch } from '../../database/useNativeScanBatch';
import { NativeToastHost, showNativeToast } from '../../components/nativeToast';
import {
  filterNativeActs,
  filterNativeEquipment,
  nativeDatabaseListSignature,
  nativeEquipmentSnapshotKey,
  type NativeDatabaseBootstrapSnapshot,
  type NativeEquipmentDetailSnapshot,
  type NativeDatabaseListSnapshot,
} from '../../database/nativeDatabaseSnapshot';
import { useNativeBottomNavInset } from '../../navigation/useNativeBottomNavInset';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens } from '../../theme/fluentTokens';
import { AccountScreenScaffold, AccountSectionCard } from '../account/AccountChrome';

const SEARCH_DEBOUNCE_MS = 500;
const SEARCH_LIMIT = 50;
const MFU_MODEL_LOOKUPS = 8;
const MFU_MODEL_LOOKUP_LIMIT = 8;
const MFU_SUGGESTED_LIMIT = 12;
const MFU_SEARCH_LIMIT = 20;

// QR write-off of a cartridge needs a concrete MFU unit, not just a model:
// identical models can sit in different branches, so dedupe by inv_no/id and
// surface units stored where the consumable lives first.
function mfuKey(item: EquipmentRecord): string {
  const invNo = String(item.inv_no || '').trim();
  return invNo ? `inv:${invNo}` : `id:${item.id}`;
}

function dedupeMfu(rows: EquipmentRecord[]): EquipmentRecord[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = mfuKey(row);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortMfuByStorage(rows: EquipmentRecord[], branch?: string, location?: string): EquipmentRecord[] {
  const wantBranch = String(branch || '').trim().toLowerCase();
  const wantLocation = String(location || '').trim().toLowerCase();
  return rows
    .map((row, index) => {
      const sameBranch = Boolean(wantBranch) && (row.branch_name || '').trim().toLowerCase() === wantBranch;
      const sameLocation = Boolean(wantLocation) && (row.location_name || '').trim().toLowerCase() === wantLocation;
      const rank = sameBranch && sameLocation ? 0 : sameBranch || sameLocation ? 1 : 2;
      return { row, index, rank };
    })
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ row }) => row);
}

function mfuSubtitle(item: EquipmentRecord): string {
  return [
    item.inv_no ? `инв. ${item.inv_no}` : '',
    [item.branch_name, item.location_name].filter(Boolean).join(' · '),
    item.employee_name,
  ].filter(Boolean).join(' · ');
}

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
  const { width, fontScale } = useWindowDimensions();
  const stackModeTabs = (width - 32) / Math.max(fontScale, 1) < 300;
  const params = useLocalSearchParams<{
    q?: string | string[];
    mode?: string | string[];
    consumable?: string | string[];
    databaseId?: string | string[];
    scan?: string | string[];
  }>();
  const { user, hasPermission, offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const emptyListInset = useNativeBottomNavInset();
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
  const [databasePickerOpen, setDatabasePickerOpen] = useState(false);
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
  const [scanCard, setScanCard] = useState<ConsumableRecord | null>(null);
  const [scanCardBusy, setScanCardBusy] = useState(false);
  const [scanCardPrinters, setScanCardPrinters] = useState<string[] | null>(null);
  const [scanCardMfu, setScanCardMfu] = useState<EquipmentRecord | null>(null);
  const [scanCardMfuSuggested, setScanCardMfuSuggested] = useState<EquipmentRecord[]>([]);
  const [scanCardMfuQuery, setScanCardMfuQuery] = useState('');
  const [scanCardMfuResults, setScanCardMfuResults] = useState<EquipmentRecord[] | null>(null);
  const [scanCardMfuSearching, setScanCardMfuSearching] = useState(false);
  const scanCardMfuSearchSeq = useRef(0);
  const debouncedMfuQuery = useDebouncedValue(scanCardMfuQuery);
  const [scanCardDbId, setScanCardDbId] = useState('');
  const [scanBatchExpanded, setScanBatchExpanded] = useState(true);
  const [scanBatchOpen, setScanBatchOpen] = useState(false);
  const [scanDupHighlight, setScanDupHighlight] = useState('');
  const scanDupTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [quantityDatabaseId, setQuantityDatabaseId] = useState('');
  const requestRef = useRef(0);
  const equipmentPageRef = useRef(1);
  const busyActRef = useRef<number | null>(null);
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
  const [selectionRequested, setSelectionRequested] = useState(false);
  const [recentOpen, setRecentOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const selectionMode = selectionRequested || selectedEquipment.length > 0;

  useEffect(() => {
    setSelectedInvNos(new Set());
    setSelectionRequested(false);
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
    const userId = Number(user?.id || 0);
    let cached = false;
    if (userId) {
      const snapshot = await readNativeSnapshot<NativeDatabaseBootstrapSnapshot>('database-bootstrap', userId);
      if (snapshot) {
        cached = true;
        setDatabases(snapshot.data.databases);
        setCurrentDatabase(snapshot.data.currentDatabase);
        setBootstrapReady(true);
        setLoading(false);
      }
    }
    if (offlineMode) {
      if (!cached) setError('Нет подключения и сохранённых данных инвентаря.');
      setLoading(false);
      return;
    }
    try {
      const [available, current] = await Promise.all([
        listAvailableDatabases(),
        getCurrentDatabase(),
      ]);
      setDatabases(available);
      setCurrentDatabase(current);
      setBootstrapReady(true);
      if (userId) {
        void writeNativeSnapshot<NativeDatabaseBootstrapSnapshot>('database-bootstrap', userId, {
          databases: available,
          currentDatabase: current,
        });
      }
    } catch (cause) {
      if (!cached) setError(formatApiError(cause, 'Не удалось загрузить доступные базы данных.'));
      else setNotice('Показаны сохранённые данные. Обновить список баз не удалось.');
    } finally {
      setLoading(false);
    }
  }, [allowed, offlineMode, user?.id]);

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
    const userId = Number(user?.id || 0);
    const signature = nativeDatabaseListSignature(currentDatabase.id, mode, contentQuery);
    let cached = false;
    if (!append && userId) {
      let snapshot = await readNativeCollectionSnapshot<NativeDatabaseListSnapshot>(
        'database-inbox',
        userId,
        signature,
      );
      let fallback = false;
      if (!snapshot && offlineMode && contentQuery) {
        snapshot = await readNativeCollectionSnapshot<NativeDatabaseListSnapshot>(
          'database-inbox',
          userId,
          nativeDatabaseListSignature(currentDatabase.id, mode, ''),
        );
        fallback = Boolean(snapshot);
      }
      if (requestId !== requestRef.current) return;
      if (snapshot) {
        cached = true;
        const cachedEquipment = fallback
          ? filterNativeEquipment(snapshot.data.equipment, contentQuery)
          : snapshot.data.equipment;
        const cachedActs = fallback
          ? filterNativeActs(snapshot.data.acts, contentQuery)
          : snapshot.data.acts;
        setEquipment(mode === 'equipment' ? cachedEquipment : []);
        setConsumables(mode === 'consumables' ? snapshot.data.consumables : []);
        setActs(mode === 'acts' ? cachedActs : []);
        setTotal(fallback
          ? (mode === 'equipment' ? cachedEquipment.length : mode === 'acts' ? cachedActs.length : snapshot.data.consumables.length)
          : snapshot.data.total);
        equipmentPageRef.current = snapshot.data.page || 1;
        setHasMoreEquipment(false);
        setLoading(false);
      }
    }
    if (!append && offlineMode && mode === 'equipment' && userId) {
      const catalog = await readNativeEquipmentCatalogSnapshot(userId, currentDatabase.id);
      if (requestId !== requestRef.current) return;
      if (catalog) {
        const localEquipment = filterNativeEquipment(catalog.data.equipment, contentQuery);
        cached = true;
        setEquipment(localEquipment);
        setConsumables([]);
        setActs([]);
        setTotal(contentQuery ? localEquipment.length : catalog.data.total);
        equipmentPageRef.current = 1;
        setHasMoreEquipment(false);
        setLoading(false);
      }
    }
    if (offlineMode) {
      if (requestId === requestRef.current) {
        if (!cached) setError('Нет подключения и сохранённых данных для этого раздела.');
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
      return;
    }
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
        if (!append && userId) {
          void writeNativeCollectionSnapshot<NativeDatabaseListSnapshot>('database-inbox', userId, signature, {
            signature,
            databaseId: currentDatabase.id,
            mode,
            query: contentQuery,
            equipment: result.equipment,
            consumables: [],
            acts: [],
            total: result.total,
            page: result.page,
            pages: result.pages,
          });
        }
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
        if (userId) {
          void writeNativeCollectionSnapshot<NativeDatabaseListSnapshot>('database-inbox', userId, signature, {
            signature,
            databaseId: currentDatabase.id,
            mode,
            query: '',
            equipment: [],
            consumables: result.consumables,
            acts: [],
            total: result.total,
            page: 1,
            pages: 1,
            truncated: result.truncated,
          });
        }
      } else {
        const result = await searchEquipmentActs(debouncedQuery, SEARCH_LIMIT, currentDatabase.id);
        if (requestId !== requestRef.current) return;
        setActs(result.acts);
        setHasMoreEquipment(false);
        setEquipment([]);
        setConsumables([]);
        setTotal(result.total);
        if (result.truncated) setNotice('Показаны первые 50 актов. Уточните запрос.');
        if (userId) {
          void writeNativeCollectionSnapshot<NativeDatabaseListSnapshot>('database-inbox', userId, signature, {
            signature,
            databaseId: currentDatabase.id,
            mode,
            query: contentQuery,
            equipment: [],
            consumables: [],
            acts: result.acts,
            total: result.total,
            page: 1,
            pages: 1,
            truncated: result.truncated,
          });
        }
      }
    } catch (cause) {
      if (requestId === requestRef.current) {
        if (cached) setNotice('Показаны сохранённые данные. Обновить их не удалось.');
        else setError(formatApiError(cause, mode === 'acts' ? 'Не удалось загрузить акты.' : mode === 'consumables' ? 'Не удалось загрузить расходники.' : 'Не удалось найти оборудование.'));
      }
    } finally {
      if (requestId === requestRef.current) {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    }
  }, [allowed, bootstrapReady, contentQuery, currentDatabase?.id, mode, offlineMode, user?.id]);

  useEffect(() => { void loadContent(); }, [loadContent]);

  const changeDatabase = useCallback(async (databaseId: string) => {
    if (!databaseId || databaseId === currentDatabase?.id || currentDatabase?.locked || switchingDatabase) return false;
    requestRef.current += 1;
    setSwitchingDatabase(databaseId);
    setError('');
    if (offlineMode) {
      const selected = databases.find((database) => database.id === databaseId);
      if (selected) {
        setCurrentDatabase({ ...selected, locked: false });
        setQuery('');
        setEquipment([]);
        setConsumables([]);
        setActs([]);
        setTotal(0);
      }
      setSwitchingDatabase('');
      return Boolean(selected);
    }
    try {
      const selected = await switchDatabase(databaseId);
      setCurrentDatabase(selected);
      const userId = Number(user?.id || 0);
      if (userId) {
        void writeNativeSnapshot<NativeDatabaseBootstrapSnapshot>('database-bootstrap', userId, {
          databases,
          currentDatabase: selected,
        });
      }
      setQuery('');
      setEquipment([]);
      equipmentPageRef.current = 1;
      setHasMoreEquipment(false);
      setConsumables([]);
      setActs([]);
      setTotal(0);
      return true;
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось переключить базу данных.'));
      return false;
    } finally {
      setSwitchingDatabase('');
    }
  }, [currentDatabase?.id, currentDatabase?.locked, databases, offlineMode, switchingDatabase, user?.id]);

  const openEquipment = useCallback((item: EquipmentRecord | string) => {
    const invNo = typeof item === 'string' ? item : item.inv_no;
    const snapshot = typeof item === 'string' ? null : item;
    if (!invNo) return;
    if (snapshot && !offlineMode) void touchRecentEquipmentCard(invNo, snapshot, 'view', currentDatabase?.id).catch(() => undefined);
    router.push(nativeEquipmentDestination(invNo, 'general', currentDatabase?.id) as never);
  }, [currentDatabase?.id, offlineMode]);

  const openConsumableFromQr = useCallback(async (payload: InventoryQrPayload) => {
    setQrScannerOpen(false);
    setError('');
    if (!payload.itemId) {
      setError('QR-код расходника не содержит ID позиции.');
      return;
    }
    if (offlineMode) {
      setError('В автономном режиме карточка расходника недоступна — нужна сеть.');
      return;
    }
    const targetDatabaseId = payload.databaseId || currentDatabase?.id || '';
    setScanCardBusy(true);
    setScanCardPrinters(null);
    setScanCardMfu(null);
    setScanCardMfuSuggested([]);
    setScanCardMfuQuery('');
    setScanCardMfuResults(null);
    setScanCardMfuSearching(false);
    try {
      const item = await getConsumableById(payload.itemId, targetDatabaseId || undefined);
      if (!item) {
        setError(`Расходник с ID ${payload.itemId} не найден.`);
        return;
      }
      setScanCard(item);
      setScanCardDbId(targetDatabaseId);
      if (isCartridgeLikeConsumable(item) && item.model_name) {
        void listCompatiblePrinterModels(item.model_name, targetDatabaseId || undefined)
          .then(setScanCardPrinters)
          .catch(() => setScanCardPrinters([]));
      }
    } catch (cause) {
      setError(formatApiError(cause, `Не удалось открыть расходник с ID ${payload.itemId}.`));
    } finally {
      setScanCardBusy(false);
    }
  }, [currentDatabase?.id, offlineMode]);

  const deepScan = first(params.scan);
  const deepScanRef = useRef(false);
  useEffect(() => {
    if (deepScan !== '1') {
      deepScanRef.current = false;
      return;
    }
    if (deepScanRef.current || !allowed) return;
    deepScanRef.current = true;
    setQrScannerOpen(true);
    router.setParams({ scan: undefined });
  }, [deepScan, allowed]);

  const deepConsumable = first(params.consumable);
  const deepDatabaseId = first(params.databaseId);
  const deepConsumableRef = useRef('');
  useEffect(() => {
    const signature = `${deepConsumable}|${deepDatabaseId}`;
    if (!deepConsumable || deepConsumableRef.current === signature) return;
    deepConsumableRef.current = signature;
    void openConsumableFromQr({
      kind: 'consumable',
      itemId: Number(deepConsumable),
      inventoryNumber: '',
      databaseId: deepDatabaseId,
    });
  }, [deepConsumable, deepDatabaseId, openConsumableFromQr]);

  // Reset the MFU picker whenever the scan card closes or a new one opens.
  useEffect(() => {
    if (scanCard) return;
    setScanCardMfu(null);
    setScanCardMfuSuggested([]);
    setScanCardMfuQuery('');
    setScanCardMfuResults(null);
    setScanCardMfuSearching(false);
  }, [scanCard]);

  // Compatible printer models -> concrete inventory units the user picks from.
  useEffect(() => {
    if (!scanCard || !isCartridgeLikeConsumable(scanCard) || !Array.isArray(scanCardPrinters)) return undefined;
    if (!scanCardPrinters.length) {
      setScanCardMfuSuggested([]);
      return undefined;
    }
    let cancelled = false;
    const dbId = scanCardDbId || currentDatabase?.id;
    void Promise.all(
      scanCardPrinters.slice(0, MFU_MODEL_LOOKUPS).map((model) =>
        searchEquipment(model, 1, MFU_MODEL_LOOKUP_LIMIT, dbId, 'model')
          .then((page) => page.equipment)
          .catch(() => [] as EquipmentRecord[]),
      ),
    ).then((groups) => {
      if (cancelled) return;
      const rows = sortMfuByStorage(
        dedupeMfu(groups.flat()).filter(isPrinterLikeEquipment),
        scanCard.branch_name,
        scanCard.location_name,
      );
      setScanCardMfuSuggested(rows.slice(0, MFU_SUGGESTED_LIMIT));
    });
    return () => { cancelled = true; };
  }, [scanCard, scanCardDbId, scanCardPrinters, currentDatabase?.id]);

  // Free search covers model / inv_no / serial / branch / location so an
  // incomplete compatibility table never blocks a legitimate write-off.
  useEffect(() => {
    const query = debouncedMfuQuery.trim();
    if (!scanCard || !isCartridgeLikeConsumable(scanCard) || !query) {
      scanCardMfuSearchSeq.current += 1;
      setScanCardMfuResults(null);
      setScanCardMfuSearching(false);
      return undefined;
    }
    const seq = ++scanCardMfuSearchSeq.current;
    setScanCardMfuSearching(true);
    void searchEquipment(query, 1, MFU_SEARCH_LIMIT, scanCardDbId || currentDatabase?.id)
      .then((page) => {
        if (seq === scanCardMfuSearchSeq.current) {
          setScanCardMfuResults(dedupeMfu(page.equipment).filter(isPrinterLikeEquipment));
        }
      })
      .catch(() => {
        if (seq === scanCardMfuSearchSeq.current) setScanCardMfuResults([]);
      })
      .finally(() => {
        if (seq === scanCardMfuSearchSeq.current) setScanCardMfuSearching(false);
      });
    return undefined;
  }, [debouncedMfuQuery, scanCard, scanCardDbId, currentDatabase?.id]);

  const consumeFromScanCard = useCallback(async () => {
    if (!scanCard || scanCardBusy || offlineMode || !canWrite) return;
    const cartridgeLike = isCartridgeLikeConsumable(scanCard);
    if (cartridgeLike && !scanCardMfu) {
      setError('Выберите МФУ, в которую устанавливается расходник.');
      return;
    }
    setScanCardBusy(true);
    setError('');
    const targetDatabaseId = scanCardDbId || currentDatabase?.id;
    try {
      let nextQty: number;
      if (cartridgeLike && scanCardMfu) {
        const result = await recordEquipmentWork({
          kind: 'cartridge',
          equipment: scanCardMfu,
          consumable: scanCard,
          databaseId: targetDatabaseId,
        });
        nextQty = typeof result?.qty_new === 'number' ? result.qty_new : Math.max(0, scanCard.qty - 1);
        setNotice(`Списано: ${scanCard.model_name || scanCard.type_name || 'расходник'} → ${scanCardMfu.model_name || 'МФУ'} (инв. ${scanCardMfu.inv_no}). Остаток: ${nextQty}.`);
      } else {
        const result = await consumeConsumableStock(scanCard, 1, targetDatabaseId);
        nextQty = typeof result.qty_new === 'number' ? result.qty_new : Math.max(0, scanCard.qty - 1);
        setNotice(`Списано: ${scanCard.model_name || scanCard.type_name || 'расходник'}. Остаток: ${nextQty}.`);
      }
      setScanCard((current) => (current ? { ...current, qty: nextQty } : current));
      setConsumables((current) => current.map((item) => (item.id === scanCard.id ? { ...item, qty: nextQty } : item)));
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось списать расходник.'));
      // Stock may already have been deducted before a history-write failure —
      // resync the displayed qty so the card never shows a stale remainder.
      void getConsumableById(scanCard.id, targetDatabaseId || undefined)
        .then((fresh) => {
          if (!fresh) return;
          setScanCard(fresh);
          setConsumables((current) => current.map((item) => (item.id === fresh.id ? { ...item, qty: fresh.qty } : item)));
        })
        .catch(() => undefined);
    } finally {
      setScanCardBusy(false);
    }
  }, [canWrite, currentDatabase?.id, offlineMode, scanCard, scanCardBusy, scanCardDbId, scanCardMfu]);

  const findCachedEquipment = useCallback(async (invNo: string, targetDatabaseId: string): Promise<EquipmentRecord | null> => {
    const normalizedInvNo = invNo.trim().toLocaleUpperCase('ru-RU');
    const userId = Number(user?.id || 0);
    let cachedEquipment = targetDatabaseId === currentDatabase?.id
      ? equipment.find((item) => item.inv_no.trim().toLocaleUpperCase('ru-RU') === normalizedInvNo)
      : undefined;
    if (!cachedEquipment && userId && targetDatabaseId) {
      const snapshot = await readNativeCollectionSnapshot<NativeDatabaseListSnapshot>(
        'database-inbox',
        userId,
        nativeDatabaseListSignature(targetDatabaseId, 'equipment', ''),
      );
      cachedEquipment = snapshot?.data.equipment.find(
        (item) => item.inv_no.trim().toLocaleUpperCase('ru-RU') === normalizedInvNo,
      );
      if (!cachedEquipment) {
        const catalog = await readNativeEquipmentCatalogSnapshot(userId, targetDatabaseId);
        cachedEquipment = catalog?.data.equipment.find(
          (item) => item.inv_no.trim().toLocaleUpperCase('ru-RU') === normalizedInvNo,
        );
      }
    }
    return cachedEquipment ?? null;
  }, [currentDatabase?.id, equipment, user?.id]);

  const openEquipmentFromQr = useCallback(async (payload: InventoryQrPayload) => {
    setQrScannerOpen(false);
    setError('');
    if (payload.kind === 'consumable') {
      await openConsumableFromQr(payload);
      return;
    }
    const targetDatabaseId = payload.databaseId || currentDatabase?.id || '';
    const userId = Number(user?.id || 0);
    if (offlineMode && userId && targetDatabaseId) {
      const cachedEquipment = await findCachedEquipment(payload.inventoryNumber, targetDatabaseId);
      if (cachedEquipment) {
        await writeNativeEntitySnapshot<NativeEquipmentDetailSnapshot>(
          'database-item-details',
          userId,
          nativeEquipmentSnapshotKey(targetDatabaseId, payload.inventoryNumber),
          {
            databaseId: targetDatabaseId,
            equipment: cachedEquipment,
            acts: [],
            history: [],
            workHistory: [],
            unavailableWorkKinds: [],
            loadedTabs: [],
          },
        );
      }
    }
    router.push(nativeEquipmentDestination(
      payload.inventoryNumber,
      'general',
      targetDatabaseId,
    ) as never);
  }, [currentDatabase?.id, findCachedEquipment, offlineMode, openConsumableFromQr, user?.id]);

  const resolveEquipmentForScan = useCallback(async (invNo: string, targetDatabaseId: string): Promise<EquipmentRecord | null> => {
    if (!offlineMode) {
      try {
        return await getEquipment(invNo, targetDatabaseId || currentDatabase?.id);
      } catch (cause) {
        // «Не найдено» — только HTTP 404; прочие сбои не должны выглядеть как
        // «номера нет»: хук вернёт kind 'error', позиция не добавится.
        if (axios.isAxiosError(cause) && cause.response?.status === 404) return null;
        throw cause;
      }
    }
    return findCachedEquipment(invNo, targetDatabaseId);
  }, [currentDatabase?.id, findCachedEquipment, offlineMode]);

  const {
    items: scanBatchItems,
    readyItems: scanBatchReadyItems,
    add: scanBatchAdd,
    remove: scanBatchRemove,
    clear: scanBatchClear,
    keepOnly: scanBatchKeepOnly,
  } = useNativeScanBatch({
    userId: Number(user?.id || 0),
    databaseId: currentDatabase?.id || '',
    offlineMode,
    resolveEquipment: resolveEquipmentForScan,
  });

  // Ш5-8: каждое открытие сканера (кнопка QR, ярлык scan=1) начинается с пустого
  // списка. Сброс — при переходе closed→open, до первого считанного кода.
  const qrScannerWasOpenRef = useRef(false);
  const consumablePromptOpenRef = useRef(false);
  useEffect(() => {
    if (qrScannerOpen && !qrScannerWasOpenRef.current) {
      scanBatchClear();
      setScanBatchExpanded(true);
      setScanBatchOpen(false);
      consumablePromptOpenRef.current = false;
    }
    qrScannerWasOpenRef.current = qrScannerOpen;
  }, [qrScannerOpen, scanBatchClear]);

  const handleScannerScan = useCallback(async (payload: InventoryQrPayload) => {
    if (consumablePromptOpenRef.current) return;
    if (!canWrite) {
      await openEquipmentFromQr(payload);
      return;
    }
    if (payload.kind === 'consumable') {
      const openConsumable = () => {
        scanBatchClear();
        void openConsumableFromQr(payload);
      };
      if (scanBatchItems.length >= 2) {
        const dismissPrompt = () => { consumablePromptOpenRef.current = false; };
        consumablePromptOpenRef.current = true;
        Alert.alert(
          `Список из ${scanBatchItems.length} позиций сбросится. Открыть расходник?`,
          undefined,
          [
            { text: 'Отмена', style: 'cancel', onPress: dismissPrompt },
            { text: 'Открыть', onPress: () => { dismissPrompt(); openConsumable(); } },
          ],
          { onDismiss: dismissPrompt },
        );
        return;
      }
      openConsumable();
      return;
    }
    const result = await scanBatchAdd(payload);
    if (result.kind === 'added') {
      try { await Haptics.selectionAsync(); } catch { /* Haptics are optional feedback. */ }
      setScanBatchExpanded(true);
      return;
    }
    if (result.kind === 'duplicate') {
      setScanDupHighlight(result.invNo);
      if (scanDupTimerRef.current) clearTimeout(scanDupTimerRef.current);
      scanDupTimerRef.current = setTimeout(() => setScanDupHighlight(''), 1_000);
      setScanBatchExpanded(true);
      showNativeToast('Уже в списке');
      return;
    }
    if (result.kind === 'different-database') {
      const name = databases.find((item) => item.id === result.databaseId)?.name || result.databaseId;
      showNativeToast(`Другая база: ${name}. Список собирается по одной базе`);
      return;
    }
    if (result.kind === 'limit') showNativeToast('Не больше 100 за раз');
    if (result.kind === 'error') showNativeToast('Нет связи с сервером — отсканируйте ещё раз');
  }, [canWrite, databases, openConsumableFromQr, openEquipmentFromQr, scanBatchAdd, scanBatchClear, scanBatchItems.length]);

  const requestScannerClose = useCallback(() => {
    const closeAndReset = () => {
      setQrScannerOpen(false);
      scanBatchClear();
    };
    if (canWrite && scanBatchItems.length >= 2) {
      Alert.alert(
        `Список из ${scanBatchItems.length} позиций сбросится. Закрыть?`,
        undefined,
        [
          { text: 'Отмена', style: 'cancel' },
          { text: 'Закрыть', onPress: closeAndReset },
        ],
      );
      return;
    }
    closeAndReset();
  }, [canWrite, scanBatchClear, scanBatchItems.length]);

  const requestScanBatchDiscard = useCallback(() => {
    const discard = () => {
      scanBatchClear();
      setScanBatchOpen(false);
    };
    if (scanBatchItems.length >= 2) {
      Alert.alert(
        `Список из ${scanBatchItems.length} позиций сбросится. Отменить?`,
        undefined,
        [
          { text: 'Назад', style: 'cancel' },
          { text: 'Отменить', onPress: discard },
        ],
      );
      return;
    }
    discard();
  }, [scanBatchClear, scanBatchItems.length]);

  const handleScanBatchClosed = useCallback((result: TransferResult | null) => {
    if (!result) return;
    if (result.failed_count) scanBatchKeepOnly(result.retry_inv_nos);
    else {
      scanBatchClear();
      setScanBatchOpen(false);
    }
  }, [scanBatchClear, scanBatchKeepOnly]);

  useEffect(() => () => {
    if (scanDupTimerRef.current) clearTimeout(scanDupTimerRef.current);
  }, []);

  const toggleEquipmentSelection = useCallback((invNo: string) => {
    setSelectedInvNos((current) => {
      const next = new Set(current);
      if (next.has(invNo)) next.delete(invNo);
      else next.add(invNo);
      return next;
    });
  }, []);

  const openActFile = useCallback(async (act: EquipmentAct) => {
    if (busyActRef.current !== null) return;
    busyActRef.current = act.doc_no;
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
      busyActRef.current = null;
      setBusyAct(null);
    }
  }, [currentDatabase?.id]);

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
      await updateConsumableQuantity(quantityItem, qty, quantityDatabaseId || currentDatabase?.id);
      setConsumables((current) => current.map((item) => item.id === quantityItem.id ? { ...item, qty } : item));
      setQuantityItem(null);
      setNotice('Остаток расходника обновлён.');
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось изменить остаток расходника.'));
    } finally {
      setQuantityBusy(false);
    }
  }, [currentDatabase?.id, offlineMode, quantityBusy, quantityDatabaseId, quantityDraft, quantityItem]);

  const pasteInventoryCode = useCallback(async () => {
    const payload = parseInventoryQrPayload(await Clipboard.getStringAsync());
    if (!payload) {
      setError('В буфере нет поддерживаемого инвентарного QR-кода.');
      return;
    }
    await openEquipmentFromQr(payload);
  }, [openEquipmentFromQr]);

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

  const handleEquipmentPress = useCallback((item: EquipmentRecord) => {
    if (selectionMode) toggleEquipmentSelection(item.inv_no);
    else openEquipment(item);
  }, [openEquipment, selectionMode, toggleEquipmentSelection]);

  const handleEquipmentLongPress = useCallback((item: EquipmentRecord) => {
    toggleEquipmentSelection(item.inv_no);
  }, [toggleEquipmentSelection]);

  const renderEquipmentRow = useCallback(({ item }: ListRenderItemInfo<EquipmentRecord>) => (
    <NativeEquipmentRow
      item={item}
      tokens={tokens}
      selectionMode={selectionMode}
      selected={selectedInvNos.has(item.inv_no)}
      onLongPress={canWrite && !offlineMode ? handleEquipmentLongPress : undefined}
      onPress={handleEquipmentPress}
    />
  ), [canWrite, handleEquipmentLongPress, handleEquipmentPress, offlineMode, selectedInvNos, selectionMode, tokens]);

  const editConsumableQuantity = useCallback((item: ConsumableRecord, databaseId?: string) => {
    setQuantityItem(item);
    setQuantityDraft(String(item.qty));
    setQuantityDatabaseId(databaseId ?? currentDatabase?.id ?? '');
  }, [currentDatabase?.id]);

  const requestConsumableDelete = useCallback((item: ConsumableRecord) => {
    setDeleteItem(item);
  }, []);

  const renderConsumableRow = useCallback(({ item }: ListRenderItemInfo<ConsumableRecord>) => (
    <NativeConsumableRow
      item={item}
      tokens={tokens}
      onEditQuantity={canWrite && !offlineMode ? editConsumableQuantity : undefined}
      onDelete={canDelete && !offlineMode ? requestConsumableDelete : undefined}
    />
  ), [canDelete, canWrite, editConsumableQuantity, offlineMode, requestConsumableDelete, tokens]);

  const renderEquipmentAct = useCallback(({ item }: ListRenderItemInfo<EquipmentAct>) => (
    <NativeEquipmentActCard
      act={item}
      tokens={tokens}
      fileBusy={busyAct === item.doc_no}
      onOpenEquipment={openEquipment}
      onOpenFile={openActFile}
    />
  ), [busyAct, openActFile, openEquipment, tokens]);

  if (!allowed) {
    return (
      <AccountScreenScaffold title="Инвентарь" tokens={tokens}>
        <AccountSectionCard tokens={tokens} title="Нет доступа" description="Для раздела нужно право database.read.">{null}</AccountSectionCard>
      </AccountScreenScaffold>
    );
  }

  return (
    <>
    <AccountScreenScaffold
      title="Инвентарь"
      tokens={tokens}
      scroll={false}
      contentUnderNav
      rightAction={(
        <Pressable
          testID="native-database-header-selector"
          onPress={() => setDatabasePickerOpen(true)}
          disabled={databases.length === 0}
          accessibilityRole="button"
          accessibilityLabel={`Выбрать базу данных. Сейчас: ${currentDatabase?.name || currentDatabase?.id || 'не выбрана'}`}
          accessibilityState={{ expanded: databasePickerOpen, disabled: databases.length === 0 }}
          style={({ pressed }) => [
            styles.headerDatabaseSelector,
            {
              backgroundColor: tokens.panelInset,
              borderColor: tokens.borderSoft,
              opacity: databases.length === 0 ? 0.55 : pressed ? 0.88 : 1,
            },
          ]}
        >
          {switchingDatabase ? (
            <ActivityIndicator size="small" color={accentColor} />
          ) : (
            <MaterialCommunityIcons name="database-outline" size={17} color={accentColor} />
          )}
          <Text numberOfLines={1} style={[styles.headerDatabaseText, { color: tokens.textPrimary }]}>
            {currentDatabase?.name || currentDatabase?.id || 'База'}
          </Text>
          <MaterialCommunityIcons name={databasePickerOpen ? 'chevron-up' : 'chevron-down'} size={18} color={tokens.iconMuted} />
        </Pressable>
      )}
    >
      {offlineMode ? <Text accessibilityRole="alert" style={[styles.warning, { color: tokens.warning }]}>Автономный режим: показаны сохранённые данные, изменения недоступны.</Text> : null}
      {error ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{error}</Text> : null}
      {notice ? <Text accessibilityLiveRegion="polite" style={[styles.notice, { color: tokens.textSecondary }]}>{notice}</Text> : null}

      <View style={[styles.modeTabs, stackModeTabs && styles.modeTabsStacked, { backgroundColor: tokens.panelInset }]} accessibilityRole="tablist">
        {(['equipment', 'consumables', 'acts'] as const).map((value) => {
          const selected = mode === value;
          return (
            <Pressable
              key={value}
              testID={`native-database-mode-${value}`}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => setMode(value)}
              style={[styles.modeTab, stackModeTabs && styles.modeTabStacked, { backgroundColor: selected ? tokens.panelSolid : 'transparent' }]}
            >
              <Text style={[styles.modeText, { color: selected ? accentColor : tokens.textSecondary }]}>
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
            editable
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
          accessibilityRole="button"
          accessibilityLabel="Сканировать инвентарный QR-код камерой"
          style={[styles.searchAction, { backgroundColor: tokens.panelSolid, borderColor: tokens.border }]}
        >
          <MaterialCommunityIcons name="qrcode-scan" size={22} color={accentColor} />
        </Pressable>

      </View>

      <View testID="native-database-toolbar" style={styles.toolbar}>
          {canWrite && mode !== 'acts' ? (
            <Pressable testID="native-database-create" onPress={() => setCreateOpen(true)} disabled={offlineMode} accessibilityRole="button" accessibilityLabel={mode === 'consumables' ? 'Добавить расходник' : 'Добавить оборудование'} accessibilityState={{ disabled: offlineMode }} style={({ pressed }) => [styles.resultAction, styles.toolbarAction, { backgroundColor: tokens.panelInset, borderColor: tokens.border, opacity: offlineMode ? 0.5 : pressed ? 0.75 : 1 }]}>
              <MaterialCommunityIcons name="plus" size={19} color={accentColor} />
              <Text style={[styles.resultActionText, { color: accentColor }]}>Добавить</Text>
            </Pressable>
          ) : null}
          {canWrite && mode === 'acts' ? (
            <Pressable testID="native-database-upload-act" onPress={() => setUploadActOpen(true)} disabled={offlineMode} accessibilityRole="button" accessibilityLabel="Загрузить подписанный PDF-акт" accessibilityState={{ disabled: offlineMode }} style={({ pressed }) => [styles.resultAction, styles.toolbarAction, { backgroundColor: tokens.panelInset, borderColor: tokens.border, opacity: offlineMode ? 0.5 : pressed ? 0.75 : 1 }]}>
              <MaterialCommunityIcons name="file-upload-outline" size={19} color={accentColor} />
              <Text style={[styles.resultActionText, { color: accentColor }]}>Загрузить</Text>
            </Pressable>
          ) : null}
          {canWrite && !offlineMode && mode === 'equipment' ? <Pressable testID="native-database-select" accessibilityRole="button" accessibilityState={{ selected: selectionMode }} onPress={() => { setSelectionRequested(!selectionMode); setSelectedInvNos(new Set()); }} style={({ pressed }) => [styles.resultAction, styles.toolbarAction, { borderColor: tokens.border, opacity: pressed ? 0.75 : 1 }]}><Text style={[styles.resultActionText, { color: accentColor }]}>{selectionMode ? 'Отмена' : 'Выбрать'}</Text></Pressable> : null}
          <Pressable testID="native-database-more" accessibilityRole="button" accessibilityLabel="Ещё действия с инвентарём" accessibilityState={{ expanded: moreOpen }} onPress={() => setMoreOpen(!moreOpen)} style={({ pressed }) => [styles.resultAction, styles.moreAction, { borderColor: tokens.border, backgroundColor: moreOpen ? tokens.panelInset : 'transparent', opacity: pressed ? 0.75 : 1 }]}>
            <MaterialCommunityIcons name="dots-horizontal" size={22} color={accentColor} />
          </Pressable>
      </View>

      {moreOpen ? <View style={styles.countActions}>
        <Pressable
          testID="native-database-paste-qr"
          onPress={() => { void pasteInventoryCode(); }}
          accessibilityRole="button"
          accessibilityLabel="Вставить инвентарный QR-код из буфера"
          style={[styles.resultAction, { backgroundColor: tokens.panelSolid, borderColor: tokens.border }]}
        >
          <MaterialCommunityIcons name="content-paste" size={21} color={accentColor} /><Text style={[styles.resultActionText, { color: accentColor }]}>Вставить QR</Text>
        </Pressable>
          <Pressable testID="native-database-refresh" onPress={() => { void loadContent(true); }} disabled={loading || offlineMode} accessibilityRole="button" accessibilityLabel="Обновить результаты" accessibilityState={{ disabled: loading || offlineMode }} style={[styles.resultAction, { borderColor: tokens.border, opacity: loading || offlineMode ? 0.5 : 1 }]}>
            <MaterialCommunityIcons name="refresh" size={19} color={accentColor} />
            <Text style={[styles.resultActionText, { color: accentColor }]}>Обновить</Text>
          </Pressable>
      </View> : null}
      <View style={styles.countRow}>
        <Text accessibilityLiveRegion="polite" style={[styles.count, { color: tokens.textSecondary }]}>
          {mode === 'acts' ? `Актов: ${displayTotal}` : mode === 'consumables' ? `Расходников: ${displayTotal}` : `Найдено: ${displayTotal}`}
        </Text>
        {!query.trim() && !selectionMode && mode !== 'consumables' && (mode === 'acts' ? recentActs.length : recentCards.length) ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Недавние карточки" accessibilityState={{ expanded: recentOpen }} onPress={() => setRecentOpen(!recentOpen)} style={styles.recentToggle}>
            <Text style={[styles.recentLabel, { color: tokens.textSecondary }]}>Недавние</Text>
            <MaterialCommunityIcons name={recentOpen ? 'chevron-up' : 'chevron-down'} size={20} color={tokens.iconMuted} />
          </Pressable>
        ) : null}
      </View>
      {!query.trim() && !selectionMode && mode !== 'consumables' && (mode === 'acts' ? recentActs.length : recentCards.length) && recentOpen ? (
        <View style={styles.recentSection}>
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

      {loading && listLength === 0 ? (
        <View style={styles.loading}><ActivityIndicator color={accentColor} /></View>
      ) : mode === 'equipment' ? (
        <FlatList
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={7}
          testID="native-database-results"
          data={equipment}
          keyExtractor={(item) => `e:${item.inv_no}`}
          keyboardShouldPersistTaps="handled"
          refreshing={refreshing}
          onRefresh={() => { void loadContent(true); }}
          onEndReached={() => { if (hasMoreEquipment && !loadingMore && !loading) void loadContent(false, true); }}
          onEndReachedThreshold={0.35}
          contentContainerStyle={equipment.length ? [styles.listContent, { paddingBottom: emptyListInset }] : [styles.emptyContent, { paddingBottom: emptyListInset }]}
          ListEmptyComponent={<Text style={[styles.empty, { color: tokens.textSecondary }]}>{emptyMessage}</Text>}
          ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.footer} color={accentColor} /> : null}
          renderItem={renderEquipmentRow}
        />
      ) : mode === 'consumables' ? (
        <FlatList
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={7}
          testID="native-database-results"
          data={visibleConsumables}
          keyExtractor={(item) => `c:${item.id}`}
          keyboardShouldPersistTaps="handled"
          refreshing={refreshing}
          onRefresh={() => { void loadContent(true); }}
          contentContainerStyle={visibleConsumables.length ? [styles.listContent, { paddingBottom: emptyListInset }] : [styles.emptyContent, { paddingBottom: emptyListInset }]}
          ListEmptyComponent={<Text style={[styles.empty, { color: tokens.textSecondary }]}>{emptyMessage}</Text>}
          renderItem={renderConsumableRow}
        />
      ) : (
        <FlatList
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          windowSize={7}
          testID="native-database-results"
          data={acts}
          keyExtractor={(item) => `a:${item.doc_no}`}
          keyboardShouldPersistTaps="handled"
          refreshing={refreshing}
          onRefresh={() => { void loadContent(true); }}
          contentContainerStyle={acts.length ? [styles.listContent, { paddingBottom: emptyListInset }] : [styles.emptyContent, { paddingBottom: emptyListInset }]}
          ListEmptyComponent={<Text style={[styles.empty, { color: tokens.textSecondary }]}>{emptyMessage}</Text>}
          renderItem={renderEquipmentAct}
        />
      )}
      {mode === 'equipment' && selectedEquipment.length > 0 ? (
        <View testID="native-database-selection" style={[styles.selectionPanel, { backgroundColor: tokens.panelInset, borderColor: tokens.border, paddingBottom: emptyListInset }]}>
          <View style={styles.selectionHeader}>
            <Text accessibilityLiveRegion="polite" style={[styles.selectionTitle, { color: tokens.textPrimary }]}>Выбрано: {selectedEquipment.length}</Text>
            <Pressable testID="native-database-selection-clear" accessibilityRole="button" accessibilityLabel="Снять выбор со всех карточек" onPress={() => { setSelectedInvNos(new Set()); setSelectionRequested(false); }} style={styles.selectionClear}>
              <MaterialCommunityIcons name="close" size={19} color={tokens.iconMuted} />
              <Text style={[styles.selectionClearText, { color: tokens.textSecondary }]}>Снять</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.selectionActions} keyboardShouldPersistTaps="handled">
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
              onChanged={() => undefined}
              onClosed={(result) => {
                if (result && !result.failed_count) {
                  setSelectedInvNos(new Set());
                  setSelectionRequested(false);
                }
                void loadContent(true);
              }}
              onDeleted={() => undefined}
            />
          </ScrollView>
        </View>
      ) : null}

      <NativeDatabasePickerSheet
        visible={databasePickerOpen}
        subtitle="Инвентарь и поиск переключатся на выбранную базу"
        options={databases}
        currentId={currentDatabase?.id}
        locked={Boolean(currentDatabase?.locked)}
        switching={Boolean(switchingDatabase)}
        switchingId={switchingDatabase || null}
        accentColor={accentColor}
        tokens={tokens}
        onClose={() => setDatabasePickerOpen(false)}
        onSelect={(database) => {
          void changeDatabase(database.id).then((changed) => {
            if (changed) setDatabasePickerOpen(false);
          });
        }}
      />
      <Modal
        visible={Boolean(quantityItem)}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!quantityBusy) setQuantityItem(null); }}
        accessibilityViewIsModal
      >
        <KeyboardAvoidingView style={styles.modalBackdrop} {...chatKeyboardAvoidingProps()}>
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
        </KeyboardAvoidingView>
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
      <Modal
        visible={Boolean(scanCard) || scanCardBusy}
        transparent
        animationType="fade"
        onRequestClose={() => { if (!scanCardBusy) { setScanCard(null); setScanCardDbId(''); } }}
        accessibilityViewIsModal
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.quantityDialog, { backgroundColor: tokens.panelSolid, borderColor: tokens.border }]}>
            {scanCard ? (
              <>
                <Text accessibilityRole="header" style={[styles.quantityTitle, { color: tokens.textPrimary }]}>
                  {scanCard.model_name || scanCard.type_name || 'Расходник'}
                </Text>
                <Text style={[styles.quantityDescription, { color: tokens.textSecondary }]}>
                  {[scanCard.type_name, [scanCard.branch_name, scanCard.location_name].filter(Boolean).join(' · ')]
                    .filter(Boolean).join(' · ') || 'Местоположение не указано'}
                </Text>
                <Text accessibilityLiveRegion="polite" style={[styles.scanCardQty, { color: accentColor }]}>
                  {scanCard.qty} шт.
                </Text>
                {scanCard.inv_no || scanCard.id ? (
                  <Text style={[styles.quantityDescription, { color: tokens.textTertiary }]}>
                    {[scanCard.inv_no ? `Инв. № ${scanCard.inv_no}` : '', `ID ${scanCard.id}`].filter(Boolean).join(' · ')}
                  </Text>
                ) : null}
                {isCartridgeLikeConsumable(scanCard) ? (
                  <View style={styles.scanCardCompat}>
                    <Text style={[styles.quantityDescription, { color: tokens.textSecondary }]}>Подходит к:</Text>
                    {scanCardPrinters === null ? (
                      <Text style={[styles.deleteHint, { color: tokens.textTertiary }]}>Проверяем совместимость…</Text>
                    ) : scanCardPrinters.length ? (
                      <Text style={[styles.scanCardCompatText, { color: tokens.textPrimary }]}>
                        {scanCardPrinters.join(', ')}
                      </Text>
                    ) : (
                      <Text style={[styles.deleteHint, { color: tokens.textTertiary }]}>Совместимость не найдена.</Text>
                    )}
                  </View>
                ) : null}
                {canWrite && isCartridgeLikeConsumable(scanCard) ? (
                  <View style={styles.scanCardMfu}>
                    <Text style={[styles.scanCardCompatTitle, { color: tokens.textSecondary }]}>МФУ для списания</Text>
                    {scanCardMfu ? (
                      <View style={[styles.scanCardMfuSelected, { borderColor: accentColor, backgroundColor: tokens.panelInset }]}>
                        <View style={{ flex: 1, minWidth: 0 }}>
                          <Text style={[styles.scanCardCompatText, { color: tokens.textPrimary }]}>{scanCardMfu.model_name || 'МФУ'}</Text>
                          <Text style={[styles.deleteHint, { color: tokens.textSecondary, marginTop: 2 }]}>{mfuSubtitle(scanCardMfu)}</Text>
                        </View>
                        <Pressable
                          accessibilityRole="button"
                          accessibilityLabel="Выбрать другую МФУ"
                          disabled={scanCardBusy}
                          onPress={() => setScanCardMfu(null)}
                          style={styles.scanCardMfuClear}
                        >
                          <MaterialCommunityIcons color={tokens.textSecondary} name="close" size={18} />
                        </Pressable>
                      </View>
                    ) : (
                      <>
                        <TextInput
                          accessibilityLabel="Поиск МФУ"
                          editable={!scanCardBusy}
                          onChangeText={setScanCardMfuQuery}
                          placeholder="Модель, инв. №, серийник или локация"
                          placeholderTextColor={tokens.textTertiary}
                          style={[styles.scanCardMfuInput, { backgroundColor: tokens.pageBg, borderColor: tokens.border, color: tokens.textPrimary }]}
                          value={scanCardMfuQuery}
                        />
                        {scanCardMfuSearching ? <ActivityIndicator color={accentColor} size="small" style={{ alignSelf: 'flex-start', marginTop: 4 }} /> : null}
                        {(() => {
                          const freeSearchActive = Boolean(debouncedMfuQuery.trim());
                          const rows = freeSearchActive ? (scanCardMfuResults ?? []) : scanCardMfuSuggested;
                          if (!rows.length) {
                            return (
                              <Text style={[styles.deleteHint, { color: tokens.textTertiary }]}>
                                {freeSearchActive
                                  ? (scanCardMfuSearching ? 'Ищем МФУ…' : 'МФУ не найдены — уточните запрос.')
                                  : 'Выберите МФУ через поиск — без неё списание недоступно.'}
                              </Text>
                            );
                          }
                          return (
                            <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled style={styles.scanCardMfuList}>
                              {!freeSearchActive ? (
                                <Text style={[styles.deleteHint, { color: tokens.textTertiary, marginBottom: 4 }]}>Подходящие МФУ:</Text>
                              ) : null}
                              {rows.map((mfu) => (
                                <Pressable
                                  accessibilityRole="button"
                                  disabled={scanCardBusy}
                                  key={mfuKey(mfu)}
                                  onPress={() => setScanCardMfu(mfu)}
                                  style={({ pressed }) => [
                                    styles.scanCardMfuRow,
                                    { backgroundColor: tokens.panelInset, borderColor: tokens.borderSoft, opacity: pressed ? 0.7 : 1 },
                                  ]}
                                >
                                  <Text style={[styles.scanCardCompatText, { color: tokens.textPrimary }]}>{mfu.model_name || 'МФУ'}</Text>
                                  <Text style={[styles.deleteHint, { color: tokens.textSecondary, marginTop: 1 }]}>{mfuSubtitle(mfu)}</Text>
                                </Pressable>
                              ))}
                            </ScrollView>
                          );
                        })()}
                      </>
                    )}
                  </View>
                ) : null}
                <View style={styles.dialogActions}>
                  <Pressable disabled={scanCardBusy} accessibilityRole="button" onPress={() => { setScanCard(null); setScanCardDbId(''); }} style={styles.dialogButton}>
                    <Text style={[styles.dialogButtonText, { color: tokens.textSecondary }]}>Закрыть</Text>
                  </Pressable>
                  {canWrite ? (
                    <Pressable
                      disabled={scanCardBusy || offlineMode}
                      accessibilityRole="button"
                      accessibilityLabel={`Установить остаток ${scanCard.model_name || 'расходника'}`}
                      onPress={() => {
                        const target = scanCard;
                        const targetDatabaseId = scanCardDbId;
                        setScanCard(null);
                        setScanCardDbId('');
                        editConsumableQuantity(target, targetDatabaseId || undefined);
                      }}
                      style={styles.dialogButton}
                    >
                      <Text style={[styles.dialogButtonText, { color: accentColor }]}>Остаток</Text>
                    </Pressable>
                  ) : null}
                  {canWrite ? (
                    <Pressable
                      testID="native-consumable-scan-consume"
                      disabled={scanCardBusy || offlineMode || scanCard.qty <= 0 || (isCartridgeLikeConsumable(scanCard) && !scanCardMfu)}
                      accessibilityRole="button"
                      accessibilityState={{ disabled: scanCardBusy || offlineMode || scanCard.qty <= 0 || (isCartridgeLikeConsumable(scanCard) && !scanCardMfu) }}
                      accessibilityLabel={`Списать 1 штуку ${scanCard.model_name || 'расходника'}`}
                      onPress={() => { void consumeFromScanCard(); }}
                      style={[styles.dialogButton, { backgroundColor: tokens.primary }]}
                    >
                      {scanCardBusy ? <ActivityIndicator size="small" color="#fff" /> : <Text style={[styles.dialogButtonText, { color: '#fff' }]}>Списать 1</Text>}
                    </Pressable>
                  ) : null}
                </View>
              </>
            ) : (
              <View style={styles.scanCardCenter}>
                <ActivityIndicator color={accentColor} />
              </View>
            )}
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
      {scanBatchOpen && scanBatchItems.length ? (
        <View testID="native-database-scan-batch" style={[styles.selectionPanel, { backgroundColor: tokens.panelInset, borderColor: tokens.border, paddingBottom: emptyListInset }]}>
          <View style={styles.selectionHeader}>
            <Text accessibilityLiveRegion="polite" style={[styles.selectionTitle, { color: tokens.textPrimary }]}>Выбрано: {scanBatchItems.length}</Text>
            <Pressable
              testID="native-database-scan-batch-cancel"
              accessibilityRole="button"
              accessibilityLabel="Отменить список сканированных"
              onPress={requestScanBatchDiscard}
              style={styles.selectionClear}
            >
              <MaterialCommunityIcons name="close" size={19} color={tokens.iconMuted} />
              <Text style={[styles.selectionClearText, { color: tokens.textSecondary }]}>Отменить</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.selectionList} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
            {scanBatchItems.map((item) => (
              <View key={item.invNo} testID={`native-database-scan-batch-row-${item.invNo}`} style={[styles.scanBatchRow, { borderColor: tokens.borderSoft }]}>
                <View style={styles.scanBatchRowText}>
                  <Text numberOfLines={1} style={[styles.scanBatchRowTitle, { color: tokens.textPrimary }]}>
                    {item.equipment ? equipmentTitle(item.equipment) : `Инв. № ${item.invNo}`}
                  </Text>
                  <Text numberOfLines={1} style={[styles.scanBatchRowMeta, { color: item.equipment ? tokens.textSecondary : tokens.error }]}>
                    {item.equipment
                      ? `Инв. № ${item.invNo}${item.equipment.employee_name ? ` · ${item.equipment.employee_name}` : ''}`
                      : (item.status === 'offline-missing' ? 'Нет данных офлайн' : 'Не найдено')}
                  </Text>
                </View>
                <Pressable
                  testID={`native-database-scan-batch-remove-${item.invNo}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Убрать ${item.invNo} из списка`}
                  hitSlop={8}
                  onPress={() => scanBatchRemove(item.invNo)}
                  style={styles.scanBatchRowRemove}
                >
                  <MaterialCommunityIcons name="close" size={18} color={tokens.iconMuted} />
                </Pressable>
              </View>
            ))}
          </ScrollView>
          {offlineMode ? (
            <Text style={[styles.scanBatchOffline, { color: tokens.textSecondary }]}>Нужна сеть</Text>
          ) : null}
          {scanBatchReadyItems.length ? (
            <ScrollView style={styles.selectionActions} keyboardShouldPersistTaps="handled" nestedScrollEnabled>
              <NativeEquipmentActions
                equipment={scanBatchReadyItems[0].equipment!}
                targets={scanBatchReadyItems.map((item) => item.equipment!)}
                databaseId={scanBatchItems[0]?.databaseId}
                canWrite={canWrite}
                canDeleteEquipment={false}
                offline={offlineMode}
                surface="general"
                tokens={tokens}
                testIDPrefix="native-database-scan-batch"
                onChanged={() => { void loadContent(true); }}
                onClosed={handleScanBatchClosed}
                onDeleted={() => undefined}
              />
            </ScrollView>
          ) : null}
        </View>
      ) : null}
      <NativeDatabaseQrScannerModal
        visible={qrScannerOpen}
        tokens={tokens}
        continuous={canWrite}
        overlay={canWrite ? (
          <NativeScanBatchPanel
            tokens={tokens}
            items={scanBatchItems}
            expanded={scanBatchExpanded}
            highlightInvNo={scanDupHighlight}
            offline={offlineMode}
            onToggleExpanded={() => setScanBatchExpanded((value) => !value)}
            onOpen={(item) => {
              if (scanBatchItems.length === 1) scanBatchClear();
              void openEquipmentFromQr({ inventoryNumber: item.invNo, databaseId: item.databaseId });
            }}
            onCollapse={() => setScanBatchExpanded(false)}
            onRemove={scanBatchRemove}
            onActions={() => {
              if (offlineMode || !scanBatchReadyItems.length) return;
              setQrScannerOpen(false);
              setScanBatchOpen(true);
            }}
          />
        ) : null}
        onClose={requestScannerClose}
        onScanned={handleScannerScan}
      />
    </AccountScreenScaffold>
    <NativeToastHost muted={qrScannerOpen} />
    </>
  );
}

const styles = StyleSheet.create({
  headerAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerDatabaseSelector: { minHeight: 40, maxWidth: 184, borderRadius: 12, borderWidth: 1, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 6 },
  headerDatabaseText: { flexShrink: 1, fontSize: 12, lineHeight: 16, fontWeight: '800' },
  warning: { marginBottom: 7, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  error: { marginBottom: 7, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  notice: { marginBottom: 7, fontSize: 12, lineHeight: 17, fontWeight: '600' },
  recentSection: { marginBottom: 4 },
  recentToggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
  selectionActions: { maxHeight: 150 },
  recentLabel: { flexShrink: 1, fontSize: 12, lineHeight: 17, fontWeight: '800' },
  recentStrip: { gap: 8, paddingRight: 20, paddingBottom: 2 },
  recentCard: { width: 184, minHeight: 68, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 9, justifyContent: 'center' },
  recentTitle: { fontSize: 13, lineHeight: 17, fontWeight: '800' },
  recentMeta: { marginTop: 3, fontSize: 11, lineHeight: 15 },
  modeTabs: { minHeight: 48, borderRadius: 12, padding: 3, flexDirection: 'row', alignItems: 'stretch', marginBottom: 9 },
  modeTabsStacked: { flexDirection: 'column' },
  modeTabStacked: { flex: 0 },
  modeTab: { flex: 1, minHeight: 42, borderRadius: 10, paddingHorizontal: 4, paddingVertical: 7, alignItems: 'center', justifyContent: 'center' },
  modeText: { flexShrink: 1, textAlign: 'center', fontSize: 13, lineHeight: 17, fontWeight: '800' },
  searchRow: { flexDirection: 'row', alignItems: 'stretch', gap: 7 },
  searchBox: { flex: 1, minWidth: 0, minHeight: 48, borderRadius: 13, borderWidth: 1, paddingLeft: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, minWidth: 0, minHeight: 46, paddingVertical: 8, fontSize: 16, lineHeight: 21 },
  clearButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  searchAction: { width: 48, minHeight: 48, borderRadius: 13, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  toolbar: { marginTop: 10, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'stretch', gap: 8 },
  toolbarAction: { flexGrow: 1, flexBasis: 100, minWidth: 0 },
  moreAction: { minWidth: 44, marginLeft: 'auto' },
  countRow: { minHeight: 44, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  count: { flexGrow: 1, fontSize: 12, lineHeight: 17, fontWeight: '700', fontVariant: ['tabular-nums'] },
  countActions: { marginTop: 8, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  resultAction: { minHeight: 44, maxWidth: '100%', borderRadius: 11, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5 },
  resultActionText: { flexShrink: 1, textAlign: 'center', fontSize: 12, lineHeight: 16, fontWeight: '800' },
  selectionPanel: { borderWidth: 1, borderRadius: 14, padding: 11, marginTop: 9 },
  selectionList: { maxHeight: 168 },

  scanBatchRow: { minHeight: 44, borderTopWidth: StyleSheet.hairlineWidth, paddingVertical: 5, flexDirection: 'row', alignItems: 'center' },
  scanBatchRowText: { flex: 1, minWidth: 0 },
  scanBatchRowTitle: { fontSize: 13, lineHeight: 17, fontWeight: '800' },
  scanBatchRowMeta: { marginTop: 1, fontSize: 11, lineHeight: 15, fontWeight: '600' },
  scanBatchRowRemove: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  scanBatchOffline: { marginTop: 4, fontSize: 12, lineHeight: 16, fontWeight: '700', textAlign: 'right' },
  selectionHeader: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  selectionTitle: { fontSize: 14, fontWeight: '900' },
  selectionClear: { minHeight: 44, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 5 },
  selectionClearText: { fontSize: 12, fontWeight: '800' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  listContent: { paddingBottom: 8 },
  emptyContent: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  empty: { textAlign: 'center', fontSize: 14, lineHeight: 20 },
  footer: { paddingVertical: 16 },

  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.42)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  quantityDialog: { width: '100%', maxWidth: 420, borderWidth: 1, borderRadius: 18, padding: 18 },
  quantityTitle: { fontSize: 18, fontWeight: '900' },
  quantityDescription: { marginTop: 5, fontSize: 13, lineHeight: 18 },
  deleteHint: { marginTop: 9, fontSize: 12, lineHeight: 17 },
  quantityInput: { minHeight: 50, marginTop: 16, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 18, fontWeight: '800' },
  scanCardQty: { marginTop: 12, fontSize: 34, lineHeight: 40, fontWeight: '900', fontVariant: ['tabular-nums'] },
  scanCardCenter: { alignItems: 'center', justifyContent: 'center', paddingVertical: 24 },
  scanCardCompat: { marginTop: 10, gap: 4 },
  scanCardCompatText: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  scanCardCompatTitle: { fontSize: 11, lineHeight: 15, fontWeight: '700' },
  scanCardMfu: { marginTop: 10, gap: 6 },
  scanCardMfuInput: { minHeight: 44, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, fontSize: 14 },
  scanCardMfuList: { maxHeight: 190, flexGrow: 0 },
  scanCardMfuRow: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8, marginBottom: 6 },
  scanCardMfuSelected: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1.5, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  scanCardMfuClear: { minWidth: 40, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  dialogActions: { marginTop: 18, flexDirection: 'row', justifyContent: 'flex-end', gap: 9 },
  dialogButton: { minWidth: 104, minHeight: 46, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14 },
  dialogButtonText: { fontSize: 13, fontWeight: '900' },
});
