import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { File, Paths } from 'expo-file-system';
import {
  fetchStatistics,
  statisticsExportUrl,
  type BatteryStatistics,
  type MfuStatistics,
  type PcCleaningBranchStat,
  type PcCleaningStatistics,
  type PcComponentsStatistics,
  type StatisticsLocationRow,
  type StatisticsPayload,
  type StatisticsTab,
} from '../../api/statisticsApi';
import { formatApiError } from '../../api/formatError';
import { getCurrentDatabase, listAvailableDatabases, switchDatabase } from '../../api/databaseApi';
import type { CurrentDatabase } from '../../api/databaseApi';
import type { DatabaseOption } from '../../account/accountFormat';
import { useAuth } from '../../auth/AuthContext';
import { usePreferences } from '../../preferences/PreferencesContext';
import {
  formatNativeSnapshotSavedAt,
  readNativeCollectionSnapshot,
  readNativeSnapshot,
  writeNativeCollectionSnapshot,
  writeNativeSnapshot,
} from '../../cache/nativeSnapshotCache';
import type { NativeDatabaseBootstrapSnapshot } from '../../database/nativeDatabaseSnapshot';
import { downloadAuthenticatedFile } from '../../files/authenticatedFileDownload';
import { shareNativeFile } from '../../files/nativeAttachmentDownloads';
import { sanitizeNativeFileName } from '../../files/filePolicy';
import {
  filterPcBranches,
  filterStatisticsLocations,
  formatStatisticsFullTimestamp,
  formatStatisticsTimestamp,
  STATISTICS_PERIOD_OPTIONS,
  STATISTICS_TAB_OPTIONS,
  statisticsCoverageTone,
  statisticsTabTitle,
} from '../../statistics/nativeStatisticsModel';
import { useFluentTokens } from '../../theme/fluentTokens';
import type { FluentTokens } from '../../theme/fluentTokens';
import { AccountScreenScaffold } from '../account/AccountChrome';
import { NativeDatabasePickerSheet } from '../../components/database/NativeDatabasePickerSheet';
import { NativeSegmentedControl } from '../../components/ui/NativeFilterControls';
import { NativePcRemainingSheet } from './NativePcRemainingSheet';

const SNAPSHOT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function snapshotKey(databaseId: string, tab: StatisticsTab, periodDays: number): string {
  return `${databaseId || 'session'}|${tab}|${periodDays}`;
}

function payloadKey(databaseId: string | undefined, tab: StatisticsTab, periodDays: number): string {
  return JSON.stringify([databaseId, tab, periodDays]);
}

function toneColor(tokens: FluentTokens, tone: 'success' | 'warning' | 'error'): string {
  if (tone === 'success') return tokens.success;
  if (tone === 'warning') return tokens.warning;
  return tokens.error;
}

function MetricCard({ label, value, color, tokens }: {
  label: string;
  value: string;
  color?: string;
  tokens: FluentTokens;
}) {
  return (
    <View style={[styles.metricCard, { backgroundColor: tokens.panelSolid, borderColor: tokens.border }]}>
      <Text style={[styles.metricLabel, { color: tokens.textSecondary }]}>{label}</Text>
      <Text style={[styles.metricValue, { color: color || tokens.textPrimary }]}>{value}</Text>
    </View>
  );
}

function SectionCard({ title, tokens, children }: { title: string; tokens: FluentTokens; children: React.ReactNode }) {
  return (
    <View style={[styles.card, { backgroundColor: tokens.panelSolid, borderColor: tokens.border }]}>
      <Text style={[styles.cardTitle, { color: tokens.textPrimary }]}>{title}</Text>
      {children}
    </View>
  );
}

function DistributionCard({ title, data, limit = 8, tokens }: {
  title: string;
  data: Record<string, number>;
  limit?: number;
  tokens: FluentTokens;
}) {
  const entries = Object.entries(data || {}).slice(0, limit);
  if (!entries.length) return null;
  return (
    <SectionCard title={title} tokens={tokens}>
      <View style={styles.distributionWrap}>
        {entries.map(([label, count]) => (
          <View key={label} style={[styles.distributionChip, { backgroundColor: tokens.selected, borderColor: tokens.border }]}>
            <Text style={[styles.distributionText, { color: tokens.textPrimary }]}>{label}: {count}</Text>
          </View>
        ))}
      </View>
    </SectionCard>
  );
}

function RowMeta({ text, tokens }: { text: string; tokens: FluentTokens }) {
  if (!text || text === '—') return <Text style={[styles.rowMeta, { color: tokens.textTertiary }]}>—</Text>;
  return <Text style={[styles.rowMeta, { color: tokens.textSecondary }]}>{text}</Text>;
}

export function NativeStatisticsScreen() {
  const { user } = useAuth();
  return <StatisticsContent key={user?.id} />;
}

function StatisticsContent() {
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const { hasPermission, offlineMode, user } = useAuth();
  const canView = hasPermission('statistics.read');
  const canViewMfu = hasPermission('mfu.read');
  const canWriteDatabase = hasPermission('database.write');
  const userId = Number(user?.id || 0);

  const [tab, setTab] = useState<StatisticsTab>('pc');
  const [periodDays, setPeriodDays] = useState(90);
  const [query, setQuery] = useState('');
  const [payloads, setPayloads] = useState<Record<string, StatisticsPayload>>({});
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const [exporting, setExporting] = useState(false);
  const [snapshotAt, setSnapshotAt] = useState<number | null>(null);

  const [databases, setDatabases] = useState<DatabaseOption[]>([]);
  const [currentDatabase, setCurrentDatabase] = useState<CurrentDatabase | null>(null);
  const [dbPickerOpen, setDbPickerOpen] = useState(false);
  const [dbSwitching, setDbSwitching] = useState(false);
  const [remainingBranch, setRemainingBranch] = useState<PcCleaningBranchStat | null>(null);

  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const bootstrapGenerationRef = useRef(0);
  const snapshotGenerationRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const loadRef = useRef<(options?: { silent?: boolean }) => Promise<void>>(async () => {});
  useEffect(() => () => { mountedRef.current = false; abortRef.current?.abort(); }, []);

  const load = useCallback(async (options: { silent?: boolean } = {}) => {
    if (!canView || offlineMode || !currentDatabase) return;
    const generation = ++generationRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (!options.silent) setLoading(true);
    setError('');
    try {
      const payload = await fetchStatistics(tab, {
        periodDays,
        databaseId: currentDatabase.id,
        signal: controller.signal,
      });
      if (!mountedRef.current || generation !== generationRef.current) return;
      setPayloads((current) => ({ ...current, [payloadKey(currentDatabase.id, tab, periodDays)]: payload }));
      setSnapshotAt(null);
      if (userId > 0) {
        void writeNativeCollectionSnapshot(
          'statistics-inbox',
          userId,
          snapshotKey(currentDatabase.id, tab, periodDays),
          payload.data,
        ).catch(() => undefined);
      }
    } catch (requestError) {
      if (!mountedRef.current || generation !== generationRef.current) return;
      if (controller.signal.aborted) return;
      setError(formatApiError(requestError, 'Не удалось загрузить статистику'));
    } finally {
      if (mountedRef.current && generation === generationRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [canView, offlineMode, currentDatabase, tab, periodDays, userId]);
  useEffect(() => { loadRef.current = load; }, [load]);

  const restoreSnapshot = useCallback(async () => {
    if (!userId || !currentDatabase) return;
    const generation = ++snapshotGenerationRef.current;
    const snapshot = await readNativeCollectionSnapshot<PcCleaningStatistics | MfuStatistics | BatteryStatistics | PcComponentsStatistics>(
      'statistics-inbox',
      userId,
      snapshotKey(currentDatabase.id, tab, periodDays),
      SNAPSHOT_MAX_AGE_MS,
    ).catch(() => null);
    if (!mountedRef.current || generation !== snapshotGenerationRef.current) return;
    setError('');
    setSnapshotAt(snapshot?.savedAt ?? null);
    const key = payloadKey(currentDatabase.id, tab, periodDays);
    setPayloads((current) => {
      const next = { ...current };
      if (snapshot) next[key] = { tab, data: snapshot.data } as StatisticsPayload;
      else delete next[key];
      return next;
    });
  }, [userId, currentDatabase, tab, periodDays]);

  useEffect(() => {
    if (tab === 'mfu' && !canViewMfu) setTab('pc');
  }, [tab, canViewMfu]);

  useEffect(() => {
    setRemainingBranch(null);
  }, [tab, periodDays, currentDatabase?.id]);

  useEffect(() => {
    if (!canView || !currentDatabase) return;
    if (offlineMode) {
      generationRef.current += 1;
      abortRef.current?.abort();
      setLoading(false);
      setRefreshing(false);
      void restoreSnapshot();
    } else {
      void loadRef.current();
    }
    return () => {
      snapshotGenerationRef.current += 1;
      generationRef.current += 1;
      abortRef.current?.abort();
    };
  }, [canView, offlineMode, currentDatabase, restoreSnapshot]);

  const bootstrap = useCallback(async () => {
    if (!canView) return;
    const generation = ++bootstrapGenerationRef.current;
    const isCurrent = () => mountedRef.current && generation === bootstrapGenerationRef.current;
    setError('');
    const restoreDatabase = async () => {
      const snapshot = userId ? await readNativeSnapshot<NativeDatabaseBootstrapSnapshot>(
        'database-bootstrap', userId,
      ).catch(() => null) : null;
      if (!isCurrent()) return false;
      if (!snapshot?.data.currentDatabase?.id) return false;
      setDatabases(snapshot.data.databases);
      setCurrentDatabase((previous) => previous?.id === snapshot.data.currentDatabase.id
        ? previous : snapshot.data.currentDatabase);
      return true;
    };
    try {
      if (offlineMode) {
        const restored = await restoreDatabase();
        if (isCurrent() && !restored) setError('Нет подключения и сохранённой базы для статистики. Откройте раздел при подключении к сети.');
      } else {
        const [available, current] = await Promise.all([listAvailableDatabases(), getCurrentDatabase()]);
        if (!isCurrent()) return;
        setDatabases(available);
        setCurrentDatabase((previous) => {
          if (previous?.id === current?.id) return previous;
          return current;
        });
        if (userId) void writeNativeSnapshot<NativeDatabaseBootstrapSnapshot>('database-bootstrap', userId, {
          databases: available, currentDatabase: current,
        }).catch(() => undefined);
      }
    } catch (cause) {
      const restored = await restoreDatabase();
      if (isCurrent() && !restored) setError(formatApiError(cause, 'Не удалось загрузить базу для статистики.'));
    } finally {
      if (isCurrent()) setRefreshing(false);
    }
  }, [canView, offlineMode, userId]);

  useFocusEffect(useCallback(() => {
    void bootstrap();
    return () => { bootstrapGenerationRef.current += 1; };
  }, [bootstrap]));

  const changeDatabase = useCallback(async (option: DatabaseOption) => {
    if (dbSwitching || offlineMode || !option?.id) return;
    setDbPickerOpen(false);
    setDbSwitching(true);
    try {
      const switched = await switchDatabase(option.id);
      if (!mountedRef.current) return;
      setPayloads({});
      setCurrentDatabase(switched);
      if (userId) void writeNativeSnapshot<NativeDatabaseBootstrapSnapshot>('database-bootstrap', userId, {
        databases, currentDatabase: switched,
      }).catch(() => undefined);
    } catch (requestError) {
      if (mountedRef.current) {
        Alert.alert('Не удалось переключить базу', formatApiError(requestError, 'Повторите попытку'));
      }
    } finally {
      if (mountedRef.current) setDbSwitching(false);
    }
  }, [databases, dbSwitching, offlineMode, userId]);

  const exportExcel = useCallback(async () => {
    if (exporting || offlineMode) return;
    setExporting(true);
    try {
      const fileName = sanitizeNativeFileName(`statistics_${tab}_${periodDays}d.xlsx`);
      const target = new File(Paths.cache, fileName);
      if (target.exists) target.delete();
      const file = await downloadAuthenticatedFile(
        statisticsExportUrl(tab, periodDays, currentDatabase?.id),
        target,
      );
      await shareNativeFile(file, fileName, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    } catch (requestError) {
      Alert.alert('Не удалось экспортировать отчёт', formatApiError(requestError, 'Повторите попытку'));
    } finally {
      setExporting(false);
    }
  }, [exporting, offlineMode, tab, periodDays, currentDatabase?.id]);

  const refresh = useCallback(() => {
    setRefreshing(true);
    if (!currentDatabase) {
      void bootstrap();
      return;
    }
    if (offlineMode) {
      void restoreSnapshot().finally(() => {
        if (mountedRef.current) setRefreshing(false);
      });
      return;
    }
    void loadRef.current();
  }, [bootstrap, currentDatabase, offlineMode, restoreSnapshot]);

  const payload = payloads[payloadKey(currentDatabase?.id, tab, periodDays)];
  const pcStats = payload?.tab === 'pc' ? payload.data as PcCleaningStatistics : null;
  const mfuStats = payload?.tab === 'mfu' ? payload.data as MfuStatistics : null;
  const batteryStats = payload?.tab === 'battery' ? payload.data as BatteryStatistics : null;
  const pcComponentsStats = payload?.tab === 'pc_components' ? payload.data as PcComponentsStatistics : null;
  const currentStats = pcStats || mfuStats || batteryStats || pcComponentsStats;

  const filteredBranches = useMemo(
    () => filterPcBranches(pcStats?.branches, query),
    [pcStats?.branches, query],
  );
  const filteredLocations = useMemo(
    () => filterStatisticsLocations(
      mfuStats?.by_location_period || batteryStats?.by_location_period || pcComponentsStats?.by_location_period,
      query,
    ),
    [mfuStats, batteryStats, pcComponentsStats, query],
  );

  const visibleTabs = STATISTICS_TAB_OPTIONS.filter((option) => option.value !== 'mfu' || canViewMfu);

  const renderLocationRow = (row: StatisticsLocationRow, index: number) => (
    <View key={`${row.branch}|${row.location}|${index}`} style={[styles.listRow, { borderColor: tokens.borderSoft }]}>
      <View style={styles.listRowMain}>
        <Text style={[styles.rowTitle, { color: tokens.textPrimary }]}>{row.branch}</Text>
        <RowMeta text={row.location} tokens={tokens} />
      </View>
      <View style={styles.listRowMeta}>
        <View style={[styles.countBadge, { borderColor: tokens.primary }]}>
          <Text style={[styles.countBadgeText, { color: tokens.primary }]}>{row.operations}</Text>
        </View>
        <Text style={[styles.rowMeta, { color: tokens.textSecondary }]}>
          {formatStatisticsTimestamp(row.last_timestamp)}
        </Text>
      </View>
      {row.top_items.length ? (
        <View style={styles.inlineChips}>
          {row.top_items.slice(0, 3).map((item, itemIndex) => (
            <View key={itemIndex} style={[styles.miniChip, { borderColor: tokens.border }]}>
              <Text style={[styles.miniChipText, { color: tokens.textSecondary }]}>{item.name} ({item.count})</Text>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  );

  const renderRecentHeader = (labels: [string, string, string]) => (
    <View style={[styles.recentHeader, { borderColor: tokens.borderSoft }]}>
      <Text style={[styles.recentHeaderCell, styles.recentCellDate, { color: tokens.textTertiary }]}>Дата</Text>
      <Text style={[styles.recentHeaderCell, styles.recentCellBranch, { color: tokens.textTertiary }]}>Филиал / локация</Text>
      <Text style={[styles.recentHeaderCell, styles.recentCellItem, { color: tokens.textTertiary }]}>{labels[0]}</Text>
      <Text style={[styles.recentHeaderCell, styles.recentCellItem, { color: tokens.textTertiary }]}>{labels[1]}</Text>
      <Text style={[styles.recentHeaderCell, styles.recentCellItem, { color: tokens.textTertiary }]}>{labels[2]}</Text>
    </View>
  );

  return (
    <AccountScreenScaffold
      title={statisticsTabTitle(tab)}
      tokens={tokens}
      refreshing={refreshing}
      onRefresh={refresh}
      rightAction={(
        <Pressable
          onPress={exportExcel}
          disabled={exporting || offlineMode || !canView}
          accessibilityRole="button"
          accessibilityLabel="Экспорт Excel"
          testID="native-statistics-export"
          style={[styles.headerAction, { opacity: exporting || offlineMode || !canView ? 0.4 : 1 }]}
        >
          {exporting
            ? <ActivityIndicator size="small" color={tokens.primary} />
            : <MaterialCommunityIcons name="file-excel-outline" size={22} color={tokens.primary} />}
        </Pressable>
      )}
    >
      {offlineMode ? (
        <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.warning }]}>
          {snapshotAt
            ? `Автономный режим: данные из кэша от ${formatNativeSnapshotSavedAt(snapshotAt)}.`
            : 'Автономный режим: снимок статистики не сохранён.'}
        </Text>
      ) : null}

      <View style={styles.controls}>
        <Pressable
          onPress={() => setDbPickerOpen(true)}
          disabled={offlineMode || dbSwitching || databases.length < 2}
          accessibilityRole="button"
          accessibilityLabel={`База данных: ${currentDatabase?.name || currentDatabase?.id || 'не выбрана'}`}
          testID="native-statistics-db"
          style={[styles.dbChip, { backgroundColor: tokens.panelSolid, borderColor: tokens.border }]}
        >
          <MaterialCommunityIcons name="database-outline" size={16} color={tokens.iconMuted} />
          <Text numberOfLines={1} style={[styles.dbChipText, { color: tokens.textPrimary }]}>
            {dbSwitching ? 'Переключение…' : (currentDatabase?.name || currentDatabase?.id || 'База не выбрана')}
          </Text>
          {databases.length > 1 ? <MaterialCommunityIcons name="chevron-down" size={16} color={tokens.iconMuted} /> : null}
        </Pressable>

        <View style={[styles.search, { backgroundColor: tokens.panelSolid, borderColor: tokens.border }]}>
          <MaterialCommunityIcons name="magnify" size={20} color={tokens.iconMuted} />
          <TextInput
            testID="native-statistics-search"
            value={query}
            onChangeText={(value) => setQuery(value.slice(0, 200))}
            placeholder={tab === 'pc' ? 'Фильтр по филиалу' : 'Фильтр по филиалу/локации'}
            placeholderTextColor={tokens.textTertiary}
            accessibilityLabel="Фильтр статистики"
            style={[styles.searchInput, { color: tokens.textPrimary }]}
          />
          {query ? (
            <Pressable onPress={() => setQuery('')} accessibilityRole="button" accessibilityLabel="Очистить фильтр" style={styles.iconButton}>
              <MaterialCommunityIcons name="close" size={18} color={tokens.iconMuted} />
            </Pressable>
          ) : null}
        </View>
      </View>

      <NativeSegmentedControl
        options={visibleTabs}
        selected={tab}
        onSelect={(value) => setTab(value as StatisticsTab)}
        tokens={tokens}
        testIDPrefix="native-statistics-tab"
      />

      <NativeSegmentedControl
        options={STATISTICS_PERIOD_OPTIONS.map((option) => ({ value: String(option.value), label: option.label }))}
        selected={String(periodDays)}
        onSelect={(value) => setPeriodDays(Number(value))}
        tokens={tokens}
        testIDPrefix="native-statistics-period"
      />

      {currentStats && currentStats.period_days === periodDays ? (
        <Text style={[styles.periodCaption, { color: tokens.textSecondary }]}>
          Период: {currentStats.start_date || '—'} — {currentStats.end_date || '—'}
        </Text>
      ) : null}

      {loading && !currentStats ? <ActivityIndicator style={styles.loader} color={tokens.primary} /> : null}
      {loading && currentStats ? <ActivityIndicator size="small" color={tokens.primary} /> : null}

      {error && !currentStats ? (
        <View style={styles.errorWrap}>
          <Text style={[styles.errorText, { color: tokens.error }]}>{error}</Text>
          <Pressable
            onPress={refresh}
            disabled={offlineMode}
            accessibilityRole="button"
            testID="native-statistics-retry"
            style={[styles.primaryAction, { backgroundColor: tokens.primary, opacity: offlineMode ? 0.5 : 1 }]}
          >
            <Text style={styles.primaryActionText}>Повторить</Text>
          </Pressable>
        </View>
      ) : null}
      {error && currentStats ? <Text style={[styles.errorText, { color: tokens.error }]}>{error}</Text> : null}

      {tab === 'pc' && pcStats ? (
        <>
          <View style={styles.metricGrid}>
            <MetricCard label="ПК всего" value={String(pcStats.totals.total_pc)} tokens={tokens} />
            <MetricCard label="Почищено" value={String(pcStats.totals.cleaned_pc)} color={tokens.success} tokens={tokens} />
            <MetricCard label="Осталось" value={String(pcStats.totals.remaining_pc)} color={tokens.error} tokens={tokens} />
            <MetricCard label="Покрытие" value={`${pcStats.totals.coverage_percent}%`} tokens={tokens} />
            <MetricCard label="Чисток за период" value={String(pcStats.totals.cleanings_period)} tokens={tokens} />
          </View>

          <SectionCard title="По филиалам" tokens={tokens}>
            {filteredBranches.length === 0 ? (
              <Text style={[styles.emptyText, { color: tokens.textSecondary }]}>Нет данных по выбранному фильтру</Text>
            ) : filteredBranches.map((row) => (
              <Pressable
                key={row.branch}
                onPress={() => setRemainingBranch(row)}
                accessibilityRole="button"
                accessibilityLabel={`Непочищенные ПК: ${row.branch}`}
                testID={`native-statistics-branch-${row.branch}`}
                style={[styles.branchRow, { borderColor: tokens.borderSoft }]}
              >
                <View style={styles.listRowMain}>
                  <Text style={[styles.rowTitle, { color: tokens.textPrimary }]}>{row.branch}</Text>
                  <Text style={[styles.rowMeta, { color: tokens.textSecondary }]}>
                    {row.cleaned_pc} из {row.total_pc} · чисток за период: {row.cleanings_period}
                  </Text>
                </View>
                <View style={styles.listRowMeta}>
                  <View style={[styles.countBadge, {
                    borderColor: row.remaining_pc > 0 ? tokens.error : tokens.success,
                    backgroundColor: row.remaining_pc > 0 ? 'transparent' : 'transparent',
                  }]}>
                    <Text style={[styles.countBadgeText, { color: row.remaining_pc > 0 ? tokens.error : tokens.success }]}>
                      {row.remaining_pc}
                    </Text>
                  </View>
                  <Text style={[styles.coverageText, { color: toneColor(tokens, statisticsCoverageTone(row.coverage_percent)) }]}>
                    {row.coverage_percent}%
                  </Text>
                </View>
              </Pressable>
            ))}
            <Text style={[styles.hint, { color: tokens.textTertiary }]}>
              Нажмите филиал, чтобы открыть список ПК без чистки за период.
            </Text>
          </SectionCard>
        </>
      ) : null}

      {tab === 'mfu' && mfuStats ? (
        <>
          <View style={styles.metricGrid}>
            <MetricCard label="Операций за период" value={String(mfuStats.totals.total_operations)} tokens={tokens} />
            <MetricCard label="Филиалов" value={String(mfuStats.totals.unique_branches)} tokens={tokens} />
            <MetricCard label="Локаций" value={String(mfuStats.totals.unique_locations)} tokens={tokens} />
          </View>
          <DistributionCard title="Сколько чего использовано (типы)" data={mfuStats.by_type_period} tokens={tokens} />
          <DistributionCard title="Сколько чего использовано (позиции)" data={mfuStats.by_item_period} tokens={tokens} />
          <DistributionCard title="По филиалам" data={mfuStats.by_branch_period} tokens={tokens} />
          <DistributionCard
            title="По моделям МФУ"
            data={Object.fromEntries(mfuStats.by_model_period.slice(0, 15).map((item) => [item.model, item.count]))}
            tokens={tokens}
          />
          <SectionCard title="Где меняли" tokens={tokens}>
            {filteredLocations.length === 0 ? (
              <Text style={[styles.emptyText, { color: tokens.textSecondary }]}>Нет данных по выбранному фильтру</Text>
            ) : filteredLocations.map(renderLocationRow)}
          </SectionCard>
          <SectionCard title="Что и где поменяно (последние записи)" tokens={tokens}>
            {renderRecentHeader(['Модель', 'Тип', 'Позиция'])}
            {mfuStats.recent_replacements.length === 0 ? (
              <Text style={[styles.emptyText, { color: tokens.textSecondary }]}>За выбранный период записей нет</Text>
            ) : mfuStats.recent_replacements.map((row, index) => (
              <View key={`${row.timestamp}-${row.serial_no || row.inv_no || index}`} style={[styles.recentRow, { borderColor: tokens.borderSoft }]}>
                <Text style={[styles.recentCell, styles.recentCellDate, { color: tokens.textSecondary }]}>{formatStatisticsFullTimestamp(row.timestamp)}</Text>
                <View style={styles.recentCellBranch}>
                  <Text style={[styles.recentCellStrong, { color: tokens.textPrimary }]}>{row.branch || '—'}</Text>
                  <Text style={[styles.recentCellSub, { color: tokens.textSecondary }]}>{row.location || '—'}</Text>
                </View>
                <Text style={[styles.recentCell, styles.recentCellItem, { color: tokens.textSecondary }]}>{row.printer_model || '—'}</Text>
                <Text style={[styles.recentCell, styles.recentCellItem, { color: tokens.textSecondary }]}>{row.component_type || '—'}</Text>
                <Text style={[styles.recentCell, styles.recentCellItem, { color: tokens.textSecondary }]}>{row.replacement_item || '—'}</Text>
              </View>
            ))}
          </SectionCard>
        </>
      ) : null}

      {tab === 'battery' && batteryStats ? (
        <>
          <View style={styles.metricGrid}>
            <MetricCard label="Замен за период" value={String(batteryStats.totals.total_operations)} tokens={tokens} />
            <MetricCard label="Филиалов" value={String(batteryStats.totals.unique_branches)} tokens={tokens} />
            <MetricCard label="Локаций" value={String(batteryStats.totals.unique_locations)} tokens={tokens} />
          </View>
          <DistributionCard title="Сколько батарей использовано" data={batteryStats.by_item_period} tokens={tokens} />
          <DistributionCard title="По производителям ИБП" data={batteryStats.by_manufacturer_period} tokens={tokens} />
          <DistributionCard title="По филиалам" data={batteryStats.by_branch_period} tokens={tokens} />
          <SectionCard title="Где меняли батареи" tokens={tokens}>
            {filteredLocations.length === 0 ? (
              <Text style={[styles.emptyText, { color: tokens.textSecondary }]}>Нет данных по выбранному фильтру</Text>
            ) : filteredLocations.map(renderLocationRow)}
          </SectionCard>
          <SectionCard title="Последние замены батарей" tokens={tokens}>
            {renderRecentHeader(['Модель ИБП', 'Производитель', 'Позиция'])}
            {batteryStats.recent_replacements.length === 0 ? (
              <Text style={[styles.emptyText, { color: tokens.textSecondary }]}>За выбранный период записей нет</Text>
            ) : batteryStats.recent_replacements.map((row, index) => (
              <View key={`${row.timestamp}-${row.serial_no || row.inv_no || index}`} style={[styles.recentRow, { borderColor: tokens.borderSoft }]}>
                <Text style={[styles.recentCell, styles.recentCellDate, { color: tokens.textSecondary }]}>{formatStatisticsFullTimestamp(row.timestamp)}</Text>
                <View style={styles.recentCellBranch}>
                  <Text style={[styles.recentCellStrong, { color: tokens.textPrimary }]}>{row.branch || '—'}</Text>
                  <Text style={[styles.recentCellSub, { color: tokens.textSecondary }]}>{row.location || '—'}</Text>
                </View>
                <Text style={[styles.recentCell, styles.recentCellItem, { color: tokens.textSecondary }]}>{row.model_name || '—'}</Text>
                <Text style={[styles.recentCell, styles.recentCellItem, { color: tokens.textSecondary }]}>{row.manufacturer || '—'}</Text>
                <Text style={[styles.recentCell, styles.recentCellItem, { color: tokens.textSecondary }]}>{row.replacement_item || '—'}</Text>
              </View>
            ))}
          </SectionCard>
        </>
      ) : null}

      {tab === 'pc_components' && pcComponentsStats ? (
        <>
          <View style={styles.metricGrid}>
            <MetricCard label="Операций за период" value={String(pcComponentsStats.totals.total_operations)} tokens={tokens} />
            <MetricCard label="Филиалов" value={String(pcComponentsStats.totals.unique_branches)} tokens={tokens} />
            <MetricCard label="Локаций" value={String(pcComponentsStats.totals.unique_locations)} tokens={tokens} />
          </View>
          <DistributionCard title="По компонентам" data={pcComponentsStats.by_component_period} tokens={tokens} />
          <DistributionCard title="По позициям" data={pcComponentsStats.by_item_period} tokens={tokens} />
          <DistributionCard title="По филиалам" data={pcComponentsStats.by_branch_period} tokens={tokens} />
          <DistributionCard
            title="По моделям ПК"
            data={Object.fromEntries(pcComponentsStats.by_model_period.slice(0, 15).map((item) => [item.model, item.count]))}
            tokens={tokens}
          />
          <SectionCard title="Где меняли комплектующие ПК" tokens={tokens}>
            {filteredLocations.length === 0 ? (
              <Text style={[styles.emptyText, { color: tokens.textSecondary }]}>Нет данных по выбранному фильтру</Text>
            ) : filteredLocations.map(renderLocationRow)}
          </SectionCard>
          <SectionCard title="Последние замены комплектующих ПК" tokens={tokens}>
            {renderRecentHeader(['Модель ПК', 'Компонент', 'Позиция'])}
            {pcComponentsStats.recent_replacements.length === 0 ? (
              <Text style={[styles.emptyText, { color: tokens.textSecondary }]}>За выбранный период записей нет</Text>
            ) : pcComponentsStats.recent_replacements.map((row, index) => (
              <View key={`${row.timestamp}-${row.serial_no || row.inv_no || index}`} style={[styles.recentRow, { borderColor: tokens.borderSoft }]}>
                <Text style={[styles.recentCell, styles.recentCellDate, { color: tokens.textSecondary }]}>{formatStatisticsFullTimestamp(row.timestamp)}</Text>
                <View style={styles.recentCellBranch}>
                  <Text style={[styles.recentCellStrong, { color: tokens.textPrimary }]}>{row.branch || '—'}</Text>
                  <Text style={[styles.recentCellSub, { color: tokens.textSecondary }]}>{row.location || '—'}</Text>
                </View>
                <Text style={[styles.recentCell, styles.recentCellItem, { color: tokens.textSecondary }]}>{row.model_name || '—'}</Text>
                <Text style={[styles.recentCell, styles.recentCellItem, { color: tokens.textSecondary }]}>{row.component_name || '—'}</Text>
                <Text style={[styles.recentCell, styles.recentCellItem, { color: tokens.textSecondary }]}>{row.replacement_item || '—'}</Text>
              </View>
            ))}
          </SectionCard>
        </>
      ) : null}

      {!loading && !error && !currentStats && canView ? (
        <Text style={[styles.emptyText, { color: tokens.textSecondary }]}>
          {offlineMode ? 'Сохранённого снимка нет.' : 'Данных за выбранный период нет.'}
        </Text>
      ) : null}
      {!canView ? (
        <Text style={[styles.emptyText, { color: tokens.textSecondary }]}>Нет доступа к статистике.</Text>
      ) : null}

      <NativeDatabasePickerSheet
        visible={dbPickerOpen}
        subtitle="Статистика переключится на выбранную базу"
        options={databases}
        currentId={currentDatabase?.id}
        switching={dbSwitching}
        accentColor={tokens.primary}
        tokens={tokens}
        testIDPrefix="native-statistics-db"
        onClose={() => setDbPickerOpen(false)}
        onSelect={(option) => void changeDatabase(option as DatabaseOption)}
      />

      <NativePcRemainingSheet
        visible={Boolean(remainingBranch)}
        branchRow={remainingBranch}
        periodDays={periodDays}
        databaseId={currentDatabase?.id}
        canWrite={canWriteDatabase && !offlineMode}
        onClose={() => setRemainingBranch(null)}
        onCleaningSaved={() => { void loadRef.current({ silent: true }); }}
      />
    </AccountScreenScaffold>
  );
}

const styles = StyleSheet.create({
  notice: { fontSize: 13, marginBottom: 8, paddingHorizontal: 2 },
  controls: { gap: 8, marginBottom: 8 },
  dbChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8,
    alignSelf: 'flex-start', maxWidth: '100%',
  },
  dbChipText: { fontSize: 13, fontWeight: '600', flexShrink: 1 },
  search: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    borderWidth: 1, borderRadius: 10, paddingHorizontal: 10,
  },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 8 },
  iconButton: { padding: 4 },

  periodCaption: { fontSize: 12, marginBottom: 8 },
  loader: { marginVertical: 24 },
  errorWrap: { alignItems: 'center', gap: 12, paddingVertical: 24 },
  errorText: { fontSize: 14, textAlign: 'center' },
  primaryAction: { borderRadius: 10, paddingHorizontal: 20, paddingVertical: 10 },
  primaryActionText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 4 },
  metricCard: {
    flexGrow: 1, flexBasis: '30%', minWidth: 104,
    borderWidth: 1, borderRadius: 12, padding: 12, gap: 4,
  },
  metricLabel: { fontSize: 12 },
  metricValue: { fontSize: 22, fontWeight: '700' },
  card: { borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 8, gap: 6 },
  cardTitle: { fontSize: 15, fontWeight: '700' },
  distributionWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  distributionChip: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 5 },
  distributionText: { fontSize: 12 },
  branchRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: 8,
  },
  listRow: { paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, gap: 4 },
  listRowMain: { flex: 1, gap: 2 },
  listRowMeta: { alignItems: 'flex-end', gap: 4 },
  rowTitle: { fontSize: 15, fontWeight: '600' },
  rowMeta: { fontSize: 12 },
  countBadge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, minWidth: 32, alignItems: 'center' },
  countBadgeText: { fontSize: 12, fontWeight: '700' },
  coverageText: { fontSize: 13, fontWeight: '700' },
  inlineChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 4 },
  miniChip: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  miniChipText: { fontSize: 11 },
  recentHeader: { flexDirection: 'row', gap: 6, paddingBottom: 6, borderBottomWidth: StyleSheet.hairlineWidth },
  recentHeaderCell: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
  recentRow: { flexDirection: 'row', gap: 6, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  recentCell: { fontSize: 11 },
  recentCellStrong: { fontSize: 12, fontWeight: '600' },
  recentCellSub: { fontSize: 11 },
  recentCellDate: { width: 86 },
  recentCellBranch: { flex: 1.4 },
  recentCellItem: { flex: 1 },
  hint: { fontSize: 12, marginTop: 4 },
  emptyText: { fontSize: 14, textAlign: 'center', paddingVertical: 16 },
  headerAction: { padding: 6 },
});
