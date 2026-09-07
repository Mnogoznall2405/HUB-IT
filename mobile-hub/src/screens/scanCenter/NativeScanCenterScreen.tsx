import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  FlatList,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  getScanDashboard,
  listScanAgents,
  listScanHosts,
  listScanIncidents,
  listScanReviewItems,
  type ScanAgent,
  type ScanCenterSection,
  type ScanDashboard,
  type ScanHost,
  type ScanIncident,
  type ScanReviewItem,
} from '../../api/scanCenterApi';
import { formatApiError } from '../../api/formatError';
import { useAuth } from '../../auth/AuthContext';
import {
  NativeScanAgentCard,
  NativeScanHostCard,
  NativeScanIncidentCard,
  NativeScanReviewCard,
} from '../../components/scanCenter/NativeScanCenterCards';
import { usePreferences } from '../../preferences/PreferencesContext';
import {
  buildScanAttentionItems,
  formatScanCount,
  mergeScanPage,
  SCAN_CENTER_SECTIONS,
} from '../../scanCenter/nativeScanCenterModel';
import { useFluentTokens } from '../../theme/fluentTokens';
import { AccountScreenScaffold, AccountSectionCard } from '../account/AccountChrome';

const PAGE_SIZE = 50;
const AUTO_REFRESH_MS = 30_000;

type ScanRow =
  | { kind: 'incident'; item: ScanIncident }
  | { kind: 'review'; item: ScanReviewItem }
  | { kind: 'agent'; item: ScanAgent }
  | { kind: 'host'; item: ScanHost };

function scanRowKey(row: ScanRow): string {
  if (row.kind === 'incident' || row.kind === 'review') return `${row.kind}:${row.item.id}`;
  if (row.kind === 'agent') return `agent:${row.item.agent_id}`;
  return `host:${row.item.hostname}`;
}

function FilterChip({
  label,
  selected,
  onPress,
  disabled,
  tokens,
  testID,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
  tokens: ReturnType<typeof useFluentTokens>;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled }}
      style={[
        styles.filterChip,
        {
          backgroundColor: selected ? tokens.primary : tokens.panelSolid,
          borderColor: selected ? tokens.primary : tokens.border,
          opacity: disabled ? 0.55 : 1,
        },
      ]}
    >
      <Text style={[styles.filterChipText, { color: selected ? '#fff' : tokens.textPrimary }]}>{label}</Text>
    </Pressable>
  );
}

export function NativeScanCenterScreen() {
  const { hasPermission, offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const canRead = hasPermission('scan.read');
  const canAck = hasPermission('scan.ack');
  const canRunTasks = hasPermission('scan.tasks');
  const [section, setSection] = useState<ScanCenterSection>('overview');
  const [dashboard, setDashboard] = useState<ScanDashboard | null>(null);
  const [overviewReview, setOverviewReview] = useState<ScanReviewItem[]>([]);
  const [incidents, setIncidents] = useState<ScanIncident[]>([]);
  const [reviewItems, setReviewItems] = useState<ScanReviewItem[]>([]);
  const [agents, setAgents] = useState<ScanAgent[]>([]);
  const [hosts, setHosts] = useState<ScanHost[]>([]);
  const [totals, setTotals] = useState<Record<Exclude<ScanCenterSection, 'overview'>, number>>({ incidents: 0, review: 0, agents: 0, hosts: 0 });
  const [queryDraft, setQueryDraft] = useState('');
  const [query, setQuery] = useState('');
  const [incidentStatus, setIncidentStatus] = useState<'' | 'new' | 'ack'>('new');
  const [agentOnline, setAgentOnline] = useState<'' | 'online' | 'offline'>('');
  const [hostStatus, setHostStatus] = useState<'' | 'new' | 'ack'>('');
  const [hostSeverity, setHostSeverity] = useState<'' | 'high' | 'medium' | 'low'>('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState<Record<Exclude<ScanCenterSection, 'overview'>, boolean>>({ incidents: false, review: false, agents: false, hosts: false });
  const [error, setError] = useState('');
  const requestRef = useRef(0);
  const focusedRef = useRef(false);
  const mountedRef = useRef(true);
  const appActiveRef = useRef(AppState.currentState === 'active');
  const busyRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const lengthsRef = useRef({ incidents: 0, review: 0, agents: 0, hosts: 0 });
  lengthsRef.current = { incidents: incidents.length, review: reviewItems.length, agents: agents.length, hosts: hosts.length };

  const clearScanData = useCallback(() => {
    setDashboard(null);
    setOverviewReview([]);
    setIncidents([]);
    setReviewItems([]);
    setAgents([]);
    setHosts([]);
    setTotals({ incidents: 0, review: 0, agents: 0, hosts: 0 });
    setHasMore({ incidents: false, review: false, agents: false, hosts: false });
  }, []);

  const loadOverview = useCallback(async ({ refresh = false, silent = false } = {}) => {
    if (!canRead || offlineMode) {
      requestRef.current += 1;
      abortRef.current?.abort();
      busyRef.current = false;
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
      return;
    }
    const requestId = ++requestRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    busyRef.current = true;
    if (refresh) setRefreshing(true);
    else if (!silent) setLoading(true);
    if (!silent) setError('');
    const [dashboardResult, reviewResult] = await Promise.allSettled([
      getScanDashboard({ signal: controller.signal }),
      listScanReviewItems({ limit: 3, offset: 0, signal: controller.signal }),
    ]);
    if (requestId !== requestRef.current || controller.signal.aborted || !mountedRef.current) return;
    const messages: string[] = [];
    if (dashboardResult.status === 'fulfilled') setDashboard(dashboardResult.value);
    else messages.push(formatApiError(dashboardResult.reason, 'Не удалось загрузить сводку Scan Center.'));
    if (reviewResult.status === 'fulfilled') {
      setOverviewReview(reviewResult.value.items);
      setTotals((current) => ({ ...current, review: reviewResult.value.total }));
    } else {
      messages.push(formatApiError(reviewResult.reason, 'Не удалось загрузить очередь неполных проверок.'));
    }
    setError(messages.join(' '));
    setLoading(false);
    setRefreshing(false);
    busyRef.current = false;
  }, [canRead, offlineMode]);

  const loadRows = useCallback(async ({ reset = false, refresh = false }: { reset?: boolean; refresh?: boolean } = {}) => {
    if (!canRead || offlineMode || section === 'overview') {
      requestRef.current += 1;
      abortRef.current?.abort();
      busyRef.current = false;
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
      return;
    }
    const requestId = ++requestRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    busyRef.current = true;
    const currentLength = lengthsRef.current[section];
    const offset = reset ? 0 : currentLength;
    if (refresh) setRefreshing(true);
    else if (reset) setLoading(true);
    else setLoadingMore(true);
    setError('');
    try {
      if (section === 'incidents') {
        const result = await listScanIncidents({ status: incidentStatus, q: query, limit: PAGE_SIZE, offset, signal: controller.signal });
        if (requestId !== requestRef.current || controller.signal.aborted || !mountedRef.current) return;
        setIncidents((current) => (reset ? result.items : mergeScanPage(current, result.items, (item) => item.id)));
        setTotals((current) => ({ ...current, incidents: result.total }));
        setHasMore((current) => ({ ...current, incidents: result.has_more && result.items.length > 0 }));
      } else if (section === 'review') {
        const result = await listScanReviewItems({ limit: PAGE_SIZE, offset, signal: controller.signal });
        if (requestId !== requestRef.current || controller.signal.aborted || !mountedRef.current) return;
        setReviewItems((current) => (reset ? result.items : mergeScanPage(current, result.items, (item) => item.id)));
        setTotals((current) => ({ ...current, review: result.total }));
        setHasMore((current) => ({ ...current, review: result.has_more && result.items.length > 0 }));
      } else if (section === 'agents') {
        const result = await listScanAgents({ online: agentOnline, q: query, limit: PAGE_SIZE, offset, signal: controller.signal });
        if (requestId !== requestRef.current || controller.signal.aborted || !mountedRef.current) return;
        setAgents((current) => (reset ? result.items : mergeScanPage(current, result.items, (item) => item.agent_id)));
        setTotals((current) => ({ ...current, agents: result.total }));
        setHasMore((current) => ({ ...current, agents: result.has_more && result.items.length > 0 }));
      } else {
        const result = await listScanHosts({ status: hostStatus, severity: hostSeverity, q: query, limit: PAGE_SIZE, offset, signal: controller.signal });
        if (requestId !== requestRef.current || controller.signal.aborted || !mountedRef.current) return;
        setHosts((current) => (reset ? result.items : mergeScanPage(current, result.items, (item) => item.hostname.toLowerCase())));
        setTotals((current) => ({ ...current, hosts: result.total }));
        setHasMore((current) => ({ ...current, hosts: result.has_more && result.items.length > 0 }));
      }
    } catch (cause) {
      if (requestId === requestRef.current && !controller.signal.aborted && mountedRef.current) {
        setError(formatApiError(cause, 'Не удалось загрузить данные Scan Center.'));
      }
    } finally {
      if (requestId === requestRef.current && mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
        busyRef.current = false;
      }
    }
  }, [agentOnline, canRead, hostSeverity, hostStatus, incidentStatus, offlineMode, query, section]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
      busyRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  useFocusEffect(useCallback(() => {
    focusedRef.current = true;
    if (canRead && !offlineMode) {
      if (section === 'overview') void loadOverview();
      else void loadRows({ reset: true });
    } else {
      setLoading(false);
    }
    const timer = setInterval(() => {
      if (!focusedRef.current || !appActiveRef.current || busyRef.current || offlineMode) return;
      if (section === 'overview') void loadOverview({ silent: true });
      else void loadRows({ reset: true });
    }, AUTO_REFRESH_MS);
    return () => {
      focusedRef.current = false;
      clearInterval(timer);
      requestRef.current += 1;
      abortRef.current?.abort();
      busyRef.current = false;
      queueMicrotask(() => {
        if (mountedRef.current && !focusedRef.current) clearScanData();
      });
    };
  }, [canRead, clearScanData, loadOverview, loadRows, offlineMode, section]));

  useEffect(() => {
    if (!offlineMode) return;
    requestRef.current += 1;
    abortRef.current?.abort();
    busyRef.current = false;
    clearScanData();
    setLoading(false);
    setRefreshing(false);
    setLoadingMore(false);
  }, [clearScanData, offlineMode]);

  useEffect(() => {
    appActiveRef.current = AppState.currentState === 'active';
    const subscription = AppState.addEventListener('change', (nextState) => {
      const wasActive = appActiveRef.current;
      appActiveRef.current = nextState === 'active';
      if (!appActiveRef.current) {
        requestRef.current += 1;
        abortRef.current?.abort();
        busyRef.current = false;
        if (mountedRef.current) clearScanData();
        return;
      }
      if (wasActive || !focusedRef.current || busyRef.current || offlineMode) return;
      if (section === 'overview') void loadOverview({ silent: true });
      else void loadRows({ reset: true });
    });
    return () => subscription.remove();
  }, [clearScanData, loadOverview, loadRows, offlineMode, section]);

  const switchSection = useCallback((next: ScanCenterSection) => {
    requestRef.current += 1;
    abortRef.current?.abort();
    busyRef.current = false;
    setSection(next);
    setQueryDraft('');
    setQuery('');
    setError('');
  }, []);

  const rows = useMemo<ScanRow[]>(() => {
    if (section === 'incidents') return incidents.map((item) => ({ kind: 'incident', item }));
    if (section === 'review') return reviewItems.map((item) => ({ kind: 'review', item }));
    if (section === 'agents') return agents.map((item) => ({ kind: 'agent', item }));
    if (section === 'hosts') return hosts.map((item) => ({ kind: 'host', item }));
    return [];
  }, [agents, hosts, incidents, reviewItems, section]);
  const currentTotal = section === 'overview' ? 0 : totals[section];
  const hasListFilter = Boolean(query || (section === 'incidents' && incidentStatus)
    || (section === 'agents' && agentOnline) || (section === 'hosts' && (hostStatus || hostSeverity)));
  const resetListFilters = () => {
    setQueryDraft('');
    setQuery('');
    if (section === 'incidents') setIncidentStatus('');
    if (section === 'agents') setAgentOnline('');
    if (section === 'hosts') { setHostStatus(''); setHostSeverity(''); }
  };
  const attention = useMemo(() => buildScanAttentionItems(dashboard), [dashboard]);
  const dashboardTotals = dashboard?.totals || {};
  const performance = dashboard?.performance;

  const refreshCurrent = useCallback(() => {
    if (section === 'overview') void loadOverview({ refresh: true });
    else void loadRows({ reset: true, refresh: true });
  }, [loadOverview, loadRows, section]);

  if (!canRead) {
    return (
      <AccountScreenScaffold title="Scan Center" tokens={tokens}>
        <AccountSectionCard tokens={tokens} title="Нет доступа" description="Для раздела нужно право scan.read.">{null}</AccountSectionCard>
      </AccountScreenScaffold>
    );
  }

  const sectionTabs = (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs} accessibilityRole="tablist">
      {SCAN_CENTER_SECTIONS.map((item) => {
        const selected = section === item.id;
        const count = item.id === 'incidents'
          ? Number(dashboardTotals.incidents_new || totals.incidents)
          : item.id === 'review'
            ? Number(dashboardTotals.analysis_incomplete || dashboardTotals.server_pdf_incomplete || totals.review)
            : item.id === 'agents'
              ? Number(dashboardTotals.agents_total || totals.agents)
              : item.id === 'hosts'
                ? Number(dashboardTotals.hosts_total || totals.hosts)
                : 0;
        return (
          <Pressable
            key={item.id}
            testID={`native-scan-tab-${item.id}`}
            onPress={() => switchSection(item.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            style={[styles.tab, { backgroundColor: selected ? tokens.primary : tokens.panelSolid, borderColor: selected ? tokens.primary : tokens.border }]}
          >
            <MaterialCommunityIcons name={item.icon} size={18} color={selected ? '#fff' : tokens.iconMuted} />
            <Text style={[styles.tabText, { color: selected ? '#fff' : tokens.textPrimary }]}>{item.label}</Text>
            {count > 0 ? <Text style={[styles.tabCount, { color: selected ? '#fff' : tokens.primary }]}>{formatScanCount(count)}</Text> : null}
          </Pressable>
        );
      })}
    </ScrollView>
  );

  const stateMessages = (
    <>
      {offlineMode ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.warning }]}>Автономный режим: Scan Center доступен только с сетью. Данные очищены до восстановления подключения.</Text> : null}
      {dashboard?.degraded || dashboard?.cached ? (
        <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.warning }]}>Показана сохранённая сводка{dashboard.cache_age_sec > 0 ? `, возраст ${Math.round(dashboard.cache_age_sec)} с` : ''}. Часть актуальных данных может быть недоступна.</Text>
      ) : null}
      {error ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.error }]}>{error}</Text> : null}
    </>
  );

  return (
    <AccountScreenScaffold
      title="Scan Center"
      tokens={tokens}
      scroll={false}
    >
      {sectionTabs}
      {stateMessages}
      {section === 'overview' ? (
        <ScrollView
          testID="native-scan-overview"
          contentContainerStyle={styles.overview}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refreshCurrent} tintColor={tokens.primary} />}
        >
          {loading && !dashboard ? <View style={styles.loading}><ActivityIndicator color={tokens.primary} /><Text style={[styles.emptyText, { color: tokens.textSecondary }]}>Загружаем состояние контура…</Text></View> : null}
          {!loading && !dashboard ? (
            <View style={[styles.metricsCard, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
              <Text style={[styles.metricsTitle, { color: tokens.textPrimary }]}>Сводка недоступна</Text>
              <Text style={[styles.emptyText, { color: tokens.textSecondary }]}>Проверьте отдельный runtime Scan Center и повторите запрос.</Text>
              <Pressable onPress={() => { void loadOverview(); }} accessibilityRole="button" style={[styles.retryButton, { backgroundColor: tokens.primary }]}>
                <Text style={styles.retryText}>Повторить</Text>
              </Pressable>
            </View>
          ) : null}
          {dashboard ? attention.map((item) => (
            <Pressable
              key={item.id}
              testID={`native-scan-attention-${item.id}`}
              onPress={() => switchSection(item.section)}
              accessibilityRole="button"
              accessibilityLabel={`${item.label}: ${item.value}`}
              style={[styles.attentionCard, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}
            >
              <View style={[styles.attentionIcon, { backgroundColor: tokens.panelInset }]}>
                <MaterialCommunityIcons name={item.id === 'incidents' ? 'shield-alert-outline' : item.id === 'review' ? 'file-alert-outline' : 'access-point'} size={24} color={item.value > 0 ? tokens.warning : tokens.success} />
              </View>
              <View style={styles.flex}>
                <Text style={[styles.attentionTitle, { color: tokens.textPrimary }]}>{item.label}</Text>
                <Text style={[styles.attentionDescription, { color: tokens.textSecondary }]}>{item.description}</Text>
              </View>
              <Text style={[styles.attentionValue, { color: item.value > 0 ? tokens.warning : tokens.success }]}>{formatScanCount(item.value)}</Text>
              <MaterialCommunityIcons name="chevron-right" size={22} color={tokens.iconMuted} />
            </Pressable>
          )) : null}
          {dashboard ? <View style={[styles.metricsCard, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
            <Text style={[styles.metricsTitle, { color: tokens.textPrimary }]}>Состояние контура</Text>
            <View style={styles.metricGrid}>
              <View style={[styles.metric, { backgroundColor: tokens.panelInset }]}><Text style={[styles.metricLabel, { color: tokens.textSecondary }]}>OCR-очередь</Text><Text style={[styles.metricValue, { color: tokens.textPrimary }]}>{formatScanCount(dashboardTotals.server_pdf_pending)}</Text></View>
              <View style={[styles.metric, { backgroundColor: tokens.panelInset }]}><Text style={[styles.metricLabel, { color: tokens.textSecondary }]}>На связи</Text><Text style={[styles.metricValue, { color: tokens.textPrimary }]}>{formatScanCount(dashboardTotals.agents_online)}/{formatScanCount(dashboardTotals.agents_total)}</Text></View>
              <View style={[styles.metric, { backgroundColor: tokens.panelInset }]}><Text style={[styles.metricLabel, { color: tokens.textSecondary }]}>За 24 часа</Text><Text style={[styles.metricValue, { color: tokens.textPrimary }]}>{formatScanCount(performance?.completed)}</Text></View>
              <View style={[styles.metric, { backgroundColor: tokens.panelInset }]}><Text style={[styles.metricLabel, { color: tokens.textSecondary }]}>Файлов/ч</Text><Text style={[styles.metricValue, { color: tokens.textPrimary }]}>{formatScanCount(performance?.throughput_per_hour)}</Text></View>
            </View>
          </View> : null}
          {overviewReview.length ? (
            <View style={styles.previewSection}>
              <Text style={[styles.metricsTitle, { color: tokens.textPrimary }]}>Последние неполные проверки</Text>
              {overviewReview.map((item) => <NativeScanReviewCard key={item.id} item={item} tokens={tokens} />)}
            </View>
          ) : null}
          <View style={[styles.policy, { backgroundColor: tokens.accentSoft, borderColor: tokens.selectedBorder }]}>
            <MaterialCommunityIcons name="information-outline" size={20} color={tokens.primary} />
            <Text style={[styles.policyText, { color: tokens.textSecondary }]}>OCR проверяет первые 3 страницы PDF, текстовый слой — до 10 страниц. Неполный анализ никогда не считается чистым.</Text>
          </View>
        </ScrollView>
      ) : (
        <FlatList
          testID={`native-scan-list-${section}`}
          data={rows}
          keyExtractor={scanRowKey}
          contentContainerStyle={rows.length ? styles.list : styles.emptyList}
          refreshing={refreshing}
          onRefresh={refreshCurrent}
          onEndReached={() => {
            if (!loading && !loadingMore && hasMore[section]) void loadRows();
          }}
          onEndReachedThreshold={0.35}
          ListHeaderComponent={(
            <View style={styles.listHeader}>
              {section !== 'review' ? (
                <View style={[styles.search, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
                  <MaterialCommunityIcons name="magnify" size={20} color={tokens.iconMuted} />
                  <TextInput
                    testID="native-scan-search"
                    value={queryDraft}
                    onChangeText={(value) => setQueryDraft(value.slice(0, 200))}
                    onSubmitEditing={() => setQuery(queryDraft.trim())}
                    placeholder={section === 'agents' ? 'Компьютер, агент, IP' : section === 'hosts' ? 'Компьютер, филиал, сотрудник' : 'Файл, компьютер, сотрудник'}
                    placeholderTextColor={tokens.textTertiary}
                    returnKeyType="search"
                    accessibilityLabel="Поиск в Scan Center"
                    style={[styles.searchInput, { color: tokens.textPrimary }]}
                  />
                  {queryDraft ? <Pressable onPress={() => { setQueryDraft(''); setQuery(''); }} accessibilityRole="button" accessibilityLabel="Очистить поиск" style={styles.searchAction}><MaterialCommunityIcons name="close" size={19} color={tokens.iconMuted} /></Pressable> : null}
                  <Pressable testID="native-scan-search-submit" onPress={() => setQuery(queryDraft.trim())} accessibilityRole="button" accessibilityLabel="Найти" style={[styles.searchAction, { backgroundColor: tokens.primary }]}><MaterialCommunityIcons name="arrow-right" size={19} color="#fff" /></Pressable>
                </View>
              ) : null}
              {section === 'incidents' ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
                  <FilterChip label="Новые" selected={incidentStatus === 'new'} onPress={() => setIncidentStatus('new')} tokens={tokens} />
                  <FilterChip label="Просмотренные" selected={incidentStatus === 'ack'} onPress={() => setIncidentStatus('ack')} tokens={tokens} />
                  <FilterChip label="Все" selected={!incidentStatus} onPress={() => setIncidentStatus('')} tokens={tokens} />
                </ScrollView>
              ) : null}
              {section === 'agents' ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
                  <FilterChip label="Все" selected={!agentOnline} onPress={() => setAgentOnline('')} tokens={tokens} />
                  <FilterChip label="На связи" selected={agentOnline === 'online'} onPress={() => setAgentOnline('online')} tokens={tokens} />
                  <FilterChip label="Офлайн" selected={agentOnline === 'offline'} onPress={() => setAgentOnline('offline')} tokens={tokens} />
                </ScrollView>
              ) : null}
              {section === 'hosts' ? (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
                  <FilterChip label="Все" selected={!hostStatus && !hostSeverity} onPress={() => { setHostStatus(''); setHostSeverity(''); }} tokens={tokens} />
                  <FilterChip label="Есть новые" selected={hostStatus === 'new'} onPress={() => setHostStatus(hostStatus === 'new' ? '' : 'new')} tokens={tokens} />
                  <FilterChip label="Высокая важность" selected={hostSeverity === 'high'} onPress={() => setHostSeverity(hostSeverity === 'high' ? '' : 'high')} tokens={tokens} />
                </ScrollView>
              ) : null}
              <View style={styles.listMeta}>
                <Text style={[styles.metaText, { color: tokens.textSecondary }]}>Найдено: {formatScanCount(currentTotal)}</Text>
                {(section === 'incidents' && canAck) || (section === 'agents' && canRunTasks) ? <Text style={[styles.metaText, { color: tokens.textSecondary }]}>Действия для этого раздела пока недоступны на мобильном устройстве</Text> : null}
              </View>
            </View>
          )}
          renderItem={({ item: row }) => {
            if (row.kind === 'incident') return <NativeScanIncidentCard item={row.item} tokens={tokens} />;
            if (row.kind === 'review') return <NativeScanReviewCard item={row.item} tokens={tokens} />;
            if (row.kind === 'agent') return <NativeScanAgentCard item={row.item} tokens={tokens} />;
            return <NativeScanHostCard item={row.item} tokens={tokens} />;
          }}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          ListEmptyComponent={loading ? (
            <View style={styles.loading}><ActivityIndicator color={tokens.primary} /><Text style={[styles.emptyText, { color: tokens.textSecondary }]}>Загружаем данные…</Text></View>
          ) : error ? (
            <View style={styles.loading}>
              <MaterialCommunityIcons name="cloud-alert-outline" size={40} color={tokens.error} />
              <Text style={[styles.emptyTitle, { color: tokens.textPrimary }]}>Список не загрузился</Text>
              <Text style={[styles.emptyText, { color: tokens.textSecondary }]}>Проверьте соединение со Scan Center и повторите запрос.</Text>
              <Pressable testID="native-scan-list-retry" onPress={refreshCurrent} accessibilityRole="button" style={[styles.retryButton, { backgroundColor: tokens.primary }]}>
                <Text style={styles.retryText}>Повторить</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.loading}>
              <MaterialCommunityIcons name="magnify" size={40} color={tokens.iconMuted} />
              <Text style={[styles.emptyTitle, { color: tokens.textPrimary }]}>{hasListFilter ? 'Нет совпадений' : 'В этом списке пока нет данных'}</Text>
              <Text style={[styles.emptyText, { color: tokens.textSecondary }]}>{hasListFilter
                ? 'По текущему запросу и фильтрам записей нет. Это не результат проверки всех компьютеров.'
                : 'Список заполнится после получения данных от Scan Center. Пустой список не подтверждает отсутствие угроз.'}</Text>
              <Pressable onPress={hasListFilter ? resetListFilters : refreshCurrent} accessibilityRole="button"
                accessibilityLabel={hasListFilter ? 'Сбросить поиск и фильтры' : 'Обновить список'} style={[styles.retryButton, { backgroundColor: tokens.primary }]}>
                <Text style={styles.retryText}>{hasListFilter ? 'Сбросить фильтры' : 'Обновить'}</Text>
              </Pressable>
            </View>
          )}
          ListFooterComponent={loadingMore ? <ActivityIndicator style={styles.footerLoader} color={tokens.primary} /> : null}
        />
      )}
    </AccountScreenScaffold>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  headerAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  tabs: { paddingHorizontal: 12, paddingVertical: 10, gap: 8 },
  tab: { minHeight: 44, borderWidth: 1, borderRadius: 22, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 6 },
  tabText: { fontSize: 13, lineHeight: 18, fontWeight: '800' },
  tabCount: { fontSize: 11, lineHeight: 15, fontWeight: '900' },
  notice: { paddingHorizontal: 16, paddingBottom: 8, fontSize: 12, lineHeight: 17 },
  overview: { paddingHorizontal: 12, paddingBottom: 24, gap: 10 },
  attentionCard: { minHeight: 72, borderWidth: 1, borderRadius: 16, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  attentionIcon: { width: 44, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  attentionTitle: { fontSize: 14, lineHeight: 19, fontWeight: '800' },
  attentionDescription: { fontSize: 12, lineHeight: 17 },
  attentionValue: { fontSize: 20, lineHeight: 26, fontWeight: '900' },
  metricsCard: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 10 },
  metricsTitle: { fontSize: 16, lineHeight: 21, fontWeight: '800' },
  metricGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metric: { width: '48%', minHeight: 76, borderRadius: 12, padding: 11, justifyContent: 'space-between' },
  metricLabel: { fontSize: 12, lineHeight: 16 },
  metricValue: { fontSize: 21, lineHeight: 27, fontWeight: '900' },
  previewSection: { gap: 8 },
  policy: { borderWidth: 1, borderRadius: 14, padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  policyText: { flex: 1, fontSize: 12, lineHeight: 18 },
  list: { paddingHorizontal: 12, paddingBottom: 24 },
  emptyList: { flexGrow: 1, paddingHorizontal: 12, paddingBottom: 24 },
  listHeader: { gap: 8, paddingBottom: 10 },
  search: { minHeight: 48, borderWidth: 1, borderRadius: 14, paddingLeft: 12, paddingRight: 5, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, minWidth: 0, minHeight: 44, fontSize: 15 },
  searchAction: { width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  filters: { gap: 8 },
  filterChip: { minHeight: 44, borderWidth: 1, borderRadius: 22, paddingHorizontal: 14, alignItems: 'center', justifyContent: 'center' },
  filterChipText: { fontSize: 13, lineHeight: 18, fontWeight: '800' },
  listMeta: { minHeight: 28, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  metaText: { flexShrink: 1, fontSize: 11, lineHeight: 16 },
  separator: { height: 8 },
  loading: { minHeight: 180, alignItems: 'center', justifyContent: 'center', gap: 9, padding: 20 },
  emptyTitle: { fontSize: 16, lineHeight: 21, fontWeight: '800', textAlign: 'center' },
  emptyText: { fontSize: 13, lineHeight: 18, textAlign: 'center' },
  footerLoader: { marginVertical: 18 },
  retryButton: { alignSelf: 'flex-start', minHeight: 44, borderRadius: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  retryText: { color: '#fff', fontSize: 14, lineHeight: 19, fontWeight: '800' },
});
