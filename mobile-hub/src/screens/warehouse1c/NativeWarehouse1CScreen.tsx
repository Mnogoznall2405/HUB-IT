import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, View } from 'react-native';
import { openNativeFile, shareNativeFile } from '../../files/nativeAttachmentDownloads';
import {
  getWarehouse1CBalances,
  getWarehouse1CDismissedWarehouses,
  getWarehouse1CMovementDetail,
  getWarehouse1CMovements,
  type Warehouse1CBalance,
  type Warehouse1CCatalogItem,
  type Warehouse1CDismissedWarehouse,
  type Warehouse1CListMeta,
  type Warehouse1CMovement,
  type Warehouse1CMovementDetail,
  type Warehouse1CMovementFile,
} from '../../api/warehouse1cApi';
import { formatApiError } from '../../api/formatError';
import { useAuth } from '../../auth/AuthContext';
import { NativeWarehouse1CBalancesPanel } from '../../components/warehouse1c/NativeWarehouse1CBalancesPanel';
import { NativeWarehouse1CCatalogPanel } from '../../components/warehouse1c/NativeWarehouse1CCatalogPanel';
import { NativeWarehouse1CDismissedPanel } from '../../components/warehouse1c/NativeWarehouse1CDismissedPanel';
import { NativeWarehouse1CMovementDetailSheet } from '../../components/warehouse1c/NativeWarehouse1CMovementDetailSheet';
import {
  movementPeriodDates,
  NativeWarehouse1CMovementsPanel,
  type Warehouse1cMovementPeriod,
} from '../../components/warehouse1c/NativeWarehouse1CMovementsPanel';
import { NativeWarehouse1CPickerSheet } from '../../components/warehouse1c/NativeWarehouse1CPickerSheet';
import { NativeTabPicker } from '../../components/ui/NativeTabPicker';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens } from '../../theme/fluentTokens';
import {
  downloadNativeWarehouse1cFile,
  downloadNativeWarehouse1cPreview,
} from '../../warehouse1c/nativeWarehouse1cFiles';
import { AccountScreenScaffold, AccountSectionCard } from '../account/AccountChrome';

const BALANCES_LIMIT = 200;
const MOVEMENTS_LIMIT = 100;

type Warehouse1cTab = 'balances' | 'movements' | 'dismissed' | 'catalog';
type PickerTarget = 'balNom' | 'balWh' | 'movNom' | 'movWh';

const TAB_OPTIONS: { value: Warehouse1cTab; label: string; icon: string }[] = [
  { value: 'balances', label: 'Остатки', icon: 'package-variant' },
  { value: 'movements', label: 'Движения', icon: 'swap-horizontal' },
  { value: 'dismissed', label: 'Уволенные', icon: 'account-off-outline' },
  { value: 'catalog', label: 'Каталог', icon: 'book-open-variant-outline' },
];

function normalizeTab(value: unknown): Warehouse1cTab {
  const tab = String(value || '').trim().toLowerCase();
  return (TAB_OPTIONS.some((option) => option.value === tab) ? tab : 'balances') as Warehouse1cTab;
}

function singleParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

function prefillItem(refValue: string | string[] | undefined, nameValue: string | string[] | undefined): Warehouse1CCatalogItem | null {
  const ref = singleParam(refValue).trim();
  if (!ref || ref === '00000000-0000-0000-0000-000000000000') return null;
  return { ref: ref.slice(0, 64), code: '', name: singleParam(nameValue).trim().slice(0, 500) };
}

export function NativeWarehouse1CScreen() {
  const { hasPermission, offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const canRead = hasPermission('warehouse_1c.read');
  const params = useLocalSearchParams<{
    tab?: string | string[];
    nomenclatureRef?: string | string[];
    nomenclatureName?: string | string[];
    warehouseRef?: string | string[];
    warehouseName?: string | string[];
  }>();

  const initialTab = normalizeTab(singleParam(params.tab));
  const [tab, setTab] = useState<Warehouse1cTab>(initialTab);

  const [balNomenclature, setBalNomenclature] = useState<Warehouse1CCatalogItem | null>(
    () => (initialTab === 'balances' ? prefillItem(params.nomenclatureRef, params.nomenclatureName) : null),
  );
  const [balWarehouse, setBalWarehouse] = useState<Warehouse1CCatalogItem | null>(
    () => (initialTab === 'balances' ? prefillItem(params.warehouseRef, params.warehouseName) : null),
  );
  const [balQueryDraft, setBalQueryDraft] = useState('');
  const [balItems, setBalItems] = useState<Warehouse1CBalance[]>([]);
  const [balMeta, setBalMeta] = useState<Warehouse1CListMeta | null>(null);
  const [balLoading, setBalLoading] = useState(false);
  const [balRefreshing, setBalRefreshing] = useState(false);
  const [balError, setBalError] = useState('');
  const [balSearched, setBalSearched] = useState(false);
  const [balRevision, setBalRevision] = useState(0);
  const balGenerationRef = useRef(0);
  const balAbortRef = useRef<AbortController | null>(null);

  const [movNomenclature, setMovNomenclature] = useState<Warehouse1CCatalogItem | null>(
    () => (initialTab === 'movements' ? prefillItem(params.nomenclatureRef, params.nomenclatureName) : null),
  );
  const [movWarehouse, setMovWarehouse] = useState<Warehouse1CCatalogItem | null>(
    () => (initialTab === 'movements' ? prefillItem(params.warehouseRef, params.warehouseName) : null),
  );
  const [movPeriod, setMovPeriod] = useState<Warehouse1cMovementPeriod>('all');
  const [movItems, setMovItems] = useState<Warehouse1CMovement[]>([]);
  const [movMeta, setMovMeta] = useState<Warehouse1CListMeta | null>(null);
  const [movLoading, setMovLoading] = useState(false);
  const [movRefreshing, setMovRefreshing] = useState(false);
  const [movLoadingMore, setMovLoadingMore] = useState(false);
  const [movError, setMovError] = useState('');
  const [movSearched, setMovSearched] = useState(false);
  const [movRevision, setMovRevision] = useState(0);
  const movGenerationRef = useRef(0);
  const movAbortRef = useRef<AbortController | null>(null);
  const movAutoSearchRef = useRef(false);

  const [disItems, setDisItems] = useState<Warehouse1CDismissedWarehouse[]>([]);
  const [disMeta, setDisMeta] = useState<Warehouse1CListMeta | null>(null);
  const [disLoading, setDisLoading] = useState(false);
  const [disRefreshing, setDisRefreshing] = useState(false);
  const [disError, setDisError] = useState('');
  const [disRequested, setDisRequested] = useState(false);
  const [disRevision, setDisRevision] = useState(0);
  const [disExpanded, setDisExpanded] = useState<Set<string>>(new Set());
  const disGenerationRef = useRef(0);
  const disAbortRef = useRef<AbortController | null>(null);

  const [pickerTarget, setPickerTarget] = useState<PickerTarget | null>(null);
  const [detailMovement, setDetailMovement] = useState<Warehouse1CMovement | null>(null);
  const [detailData, setDetailData] = useState<Warehouse1CMovementDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [busyFileKey, setBusyFileKey] = useState('');
  const detailSequenceRef = useRef(0);
  const detailAbortRef = useRef<AbortController | null>(null);

  const focusedRef = useRef(false);
  const firstFocusRef = useRef(true);

  const loadBalances = useCallback(() => {
    balGenerationRef.current += 1;
    const requestId = balGenerationRef.current;
    balAbortRef.current?.abort();
    if (!canRead || offlineMode) return;
    const controller = new AbortController();
    balAbortRef.current = controller;
    setBalLoading(true);
    setBalError('');
    setBalSearched(true);
    void getWarehouse1CBalances({
      nomenclatureRef: balNomenclature?.ref || '',
      warehouseRef: balWarehouse?.ref || '',
      query: balQueryDraft,
      limit: BALANCES_LIMIT,
      signal: controller.signal,
    }).then((result) => {
      if (requestId === balGenerationRef.current && !controller.signal.aborted) {
        setBalItems(result.items);
        setBalMeta(result.meta);
      }
    }).catch((cause) => {
      if (requestId === balGenerationRef.current && !controller.signal.aborted) {
        setBalItems([]);
        setBalMeta(null);
        setBalError(formatApiError(cause, 'Не удалось загрузить остатки 1С.'));
      }
    }).finally(() => {
      if (requestId === balGenerationRef.current && !controller.signal.aborted) {
        setBalLoading(false);
        setBalRefreshing(false);
      }
    });
  }, [balNomenclature, balQueryDraft, balWarehouse, canRead, offlineMode]);

  const loadMovements = useCallback((cursor = '') => {
    if (!movNomenclature?.ref) return;
    movGenerationRef.current += 1;
    const requestId = movGenerationRef.current;
    movAbortRef.current?.abort();
    if (!canRead || offlineMode) return;
    const controller = new AbortController();
    movAbortRef.current = controller;
    if (cursor) setMovLoadingMore(true);
    else setMovLoading(true);
    setMovError('');
    setMovSearched(true);
    const { dateFrom, dateTo } = movementPeriodDates(movPeriod);
    void getWarehouse1CMovements({
      nomenclatureRef: movNomenclature.ref,
      warehouseRef: movWarehouse?.ref || '',
      dateFrom,
      dateTo,
      limit: MOVEMENTS_LIMIT,
      cursor,
      signal: controller.signal,
    }).then((result) => {
      if (requestId === movGenerationRef.current && !controller.signal.aborted) {
        setMovItems((current) => (cursor ? [...current, ...result.items] : result.items));
        setMovMeta(result.meta);
      }
    }).catch((cause) => {
      if (requestId === movGenerationRef.current && !controller.signal.aborted) {
        if (!cursor) setMovItems([]);
        setMovMeta(null);
        setMovError(formatApiError(cause, 'Не удалось загрузить движения 1С.'));
      }
    }).finally(() => {
      if (requestId === movGenerationRef.current && !controller.signal.aborted) {
        setMovLoading(false);
        setMovRefreshing(false);
        setMovLoadingMore(false);
      }
    });
  }, [canRead, movNomenclature?.ref, movPeriod, movWarehouse?.ref, offlineMode]);

  const loadDismissed = useCallback(() => {
    disGenerationRef.current += 1;
    const requestId = disGenerationRef.current;
    disAbortRef.current?.abort();
    if (!canRead || offlineMode) return;
    const controller = new AbortController();
    disAbortRef.current = controller;
    setDisLoading(true);
    setDisError('');
    void getWarehouse1CDismissedWarehouses({ signal: controller.signal }).then((result) => {
      if (requestId === disGenerationRef.current && !controller.signal.aborted) {
        setDisItems(result.items);
        setDisMeta(result.meta);
      }
    }).catch((cause) => {
      if (requestId === disGenerationRef.current && !controller.signal.aborted) {
        setDisItems([]);
        setDisMeta(null);
        setDisError(formatApiError(cause, 'Не удалось загрузить склады уволенных сотрудников.'));
      }
    }).finally(() => {
      if (requestId === disGenerationRef.current && !controller.signal.aborted) {
        setDisLoading(false);
        setDisRefreshing(false);
      }
    });
  }, [canRead, offlineMode]);

  useEffect(() => {
    if (tab === 'dismissed' && !disRequested) {
      setDisRequested(true);
      loadDismissed();
    }
  }, [disRequested, loadDismissed, tab]);

  useEffect(() => {
    if (tab === 'movements' && movAutoSearchRef.current && movNomenclature?.ref) {
      movAutoSearchRef.current = false;
      loadMovements();
    }
  }, [loadMovements, movNomenclature?.ref, tab]);

  useEffect(() => {
    if (tab === 'balances' && !balSearched && balNomenclature && initialTab === 'balances') {
      loadBalances();
    }
  }, [balNomenclature, balSearched, initialTab, loadBalances, tab]);

  useEffect(() => {
    if (tab === 'movements' && !movSearched && movNomenclature?.ref && initialTab === 'movements') {
      loadMovements();
    }
  }, [initialTab, loadMovements, movNomenclature?.ref, movSearched, tab]);

  const cancelRequests = useCallback(() => {
    balGenerationRef.current += 1;
    balAbortRef.current?.abort();
    movGenerationRef.current += 1;
    movAbortRef.current?.abort();
    disGenerationRef.current += 1;
    disAbortRef.current?.abort();
    detailSequenceRef.current += 1;
    detailAbortRef.current?.abort();
    setBalLoading(false);
    setBalRefreshing(false);
    setMovLoading(false);
    setMovRefreshing(false);
    setMovLoadingMore(false);
    setDisLoading(false);
    setDisRefreshing(false);
    setDetailLoading(false);
    setBusyFileKey('');
  }, []);

  const openMovementsForBalance = useCallback((item: Warehouse1CBalance) => {
    setMovNomenclature({ ref: item.nomenclatureRef, code: item.nomenclatureCode, name: item.nomenclatureName });
    setMovWarehouse(item.warehouseRef ? { ref: item.warehouseRef, code: '', name: item.warehouseName } : null);
    movAutoSearchRef.current = true;
    setTab('movements');
  }, []);

  const openMovementDetail = useCallback((movement: Warehouse1CMovement) => {
    if (!movement.canOpenDetail || !movement.registrarRef) return;
    detailSequenceRef.current += 1;
    const sequence = detailSequenceRef.current;
    detailAbortRef.current?.abort();
    const controller = new AbortController();
    detailAbortRef.current = controller;
    setDetailMovement(movement);
    setDetailData(null);
    setDetailError('');
    setBusyFileKey('');
    setDetailLoading(true);
    void getWarehouse1CMovementDetail(movement.registrarRef, { signal: controller.signal }).then((detail) => {
      if (detailSequenceRef.current !== sequence || controller.signal.aborted) return;
      setDetailData(detail);
    }).catch((cause) => {
      if (detailSequenceRef.current !== sequence || controller.signal.aborted) return;
      setDetailError(formatApiError(cause, 'Не удалось загрузить карточку документа.'));
    }).finally(() => {
      if (detailSequenceRef.current === sequence && !controller.signal.aborted) setDetailLoading(false);
    });
  }, []);

  const closeMovementDetail = useCallback(() => {
    detailSequenceRef.current += 1;
    detailAbortRef.current?.abort();
    setDetailMovement(null);
    setDetailData(null);
    setDetailLoading(false);
    setDetailError('');
    setBusyFileKey('');
  }, []);

  const downloadFile = useCallback(async (registrarRef: string, file: Warehouse1CMovementFile) => {
    const fileKey = file.ref || file.name;
    if (!fileKey || busyFileKey) return;
    setBusyFileKey(fileKey);
    try {
      const downloaded = await downloadNativeWarehouse1cFile(registrarRef, file);
      await shareNativeFile(downloaded, file.name || 'file.bin', file.contentType);
    } catch (cause) {
      setDetailError(formatApiError(cause, 'Не удалось скачать файл из 1С.'));
    } finally {
      setBusyFileKey('');
    }
  }, [busyFileKey]);

  const previewFile = useCallback(async (registrarRef: string, file: Warehouse1CMovementFile) => {
    const fileKey = file.ref || file.name;
    if (!fileKey || busyFileKey) return;
    setBusyFileKey(fileKey);
    try {
      const downloaded = await downloadNativeWarehouse1cPreview(registrarRef, file);
      await openNativeFile(downloaded, 'application/pdf');
    } catch (cause) {
      setDetailError(formatApiError(cause, 'Не удалось открыть файл из 1С.'));
    } finally {
      setBusyFileKey('');
    }
  }, [busyFileKey]);

  useFocusEffect(useCallback(() => {
    focusedRef.current = true;
    if (firstFocusRef.current) firstFocusRef.current = false;
    return () => {
      focusedRef.current = false;
      cancelRequests();
    };
  }, [cancelRequests]));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (stateValue) => {
      if (stateValue !== 'active') {
        cancelRequests();
      }
    });
    return () => subscription.remove();
  }, [cancelRequests]);

  useEffect(() => {
    if (canRead) return;
    cancelRequests();
    setBalItems([]);
    setMovItems([]);
    setDisItems([]);
  }, [canRead, cancelRequests]);

  if (!canRead) {
    return (
      <AccountScreenScaffold title="Склад 1С" tokens={tokens}>
        <AccountSectionCard tokens={tokens} title="Нет доступа" description="Для раздела нужно право warehouse_1c.read.">{null}</AccountSectionCard>
      </AccountScreenScaffold>
    );
  }

  const pickerKind = pickerTarget === 'balWh' || pickerTarget === 'movWh' ? 'warehouses' : 'nomenclature';
  const onPickerSelect = (item: Warehouse1CCatalogItem) => {
    if (pickerTarget === 'balNom') setBalNomenclature(item);
    else if (pickerTarget === 'balWh') setBalWarehouse(item);
    else if (pickerTarget === 'movNom') setMovNomenclature(item);
    else if (pickerTarget === 'movWh') setMovWarehouse(item);
    setPickerTarget(null);
  };

  return (
    <AccountScreenScaffold title="Склад 1С" tokens={tokens} scroll={false} contentUnderNav>
      <View style={styles.tabs}>
        <NativeTabPicker
          options={TAB_OPTIONS}
          selected={tab}
          onSelect={(value) => setTab(value as Warehouse1cTab)}
          tokens={tokens}
          testIDPrefix="native-warehouse-1c-tab"
          title="Раздел склада 1С"
        />
      </View>
      {tab === 'balances' ? (
        <NativeWarehouse1CBalancesPanel
          tokens={tokens}
          offline={offlineMode}
          nomenclature={balNomenclature}
          warehouse={balWarehouse}
          onPickNomenclature={() => setPickerTarget('balNom')}
          onPickWarehouse={() => setPickerTarget('balWh')}
          onClearNomenclature={() => setBalNomenclature(null)}
          onClearWarehouse={() => setBalWarehouse(null)}
          queryDraft={balQueryDraft}
          onQueryDraft={setBalQueryDraft}
          searched={balSearched}
          loading={balLoading}
          refreshing={balRefreshing}
          error={balError}
          items={balItems}
          meta={balMeta}
          onSearch={loadBalances}
          onRefresh={() => { setBalRefreshing(true); loadBalances(); }}
          onOpenMovements={openMovementsForBalance}
        />
      ) : null}
      {tab === 'movements' ? (
        <NativeWarehouse1CMovementsPanel
          tokens={tokens}
          offline={offlineMode}
          nomenclature={movNomenclature}
          warehouse={movWarehouse}
          period={movPeriod}
          onPickNomenclature={() => setPickerTarget('movNom')}
          onPickWarehouse={() => setPickerTarget('movWh')}
          onClearNomenclature={() => setMovNomenclature(null)}
          onClearWarehouse={() => setMovWarehouse(null)}
          onSelectPeriod={setMovPeriod}
          searched={movSearched}
          loading={movLoading}
          refreshing={movRefreshing}
          loadingMore={movLoadingMore}
          error={movError}
          items={movItems}
          meta={movMeta}
          onSearch={() => loadMovements()}
          onRefresh={() => { setMovRefreshing(true); loadMovements(); }}
          onLoadMore={() => { if (movMeta?.nextCursor) loadMovements(movMeta.nextCursor); }}
          onOpenDetail={openMovementDetail}
        />
      ) : null}
      {tab === 'dismissed' ? (
        <NativeWarehouse1CDismissedPanel
          tokens={tokens}
          offline={offlineMode}
          loading={disLoading}
          refreshing={disRefreshing}
          error={disError}
          items={disItems}
          meta={disMeta}
          expandedRefs={disExpanded}
          onToggle={(key) => setDisExpanded((current) => {
            const next = new Set(current);
            if (next.has(key)) next.delete(key);
            else next.add(key);
            return next;
          })}
          onRefresh={() => { setDisRefreshing(true); loadDismissed(); }}
        />
      ) : null}
      {tab === 'catalog' ? (
        <NativeWarehouse1CCatalogPanel
          tokens={tokens}
          canRead={canRead}
          offline={offlineMode}
          active={tab === 'catalog'}
        />
      ) : null}

      <NativeWarehouse1CPickerSheet
        visible={pickerTarget !== null}
        kind={pickerKind}
        tokens={tokens}
        onClose={() => setPickerTarget(null)}
        onSelect={onPickerSelect}
      />
      <NativeWarehouse1CMovementDetailSheet
        visible={detailMovement !== null}
        movement={detailMovement}
        detail={detailData}
        loading={detailLoading}
        error={detailError}
        busyFileKey={busyFileKey}
        onClose={closeMovementDetail}
        onDownloadFile={downloadFile}
        onPreviewFile={previewFile}
        tokens={tokens}
      />
    </AccountScreenScaffold>
  );
}

const styles = StyleSheet.create({
  tabs: { paddingBottom: 10 },
});
