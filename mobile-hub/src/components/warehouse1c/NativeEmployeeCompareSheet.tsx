import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaInsetsContext, initialWindowMetrics } from 'react-native-safe-area-context';
import { getEmployeeEquipmentByOwner, type EquipmentRecord } from '../../api/databaseApi';
import { formatApiError } from '../../api/formatError';
import {
  getWarehouse1CEmployeeWarehouse,
  type Warehouse1CBalance,
  type Warehouse1CEmployeeWarehouse,
} from '../../api/warehouse1cApi';
import type { FluentTokens } from '../../theme/fluentTokens';
import {
  COMPARE_STATUS_LABEL,
  buildCompareMaps,
  compareQtyBreakdown,
  isWarehouse1cBalancesMetaIncomplete,
  resolve1cRowStatus,
  resolveHubRowStatus,
  summarizeCompareMaps,
  type Warehouse1cCompareStatus,
} from '../../warehouse1c/warehouse1cCompare';
import { NativeModal } from '../ui/NativeModal';
import { NativeSheetHeader } from '../ui/NativeFilterControls';
import { formatWarehouse1cNumber } from './NativeWarehouse1CCards';

type CompareTab = 'hub' | 'warehouse1c';

function StatusChip({ status, tokens }: { status: Warehouse1cCompareStatus | null; tokens: FluentTokens }) {
  if (!status) return null;
  const color = status === 'match'
    ? tokens.success
    : status === 'diff'
      ? tokens.warning
      : tokens.error;
  return (
    <Text style={[styles.statusChip, { color, borderColor: color }]}>
      {COMPARE_STATUS_LABEL[status]}
    </Text>
  );
}

export function NativeEmployeeCompareSheet({
  visible,
  ownerNo,
  employeeName,
  databaseId,
  canViewWarehouse1C,
  offline,
  tokens,
  onClose,
}: {
  visible: boolean;
  ownerNo: number | null;
  employeeName: string;
  databaseId?: string;
  canViewWarehouse1C: boolean;
  offline: boolean;
  tokens: FluentTokens;
  onClose: () => void;
}) {
  const insets = useContext(SafeAreaInsetsContext) ?? initialWindowMetrics?.insets;
  const [tab, setTab] = useState<CompareTab>('hub');
  const [hubItems, setHubItems] = useState<EquipmentRecord[]>([]);
  const [hubLoading, setHubLoading] = useState(false);
  const [hubError, setHubError] = useState('');
  const [hubWarning, setHubWarning] = useState('');
  const [warehouse, setWarehouse] = useState<Warehouse1CEmployeeWarehouse | null>(null);
  const [warehouseLoading, setWarehouseLoading] = useState(false);
  const [warehouseError, setWarehouseError] = useState('');
  const hubAbortRef = useRef<AbortController | null>(null);
  const warehouseAbortRef = useRef<AbortController | null>(null);
  const hubGenRef = useRef(0);
  const warehouseGenRef = useRef(0);

  const loadWarehouse = useCallback((warehouseRef: string) => {
    const name = (employeeName || '').trim();
    if (!canViewWarehouse1C || (!name && !warehouseRef)) return;
    const generation = ++warehouseGenRef.current;
    warehouseAbortRef.current?.abort();
    const controller = new AbortController();
    warehouseAbortRef.current = controller;
    setWarehouseLoading(true);
    setWarehouseError('');
    void getWarehouse1CEmployeeWarehouse({
      employeeName: name,
      warehouseRef,
      loadBalances: true,
      signal: controller.signal,
    }).then((result) => {
      if (generation === warehouseGenRef.current && !controller.signal.aborted) setWarehouse(result);
    }).catch((cause) => {
      if (generation === warehouseGenRef.current && !controller.signal.aborted) {
        setWarehouse(null);
        setWarehouseError(formatApiError(cause, 'Не удалось получить склад сотрудника из 1С.'));
      }
    }).finally(() => {
      if (generation === warehouseGenRef.current && !controller.signal.aborted) setWarehouseLoading(false);
    });
  }, [canViewWarehouse1C, employeeName]);

  useEffect(() => {
    hubAbortRef.current?.abort();
    warehouseAbortRef.current?.abort();
    if (!visible) {
      setHubItems([]);
      setHubLoading(false);
      setHubError('');
      setHubWarning('');
      setWarehouse(null);
      setWarehouseLoading(false);
      setWarehouseError('');
      setTab('hub');
      return;
    }
    if (ownerNo) {
      const controller = new AbortController();
      hubAbortRef.current = controller;
      const generation = ++hubGenRef.current;
      setHubLoading(true);
      setHubError('');
      void getEmployeeEquipmentByOwner(ownerNo, { employeeName, databaseId, signal: controller.signal })
        .then((result) => {
          if (generation !== hubGenRef.current || controller.signal.aborted) return;
          setHubItems(result.equipment);
          setHubWarning(result.dbErrors.length ? `Не удалось получить данные из баз: ${result.dbErrors.join(', ')}.` : '');
        })
        .catch((cause) => {
          if (generation !== hubGenRef.current || controller.signal.aborted) return;
          setHubItems([]);
          setHubError(formatApiError(cause, 'Не удалось загрузить оборудование сотрудника из Хаба.'));
        })
        .finally(() => {
          if (generation === hubGenRef.current && !controller.signal.aborted) setHubLoading(false);
        });
    }
    loadWarehouse('');
  }, [visible, ownerNo, employeeName, databaseId, canViewWarehouse1C, loadWarehouse]);

  useEffect(() => () => {
    hubAbortRef.current?.abort();
    warehouseAbortRef.current?.abort();
  }, []);

  const maps = useMemo(() => {
    const balances = warehouse?.balances || [];
    if (!hubItems.length && !balances.length) return null;
    if (isWarehouse1cBalancesMetaIncomplete(warehouse?.balancesMeta ?? null) && balances.length === 0) return null;
    return buildCompareMaps({ hubItems, balances });
  }, [hubItems, warehouse]);

  const summary = useMemo(() => summarizeCompareMaps(maps), [maps]);
  const compareReady = Boolean(maps);

  const balancesIncomplete = warehouse?.balancesMeta ? isWarehouse1cBalancesMetaIncomplete(warehouse.balancesMeta) : false;

  const statusLine = (() => {
    if (warehouseLoading) return 'Ищем склад сотрудника в 1С…';
    if (warehouseError) return '';
    if (!canViewWarehouse1C) return 'Нет права warehouse_1c.read — показываем только технику Хаба.';
    if (!warehouse) return '';
    if (warehouse.status === 'matched' && warehouse.warehouse) return `Склад 1С: ${warehouse.warehouse.name}`;
    if (warehouse.status === 'ambiguous') return 'В 1С найдено несколько похожих складов — выберите нужный:';
    if (warehouse.status === 'not_found') return 'Склад сотрудника в 1С не найден.';
    return '';
  })();

  return (
    <NativeModal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Закрыть сравнение"
          onPress={onClose}
          style={StyleSheet.absoluteFill}
        />
        <View
          testID="native-employee-compare-sheet"
          accessibilityViewIsModal
          style={[styles.sheet, {
            backgroundColor: tokens.panelSolid,
            borderColor: tokens.borderSoft,
            paddingBottom: Math.max(16, (insets?.bottom || 0) + 8),
            paddingLeft: insets?.left || 0,
            paddingRight: insets?.right || 0,
          }]}
        >
          <NativeSheetHeader title="Склад сотрудника" subtitle={employeeName || 'Без имени'} tokens={tokens} onClose={onClose} />
          <View style={styles.fixed}>
            {offline ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.warning }]}>Требуется сеть: данные не сохраняются на устройстве.</Text> : null}
            {warehouse?.employmentLabel ? (
              <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.warning }]}>{warehouse.employmentLabel}</Text>
            ) : null}
            {statusLine ? <Text style={[styles.hint, { color: tokens.textSecondary }]}>{statusLine}</Text> : null}
            {warehouseError ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.error }]}>{warehouseError}</Text> : null}
            {hubError ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.error }]}>{hubError}</Text> : null}
            {hubWarning ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.warning }]}>{hubWarning}</Text> : null}
            {balancesIncomplete ? (
              <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.warning }]}>
                Остатки 1С загружены не полностью — сравнение может быть неточным.
              </Text>
            ) : null}
            {compareReady ? (
              <Text accessibilityLiveRegion="polite" style={[styles.summary, { color: tokens.textSecondary }]}>
                {`Совпадает: ${summary.matched} · Кол-во ≠: ${summary.diff} · Только в Хабе: ${summary.onlyHub} · Только в 1С: ${summary.only1c}`}
              </Text>
            ) : null}
            <View accessibilityRole="tablist" style={styles.modes}>
              <Pressable
                testID="native-employee-compare-tab-hub"
                onPress={() => setTab('hub')}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === 'hub' }}
                style={[styles.modeButton, { backgroundColor: tab === 'hub' ? tokens.primary : tokens.panelInset, borderColor: tab === 'hub' ? tokens.primary : tokens.borderSoft }]}
              >
                <Text style={[styles.modeText, { color: tab === 'hub' ? '#fff' : tokens.textPrimary }]}>В хабе{hubItems.length ? ` · ${hubItems.length}` : ''}</Text>
              </Pressable>
              <Pressable
                testID="native-employee-compare-tab-1c"
                onPress={() => setTab('warehouse1c')}
                accessibilityRole="tab"
                accessibilityState={{ selected: tab === 'warehouse1c' }}
                style={[styles.modeButton, { backgroundColor: tab === 'warehouse1c' ? tokens.primary : tokens.panelInset, borderColor: tab === 'warehouse1c' ? tokens.primary : tokens.borderSoft }]}
              >
                <Text style={[styles.modeText, { color: tab === 'warehouse1c' ? '#fff' : tokens.textPrimary }]}>
                  Склад 1С{warehouse?.balances.length ? ` · ${warehouse.balances.length}` : ''}
                </Text>
              </Pressable>
            </View>
          </View>
          <ScrollView style={styles.scroll} contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
            {tab === 'hub' ? (
              <>
                {hubLoading ? <View style={styles.loading}><ActivityIndicator color={tokens.primary} /><Text style={[styles.hint, { color: tokens.textSecondary }]}>Загружаем технику сотрудника…</Text></View> : null}
                {!hubLoading && !hubItems.length && !hubError ? (
                  <Text style={[styles.empty, { color: tokens.textSecondary }]}>
                    {ownerNo ? 'За сотрудником в Хабе техника не числится.' : 'Нет идентификатора сотрудника — список техники Хаба недоступен.'}
                  </Text>
                ) : null}
                {hubItems.map((item, index) => {
                  const status = resolveHubRowStatus(item.part_no, maps);
                  const breakdown = compareQtyBreakdown(item.part_no, maps);
                  return (
                    <View key={`${item.inv_no || item.model_name || 'item'}|${index}`} style={[styles.row, { backgroundColor: tokens.panelInset, borderColor: tokens.borderSoft }]}>
                      <View style={styles.rowBody}>
                        <Text numberOfLines={2} style={[styles.rowTitle, { color: tokens.textPrimary }]}>
                          {item.inv_no ? `${item.inv_no} · ` : ''}{item.model_name || item.type_name || 'Оборудование'}
                        </Text>
                        <Text numberOfLines={2} style={[styles.rowMeta, { color: tokens.textSecondary }]}>
                          {[item.part_no ? `P/N: ${item.part_no}` : 'без P/N', item.serial_no ? `S/N: ${item.serial_no}` : '']
                            .filter(Boolean).join(' · ')}
                          {breakdown && status !== 'match' ? ` · в 1С: ${formatWarehouse1cNumber(breakdown.qty1c)}` : ''}
                        </Text>
                      </View>
                      <StatusChip status={status} tokens={tokens} />
                    </View>
                  );
                })}
              </>
            ) : (
              <>
                {warehouse?.status === 'ambiguous' ? (
                  <View style={styles.candidates}>
                    {(warehouse.candidates || []).map((candidate) => (
                      <Pressable
                        key={candidate.ref}
                        accessibilityRole="button"
                        accessibilityLabel={`Выбрать склад ${candidate.name}`}
                        onPress={() => {
                          setWarehouse(null);
                          loadWarehouse(candidate.ref);
                        }}
                        style={({ pressed }) => [styles.row, { backgroundColor: tokens.panelInset, borderColor: tokens.borderSoft }, pressed && styles.pressed]}
                      >
                        <MaterialCommunityIcons name="warehouse" size={20} color={tokens.primary} />
                        <Text numberOfLines={2} style={[styles.rowTitle, styles.candidateTitle, { color: tokens.textPrimary }]}>{candidate.name}</Text>
                        <MaterialCommunityIcons name="chevron-right" size={18} color={tokens.iconMuted} />
                      </Pressable>
                    ))}
                  </View>
                ) : null}
                {warehouseLoading ? <View style={styles.loading}><ActivityIndicator color={tokens.primary} /><Text style={[styles.hint, { color: tokens.textSecondary }]}>Загружаем остатки склада 1С…</Text></View> : null}
                {!warehouseLoading && warehouse?.status === 'matched' && !warehouse.balances.length && !warehouseError ? (
                  <Text style={[styles.empty, { color: tokens.textSecondary }]}>На складе сотрудника в 1С пусто.</Text>
                ) : null}
                {!warehouseLoading && !warehouse && !warehouseError && !canViewWarehouse1C ? (
                  <Text style={[styles.empty, { color: tokens.textSecondary }]}>Склад 1С недоступен без права warehouse_1c.read.</Text>
                ) : null}
                {!warehouseLoading && warehouse && (warehouse.status === 'not_found' || warehouse.status === 'unknown') ? (
                  <Text style={[styles.empty, { color: tokens.textSecondary }]}>Остатков склада 1С нет — склад сотрудника не найден.</Text>
                ) : null}
                {(warehouse?.balances || []).map((balance, index) => {
                  const status = resolve1cRowStatus(balance.nomenclatureCode, maps);
                  const breakdown = compareQtyBreakdown(balance.nomenclatureCode, maps);
                  return (
                    <View key={`${balance.nomenclatureRef || balance.nomenclatureCode}|${index}`} style={[styles.row, { backgroundColor: tokens.panelInset, borderColor: tokens.borderSoft }]}>
                      <View style={styles.rowBody}>
                        <Text numberOfLines={2} style={[styles.rowTitle, { color: tokens.textPrimary }]}>{balance.nomenclatureName || 'Без названия'}</Text>
                        <Text numberOfLines={2} style={[styles.rowMeta, { color: tokens.textSecondary }]}>
                          {[balance.nomenclatureCode ? `Код ${balance.nomenclatureCode}` : 'без кода', `${formatWarehouse1cNumber(balance.qtyBalance)} ед.`]
                            .filter(Boolean).join(' · ')}
                          {breakdown && status !== 'match' ? ` · в Хабе: ${breakdown.hubCount}` : ''}
                        </Text>
                      </View>
                      <StatusChip status={status} tokens={tokens} />
                    </View>
                  );
                })}
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </NativeModal>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.82 },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.48)' },
  sheet: {
    maxHeight: '88%',
    borderWidth: 1,
    borderBottomWidth: 0,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  fixed: { paddingHorizontal: 14, gap: 8, paddingBottom: 10 },
  notice: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  hint: { fontSize: 12, lineHeight: 17 },
  summary: { fontSize: 12, lineHeight: 17, fontWeight: '800' },
  modes: { flexDirection: 'row', gap: 8 },
  modeButton: { flex: 1, minHeight: 44, borderWidth: 1, borderRadius: 13, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  modeText: { fontSize: 13, lineHeight: 18, fontWeight: '800', textAlign: 'center' },
  scroll: { flexGrow: 0, flexShrink: 1 },
  list: { paddingHorizontal: 14, paddingBottom: 10, gap: 8 },
  loading: { paddingVertical: 24, alignItems: 'center', justifyContent: 'center', gap: 8 },
  empty: { paddingVertical: 20, textAlign: 'center', fontSize: 13, lineHeight: 19 },
  candidates: { gap: 8, marginBottom: 4 },
  candidateTitle: { flex: 1, minWidth: 0 },
  row: {
    minHeight: 52,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  rowBody: { flex: 1, minWidth: 0 },
  rowTitle: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  rowMeta: { marginTop: 2, fontSize: 11, lineHeight: 16 },
  statusChip: { borderWidth: 1, borderRadius: 9, paddingHorizontal: 7, paddingVertical: 3, fontSize: 11, lineHeight: 15, fontWeight: '800' },
});
