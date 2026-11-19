import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  fetchMonitoringOverview,
  getMonitoringEvents,
  type MonitoringEvent,
  type MonitoringOverview,
} from '../../api/monitoringApi';
import { formatApiError } from '../../api/formatError';
import { useAuth } from '../../auth/AuthContext';
import { NativeFilterChip, NativeSegmentedControl } from '../../components/ui/NativeFilterControls';
import {
  MONITORING_FILTER_OPTIONS,
  MONITORING_REFRESH_MS,
  countMonitoringIssues,
  displayTargetName,
  eventTone,
  filterMonitoringTargets,
  formatBps,
  formatDuration,
  formatTime,
  isStale,
  outageNotice,
  targetStatus,
  type MonitoringFilter,
} from '../../monitoring/monitoringModel';
import { useMonitoringActive } from '../../monitoring/useMonitoringActive';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens } from '../../theme/fluentTokens';
import { AccountScreenScaffold, AccountSectionCard } from '../account/AccountChrome';
import { NativeMonitoringDetail, toneColor } from './NativeMonitoringDetail';

type MonitoringSection = 'targets' | 'events';
const MONITORING_SECTION_OPTIONS = [
  { value: 'targets', label: 'Устройства' },
  { value: 'events', label: 'События' },
];

export function NativeMonitoringScreen() {
  const { user } = useAuth();
  return <MonitoringContent key={user?.id} />;
}

function MonitoringContent() {
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const { hasPermission, offlineMode } = useAuth();
  const canView = hasPermission('monitoring.read');

  const [data, setData] = useState<MonitoringOverview | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<MonitoringFilter>('all');
  const [selectedId, setSelectedId] = useState('');
  const [section, setSection] = useState<MonitoringSection>('targets');
  const [events, setEvents] = useState<MonitoringEvent[] | null>(null);
  const [eventsError, setEventsError] = useState('');
  const generation = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const inFlight = useRef(false);
  const loadRef = useRef<(silent: boolean, poll?: boolean) => Promise<void>>(async () => {});

  const load = useCallback(async (silent: boolean, poll = false) => {
    if (!canView || offlineMode) return;
    // A tick must not cancel a slow request: with a 16-29 s response every poll would abort
    // the previous one and the data would never arrive. Manual/initial loads still supersede.
    if (poll && inFlight.current) return;
    inFlight.current = true;
    const current = ++generation.current;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    if (!silent) setLoading(true);
    const withEvents = section === 'events';
    try {
      const [overview, feed] = await Promise.allSettled([
        fetchMonitoringOverview({ signal: controller.signal }),
        withEvents ? getMonitoringEvents({ signal: controller.signal }) : Promise.resolve(null),
      ]);
      if (controller.signal.aborted || current !== generation.current) return;
      if (overview.status === 'fulfilled') {
        const result = overview.value;
        setData(result);
        setError('');
        setSelectedId((id) => (id && !result.targets.some((row) => row.id === id) ? '' : id));
      } else {
        setError(formatApiError(overview.reason, 'Не удалось загрузить мониторинг'));
      }
      if (withEvents) {
        if (feed.status === 'fulfilled' && feed.value) {
          setEvents(feed.value);
          setEventsError('');
        } else if (feed.status === 'rejected') {
          setEventsError(formatApiError(feed.reason, 'Не удалось загрузить события'));
        }
      }
    } finally {
      if (current === generation.current) { inFlight.current = false; setLoading(false); setRefreshing(false); }
    }
  }, [canView, offlineMode, section]);
  useEffect(() => { loadRef.current = load; }, [load]);

  // The events feed loads lazily on first entry, then rides the same refresh/poll cycle.
  useEffect(() => {
    if (section === 'events') void loadRef.current(true);
  }, [section]);

  const active = useMonitoringActive();
  useEffect(() => {
    if (!canView || offlineMode) { setLoading(false); return undefined; }
    if (!active) return undefined;
    void loadRef.current(false);
    const timer = setInterval(() => { void loadRef.current(true, true); }, MONITORING_REFRESH_MS);
    return () => { clearInterval(timer); generation.current += 1; inFlight.current = false; abort.current?.abort(); };
  }, [active, canView, offlineMode]);

  useEffect(() => {
    if (!selectedId) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => { setSelectedId(''); return true; });
    return () => subscription.remove();
  }, [selectedId]);

  const targets = useMemo(() => data?.targets ?? [], [data]);
  const names = useMemo(() => {
    const map: Record<string, string> = {};
    for (const target of targets) map[target.id] = displayTargetName(target);
    return map;
  }, [targets]);
  const visible = useMemo(() => filterMonitoringTargets(targets, query, filter), [targets, query, filter]);
  const issues = useMemo(() => countMonitoringIssues(targets), [targets]);
  const selected = targets.find((row) => row.id === selectedId) ?? null;
  const worker = data?.worker;

  const refresh = useCallback(() => {
    setRefreshing(true);
    void loadRef.current(true);
  }, []);

  const body = (() => {
    if (!canView) {
      return <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.textSecondary }]}>Нет доступа к разделу «Мониторинг».</Text>;
    }
    if (offlineMode) {
      return <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.warning }]}>Автономный режим: мониторинг показывает только живые данные, подключитесь к сети.</Text>;
    }
    if (loading && !data) return <ActivityIndicator testID="native-monitoring-loading" color={tokens.primary} style={styles.loader} />;
    if (selected) return <NativeMonitoringDetail target={selected} tokens={tokens} canManage={hasPermission('monitoring.manage')} offline={offlineMode} />;
    return (
      <View style={styles.stack}>
        {error ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.error }]}>{error}</Text> : null}
        {worker && !worker.enabled ? (
          <Text style={[styles.notice, { color: tokens.textSecondary }]}>Автоматический сбор не включён: новые данные не поступают.</Text>
        ) : null}
        {worker?.enabled && isStale(worker.heartbeat_at, 120) ? (
          <Text testID="native-monitoring-worker-stale" style={[styles.notice, { color: tokens.warning }]}>
            Сбор данных задерживается. Последний цикл: {formatTime(worker.heartbeat_at)}.
          </Text>
        ) : null}
        <NativeSegmentedControl
          options={MONITORING_SECTION_OPTIONS}
          selected={section}
          onSelect={(value) => setSection(value as MonitoringSection)}
          tokens={tokens}
          testIDPrefix="native-monitoring-section"
        />
        {section === 'events' ? (
          <AccountSectionCard tokens={tokens} title="История событий">
            {eventsError ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.error }]}>{eventsError}</Text> : null}
            {!events && !eventsError ? <ActivityIndicator testID="native-monitoring-events-loading" color={tokens.primary} style={styles.loader} /> : null}
            {events && !events.length ? (
              <Text style={[styles.notice, { color: tokens.textSecondary }]}>Событий пока нет. Здесь появятся изменения состояния и предупреждения.</Text>
            ) : null}
            {(events ?? []).map((event) => {
              const color = toneColor(tokens, eventTone(event));
              return (
                <View key={event.id} testID={`native-monitoring-feed-event-${event.id}`} style={[styles.eventRow, { borderColor: tokens.borderSoft }]}>
                  <MaterialCommunityIcons
                    name={event.closed_at ? 'check-circle-outline' : 'alert-outline'}
                    size={20}
                    color={color}
                  />
                  <View style={styles.cardMain}>
                    <Text numberOfLines={2} style={[styles.cardTitle, { color: tokens.textPrimary }]}>{event.title}</Text>
                    <Text style={[styles.cardMeta, { color: tokens.textSecondary }]}>
                      {names[event.target_id] || event.target_id}{event.interface_name ? ` · ${event.interface_name}` : ''}
                      {' · '}{formatTime(event.opened_at)}{event.closed_at ? ` → ${formatTime(event.closed_at)}` : ''}
                    </Text>
                  </View>
                  <Text testID={`native-monitoring-feed-status-${event.id}`} style={[styles.eventBadge, { color }]}>
                    {event.closed_at ? 'Завершено' : 'Открыто'} · {formatDuration(event.opened_at, event.closed_at || Date.now())}
                  </Text>
                </View>
              );
            })}
          </AccountSectionCard>
        ) : null}
        {section === 'targets' ? (
          <>
        <View style={[styles.search, { backgroundColor: tokens.panelSolid, borderColor: tokens.border }]}>
          <MaterialCommunityIcons name="magnify" size={20} color={tokens.iconMuted} />
          <TextInput
            testID="native-monitoring-search"
            value={query}
            onChangeText={setQuery}
            placeholder="Название или IP"
            placeholderTextColor={tokens.textTertiary}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.searchInput, { color: tokens.textPrimary }]}
          />
        </View>
        <View style={styles.chips}>
          {MONITORING_FILTER_OPTIONS.map((option) => (
            <NativeFilterChip
              key={option.value}
              label={option.label}
              selected={filter === option.value}
              count={option.value === 'issues' ? issues : undefined}
              tokens={tokens}
              onPress={() => setFilter(option.value)}
              testID={`native-monitoring-filter-${option.value}`}
            />
          ))}
        </View>
        {!targets.length ? (
          <Text style={[styles.notice, { color: tokens.textSecondary }]}>
            {data ? 'Устройств в мониторинге пока нет.' : 'Данные мониторинга недоступны.'}
          </Text>
        ) : null}
        {targets.length && !visible.length ? (
          <Text style={[styles.notice, { color: tokens.textSecondary }]}>По этому запросу устройств нет.</Text>
        ) : null}
        {visible.map((target) => {
          const status = targetStatus(target);
          const color = toneColor(tokens, status.tone);
          const summary = target.summary;
          const fresh = summary && !isStale(summary.checked_at);
          const notice = outageNotice(target);
          return (
            <Pressable
              key={target.id}
              testID={`native-monitoring-target-${target.id}`}
              accessibilityRole="button"
              accessibilityLabel={`Открыть ${displayTargetName(target)}. ${status.label}`}
              onPress={() => setSelectedId(target.id)}
              style={({ pressed }) => [
                styles.card,
                { backgroundColor: tokens.panelSolid, borderColor: status.tone === 'success' || status.tone === 'neutral' ? tokens.borderSoft : color },
                pressed && { backgroundColor: tokens.actionHover },
              ]}
            >
              <View style={styles.cardHead}>
                <View style={[styles.dot, { backgroundColor: color }]} />
                <View style={styles.cardMain}>
                  <Text numberOfLines={1} style={[styles.cardTitle, { color: tokens.textPrimary }]}>{displayTargetName(target)}</Text>
                  <Text numberOfLines={1} style={[styles.cardMeta, { color: tokens.textSecondary }]}>{target.address}</Text>
                </View>
                <Text style={[styles.cardStatus, { color }]}>{status.label}</Text>
              </View>
              {notice && status.tone !== 'success' ? (
                <Text numberOfLines={2} style={[styles.cardMeta, { color: status.tone === 'error' ? tokens.error : tokens.textSecondary }]}>{notice}</Text>
              ) : null}
              {summary ? (
                <Text style={[styles.cardMeta, { color: tokens.textSecondary }]}>
                  ↓ {formatBps(fresh ? summary.rx_bps : undefined)} · ↑ {formatBps(fresh ? summary.tx_bps : undefined)}
                  {summary.name ? ` · ${summary.name}` : ''}
                </Text>
              ) : null}
            </Pressable>
          );
        })}
        {data?.checked_at ? (
          <Text style={[styles.cardMeta, { color: tokens.textTertiary }]}>Сводка обновлена: {formatTime(data.checked_at)}</Text>
        ) : null}
          </>
        ) : null}
      </View>
    );
  })();

  return (
    <AccountScreenScaffold
      title={selected ? displayTargetName(selected) : 'Мониторинг'}
      tokens={tokens}
      onBack={selected ? () => setSelectedId('') : undefined}
      refreshing={refreshing}
      onRefresh={canView && !offlineMode ? refresh : undefined}
    >
      {body}
    </AccountScreenScaffold>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 10 },
  loader: { marginVertical: 24 },
  notice: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  search: { minHeight: 44, borderWidth: 1, borderRadius: 13, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  searchInput: { flex: 1, fontSize: 15, paddingVertical: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card: { borderWidth: 1, borderRadius: 14, padding: 12, gap: 6 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  cardMain: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: 15, fontWeight: '800' },
  cardMeta: { fontSize: 12, lineHeight: 17, fontWeight: '600' },
  cardStatus: { fontSize: 12, fontWeight: '800' },
  eventRow: { borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8 },
  eventBadge: { flexShrink: 1, maxWidth: '45%', fontSize: 12, lineHeight: 17, fontWeight: '800', textAlign: 'right' },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
