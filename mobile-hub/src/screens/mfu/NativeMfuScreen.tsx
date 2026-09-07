import { NativeModal as Modal } from '../../components/ui/NativeModal';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  AppState,
  FlatList,
  type ListRenderItemInfo,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { getMfuDevices, type MfuDevice, type MfuDevicesPayload } from '../../api/mfuApi';
import { formatApiError } from '../../api/formatError';
import { useAuth } from '../../auth/AuthContext';
import { NativeMfuDeviceCard } from '../../components/mfu/NativeMfuDeviceCard';
import { filterMfuDevices, mfuSnmpStatusLabel, type MfuPingFilter, type MfuSnmpFilter } from '../../mfu/nativeMfuModel';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens } from '../../theme/fluentTokens';
import type { FluentTokens } from '../../theme/fluentTokens';
import { AccountScreenScaffold, AccountSectionCard } from '../account/AccountChrome';

function formatDateTime(value: string): string {
  if (!value) return 'Нет данных';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString('ru-RU');
}

function FilterChip({ label, selected, onPress, tokens }: { label: string; selected: boolean; onPress: () => void; tokens: FluentTokens }) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }} style={[styles.chip, { backgroundColor: selected ? tokens.primary : tokens.panelSolid, borderColor: selected ? tokens.primary : tokens.border }]}>
      <Text style={[styles.chipText, { color: selected ? '#fff' : tokens.textPrimary }]}>{label}</Text>
    </Pressable>
  );
}

function DetailField({ label, value, tokens }: { label: string; value: unknown; tokens: FluentTokens }) {
  const display = String(value ?? '').trim();
  if (!display) return null;
  return <View style={styles.field}><Text style={[styles.fieldLabel, { color: tokens.textSecondary }]}>{label}</Text><Text selectable style={[styles.fieldValue, { color: tokens.textPrimary }]}>{display}</Text></View>;
}

function DeviceDetails({
  device,
  tokens,
  onClose,
}: {
  device: MfuDevice;
  tokens: FluentTokens;
  onClose: () => void;
}) {
  return (
    <View style={styles.modalRoot}>
      <Pressable accessibilityRole="button" accessibilityLabel="Закрыть карточку МФУ" style={styles.scrim} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderStrong }]}>
        <View style={styles.sheetHeader}>
          <View style={styles.flex}><Text style={[styles.sheetTitle, { color: tokens.textPrimary }]}>{device.model_name || device.type_name || 'МФУ'}</Text><Text style={[styles.sheetSubtitle, { color: tokens.textSecondary }]}>{device.branch_name} · {device.location_name}</Text></View>
          <Pressable onPress={onClose} accessibilityRole="button" accessibilityLabel="Закрыть" style={styles.iconButton}><MaterialCommunityIcons name="close" size={23} color={tokens.iconMuted} /></Pressable>
        </View>
        <ScrollView contentContainerStyle={styles.sheetContent} showsVerticalScrollIndicator={false}>
          <Text style={[styles.sectionTitle, { color: tokens.textPrimary }]}>Состояние</Text>
          <DetailField label="Доступность по сети" value={`${device.ping.status === 'online' ? 'В сети' : device.ping.status === 'offline' ? 'Не в сети' : 'Неизвестно'}${device.ping.latency_ms !== null ? ` · ${Math.round(device.ping.latency_ms)} мс` : ''}`} tokens={tokens} />
          <DetailField label="Последняя проверка ping" value={formatDateTime(device.ping.checked_at)} tokens={tokens} />
          <DetailField label="Опрос SNMP" value={mfuSnmpStatusLabel(device.snmp.status)} tokens={tokens} />
          <DetailField label="Последний успешный SNMP" value={formatDateTime(device.snmp.last_success_at)} tokens={tokens} />
          {device.snmp.error ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.warning }]}>Ошибка SNMP: {device.snmp.error}</Text> : null}
          <DetailField label="Счётчик страниц" value={device.snmp.page_total === null ? '' : Math.round(device.snmp.page_total)} tokens={tokens} />

          <Text style={[styles.sectionTitle, { color: tokens.textPrimary }]}>Расходники</Text>
          {device.snmp.supplies.length ? device.snmp.supplies.map((supply) => (
            <View key={`${supply.index}|${supply.name}`} style={[styles.listRow, { borderColor: tokens.borderSoft }]}><Text style={[styles.rowTitle, { color: tokens.textPrimary }]}>{supply.name}</Text><Text style={[styles.rowValue, { color: supply.percent !== null && supply.percent < 20 ? tokens.error : tokens.textSecondary }]}>{supply.percent === null ? 'Нет данных' : `${Math.round(supply.percent)}%`}</Text></View>
          )) : <Text style={[styles.emptyText, { color: tokens.textSecondary }]}>Данные о расходниках отсутствуют.</Text>}

          <Text style={[styles.sectionTitle, { color: tokens.textPrimary }]}>Устройство</Text>
          <DetailField label="Инвентарный номер" value={device.inv_no} tokens={tokens} />
          <DetailField label="Серийный номер" value={device.serial_no || device.hw_serial_no} tokens={tokens} />
          <DetailField label="Производитель" value={device.manufacturer} tokens={tokens} />
          <DetailField label="IP / hostname" value={[device.ip_address, device.hostname].filter(Boolean).join(' · ')} tokens={tokens} />
          <DetailField label="MAC" value={device.mac_address} tokens={tokens} />
          <DetailField label="Сотрудник" value={[device.employee_name, device.employee_dept].filter(Boolean).join(' · ')} tokens={tokens} />

          <Text style={[styles.sectionTitle, { color: tokens.textPrimary }]}>История работ · {device.maintenance.total_operations}</Text>
          {device.maintenance.recent.length ? device.maintenance.recent.map((event, index) => (
            <View key={`${event.timestamp}|${index}`} style={[styles.historyRow, { borderColor: tokens.borderSoft }]}><Text style={[styles.rowTitle, { color: tokens.textPrimary }]}>{event.component_type || 'Работа'}: {event.replacement_item || '—'}</Text><Text style={[styles.rowHint, { color: tokens.textSecondary }]}>{formatDateTime(event.timestamp)}{event.employee ? ` · ${event.employee}` : ''}</Text></View>
          )) : <Text style={[styles.emptyText, { color: tokens.textSecondary }]}>Зарегистрированных работ нет.</Text>}

        </ScrollView>
      </View>
    </View>
  );
}

export function NativeMfuScreen() {
  const { hasPermission, offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const canRead = hasPermission('mfu.read');
  const [payload, setPayload] = useState<MfuDevicesPayload | null>(null);
  const [query, setQuery] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [branch, setBranch] = useState('all');
  const [ping, setPing] = useState<MfuPingFilter>('all');
  const [snmp, setSnmp] = useState<MfuSnmpFilter>('all');
  const [selected, setSelected] = useState<MfuDevice | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const loadGenerationRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const payloadRef = useRef<MfuDevicesPayload | null>(null);
  const focusedRef = useRef(false);
  const firstFocusRef = useRef(true);

  const cancel = useCallback(() => {
    loadGenerationRef.current += 1;
    loadAbortRef.current?.abort();
    setLoading(false);
    setRefreshing(false);
  }, []);

  useEffect(() => {
    if (!canRead || offlineMode) {
      cancel();
      payloadRef.current = null;
      setPayload(null);
      setSelected(null);
      setLoading(false);
      return;
    }
    const requestId = ++loadGenerationRef.current;
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    if (!payloadRef.current) setLoading(true);
    setError('');
    void getMfuDevices({ signal: controller.signal }).then((result) => {
      if (requestId !== loadGenerationRef.current || controller.signal.aborted) return;
      payloadRef.current = result;
      setPayload(result);
      setSelected((current) => current ? result.devices.find((device) => device.key === current.key) || null : null);
      setBranch((current) => current !== 'all' && !result.branches.includes(current) ? 'all' : current);
    }).catch((cause) => {
      if (requestId === loadGenerationRef.current && !controller.signal.aborted) setError(formatApiError(cause, 'Не удалось загрузить МФУ.'));
    }).finally(() => {
      if (requestId === loadGenerationRef.current && !controller.signal.aborted) {
        setLoading(false);
        setRefreshing(false);
      }
    });
    return () => controller.abort();
  }, [canRead, cancel, offlineMode, revision]);

  const openDevice = useCallback((device: MfuDevice) => {
    setSelected(device);
  }, []);

  const closeDevice = useCallback(() => {
    setSelected(null);
  }, []);

  const refresh = useCallback(() => {
    if (!canRead || offlineMode) return;
    setRefreshing(true);
    setRevision((value) => value + 1);
  }, [canRead, offlineMode]);

  useFocusEffect(useCallback(() => {
    focusedRef.current = true;
    if (firstFocusRef.current) firstFocusRef.current = false;
    else setRevision((value) => value + 1);
    return () => {
      focusedRef.current = false;
      cancel();
      closeDevice();
    };
  }, [cancel, closeDevice]));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') {
        cancel();
        closeDevice();
        return;
      }
      if (focusedRef.current) setRevision((value) => value + 1);
    });
    return () => subscription.remove();
  }, [cancel, closeDevice]);

  const filtered = useMemo(() => filterMfuDevices(payload?.devices || [], { query, branch, ping, snmp }), [branch, payload?.devices, ping, query, snmp]);
  const renderDevice = useCallback(({ item }: ListRenderItemInfo<MfuDevice>) => (
    <NativeMfuDeviceCard device={item} tokens={tokens} onPress={openDevice} />
  ), [openDevice, tokens]);

  if (!canRead) {
    return <AccountScreenScaffold title="МФУ" tokens={tokens}><AccountSectionCard tokens={tokens} title="Нет доступа" description="Для раздела нужно право mfu.read.">{null}</AccountSectionCard></AccountScreenScaffold>;
  }

  const header = (
    <View style={styles.header}>
      {offlineMode ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.warning }]}>Требуется сеть: снимок МФУ не сохраняется на устройстве.</Text> : null}
      {error ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.error }]}>{error}</Text> : null}
      {(payload?.list_truncated || payload?.source_maybe_truncated) ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.warning }]}>Список может быть неполным. Уточните фильтр и повторите запрос.</Text> : null}
      <View style={[styles.search, { backgroundColor: tokens.panelSolid, borderColor: tokens.border }]}><MaterialCommunityIcons name="magnify" size={21} color={tokens.iconMuted} /><TextInput testID="native-mfu-search" value={query} onChangeText={(value) => setQuery(value.slice(0, 200))} editable={!offlineMode} placeholder="Модель, номер, IP или сотрудник" placeholderTextColor={tokens.textTertiary} accessibilityLabel="Поиск МФУ" style={[styles.searchInput, { color: tokens.textPrimary }]} />{query ? <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Очистить поиск" style={styles.iconButton}><MaterialCommunityIcons name="close" size={20} color={tokens.iconMuted} /></Pressable> : null}</View>
      <View style={styles.quickFilters}>
        <FilterChip label="Все" selected={ping === 'all' && snmp === 'all' && branch === 'all'} onPress={() => { setPing('all'); setSnmp('all'); setBranch('all'); }} tokens={tokens} />
        <FilterChip label="Оффлайн" selected={ping === 'offline'} onPress={() => setPing(ping === 'offline' ? 'all' : 'offline')} tokens={tokens} />
        <FilterChip label="Расходник < 20%" selected={snmp === 'low_toner'} onPress={() => setSnmp(snmp === 'low_toner' ? 'all' : 'low_toner')} tokens={tokens} />
        <Pressable testID="native-mfu-filters" accessibilityRole="button" accessibilityState={{ expanded: filtersOpen }} onPress={() => setFiltersOpen(!filtersOpen)} style={[styles.chip, { borderColor: tokens.border }]}>
          <Text style={[styles.chipText, { color: tokens.primary }]}>Фильтры · {[branch !== 'all', ping !== 'all', snmp !== 'all'].filter(Boolean).length}</Text>
        </Pressable>
      </View>
      {filtersOpen ? <View style={styles.header}>
      {payload?.branches.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}><FilterChip label="Все филиалы" selected={branch === 'all'} onPress={() => setBranch('all')} tokens={tokens} />{payload.branches.map((item) => <FilterChip key={item} label={item} selected={branch === item} onPress={() => setBranch(item)} tokens={tokens} />)}</ScrollView> : null}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}><FilterChip label="Любая сеть" selected={ping === 'all'} onPress={() => setPing('all')} tokens={tokens} /><FilterChip label="В сети" selected={ping === 'online'} onPress={() => setPing('online')} tokens={tokens} /><FilterChip label="Не в сети" selected={ping === 'offline'} onPress={() => setPing('offline')} tokens={tokens} /><FilterChip label="Неизвестно" selected={ping === 'unknown'} onPress={() => setPing('unknown')} tokens={tokens} /></ScrollView>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}><FilterChip label="Любой SNMP" selected={snmp === 'all'} onPress={() => setSnmp('all')} tokens={tokens} /><FilterChip label="Мало расходника" selected={snmp === 'low_toner'} onPress={() => setSnmp('low_toner')} tokens={tokens} /><FilterChip label="Нет данных" selected={snmp === 'no_data'} onPress={() => setSnmp('no_data')} tokens={tokens} /><FilterChip label="Ошибка SNMP" selected={snmp === 'error'} onPress={() => setSnmp('error')} tokens={tokens} /></ScrollView>
      </View> : null}
      {payload ? <Text style={[styles.updated, { color: tokens.textSecondary }]}>Всего {payload.totals.devices} · В сети {payload.totals.online} · Оффлайн {payload.totals.offline}</Text> : null}
      <Text accessibilityLiveRegion="polite" style={[styles.count, { color: tokens.textSecondary }]}>Показано: {filtered.length}</Text>
      {loading && !payload ? <View style={styles.loading}><ActivityIndicator color={tokens.primary} /><Text style={[styles.emptyText, { color: tokens.textSecondary }]}>Загружаем состояние устройств…</Text></View> : null}
      {!loading && error && !payload ? <Pressable testID="native-mfu-retry" onPress={refresh} disabled={offlineMode} accessibilityRole="button" style={[styles.primaryAction, { backgroundColor: tokens.primary, opacity: offlineMode ? 0.5 : 1 }]}><Text style={styles.primaryActionText}>Повторить</Text></Pressable> : null}
    </View>
  );

  return (
    <AccountScreenScaffold title="МФУ" tokens={tokens} scroll={false} rightAction={(
      <Pressable accessibilityRole="button" accessibilityLabel="О разделе МФУ" onPress={() => Alert.alert('МФУ', `Доступны состояние, расходники, счётчики и история. Списание расходника и запись работы пока недоступны.${payload?.generated_at ? `\nОбновлено: ${formatDateTime(payload.generated_at)}` : ''}`)} style={styles.iconButton}>
        <MaterialCommunityIcons name="information-outline" size={23} color={tokens.iconMuted} />
      </Pressable>
    )}>
      <FlatList testID="native-mfu-list" data={filtered} keyExtractor={(device) => device.key} keyboardShouldPersistTaps="handled" contentContainerStyle={filtered.length ? styles.list : styles.emptyList} ListHeaderComponent={header} ListEmptyComponent={!loading && !error && !offlineMode ? <Text style={[styles.emptyText, { color: tokens.textSecondary }]}>{payload?.totals.devices === 0 ? 'В выбранной базе пока нет МФУ.' : 'По выбранным фильтрам устройства не найдены.'}</Text> : null} renderItem={renderDevice} refreshing={refreshing} onRefresh={refresh} />
      <Modal visible={Boolean(selected)} transparent animationType="slide" onRequestClose={closeDevice}>{selected ? <DeviceDetails device={selected} tokens={tokens} onClose={closeDevice} /> : null}</Modal>
    </AccountScreenScaffold>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  header: { gap: 9, paddingBottom: 10 },
  notice: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  updated: { fontSize: 12, lineHeight: 18 },
  search: { minHeight: 48, borderWidth: 1, borderRadius: 13, paddingLeft: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, minHeight: 46, fontSize: 15 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  filters: { gap: 7 },
  quickFilters: { flexDirection: 'row', flexWrap: 'wrap', gap: 7 },
  chip: { minHeight: 42, borderRadius: 21, borderWidth: 1, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 12, lineHeight: 17, fontWeight: '800' },
  count: { minHeight: 24, fontSize: 12, lineHeight: 18, fontWeight: '700' },
  loading: { minHeight: 110, alignItems: 'center', justifyContent: 'center', gap: 9 },
  list: { gap: 9, paddingBottom: 8 },
  emptyList: { flexGrow: 1, paddingBottom: 60 },
  emptyText: { paddingVertical: 12, textAlign: 'center', fontSize: 13, lineHeight: 19 },
  primaryAction: { minHeight: 44, borderRadius: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  primaryActionText: { color: '#fff', fontSize: 13, lineHeight: 18, fontWeight: '800', textAlign: 'center' },
  modalRoot: { flex: 1, justifyContent: 'flex-end' },
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.48)' },
  sheet: { height: '92%', borderTopLeftRadius: 22, borderTopRightRadius: 22, borderWidth: 1, paddingHorizontal: 16, paddingTop: 12 },
  sheetHeader: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 8 },
  sheetTitle: { fontSize: 18, lineHeight: 24, fontWeight: '900' },
  sheetSubtitle: { marginTop: 2, fontSize: 12, lineHeight: 18 },
  sheetContent: { paddingBottom: 32, gap: 9 },
  sectionTitle: { marginTop: 8, fontSize: 14, lineHeight: 19, fontWeight: '900' },
  field: { gap: 2 },
  fieldLabel: { fontSize: 12, lineHeight: 18, fontWeight: '700' },
  fieldValue: { fontSize: 13, lineHeight: 18 },
  listRow: { minHeight: 48, borderBottomWidth: 1, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 10 },
  historyRow: { minHeight: 48, borderBottomWidth: 1, paddingVertical: 8 },
  rowTitle: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  rowValue: { fontSize: 12, lineHeight: 17, fontWeight: '900' },
  rowHint: { marginTop: 2, fontSize: 12, lineHeight: 18 },
});
