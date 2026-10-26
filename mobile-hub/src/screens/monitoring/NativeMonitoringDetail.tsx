import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {
  fetchMonitoringHistory,
  fetchMonitoringLatency,
  fetchMonitoringTarget,
  type MonitoringHistory,
  type MonitoringTarget,
  type MonitoringTargetDetail,
} from '../../api/monitoringApi';
import { formatApiError } from '../../api/formatError';
import { NativeFilterChip, NativeSegmentedControl } from '../../components/ui/NativeFilterControls';
import { NativeTabPicker } from '../../components/ui/NativeTabPicker';
import { NativeMonitoringChart } from '../../components/monitoring/NativeMonitoringChart';
import {
  MONITORING_PERIOD_OPTIONS,
  MONITORING_REFRESH_MS,
  bucketSeries,
  defaultInterfaceId,
  displayTargetName,
  eventTone,
  formatBps,
  formatDuration,
  formatNumber,
  formatTime,
  interfaceStatus,
  isNumber,
  isStale,
  outageNotice,
  targetStatus,
  type MonitoringTone,
} from '../../monitoring/monitoringModel';
import type { FluentTokens } from '../../theme/fluentTokens';
import { AccountSectionCard } from '../account/AccountChrome';

const HISTORY_REFRESH_MS = 60_000;

type DetailTab = 'graphs' | 'interfaces' | 'events';
const DETAIL_TABS = [
  { value: 'graphs', label: 'Графики' },
  { value: 'interfaces', label: 'Интерфейсы' },
  { value: 'events', label: 'События' },
];

export function toneColor(tokens: FluentTokens, tone: MonitoringTone): string {
  if (tone === 'success') return tokens.success;
  if (tone === 'warning') return tokens.warning;
  if (tone === 'error') return tokens.error;
  return tokens.textTertiary;
}

function Metric({ label, value, unit, tokens, dim }: {
  label: string;
  value: unknown;
  unit: string;
  tokens: FluentTokens;
  dim: boolean;
}) {
  return (
    <View style={styles.metric}>
      <Text style={[styles.metricLabel, { color: tokens.textSecondary }]}>{label}</Text>
      <Text style={[styles.metricValue, { color: dim ? tokens.textSecondary : tokens.textPrimary }]}>
        {formatNumber(value)}{isNumber(value) ? ` ${unit}` : ''}
      </Text>
    </View>
  );
}

export function NativeMonitoringDetail({ target, tokens }: { target: MonitoringTarget; tokens: FluentTokens }) {
  const targetId = target.id;
  const [detail, setDetail] = useState<MonitoringTargetDetail | null>(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState<DetailTab>('graphs');
  const [hours, setHours] = useState<number>(24);
  const [interfaceId, setInterfaceId] = useState('');
  const [portHistory, setPortHistory] = useState<MonitoringHistory | null>(null);
  const [deviceHistory, setDeviceHistory] = useState<MonitoringHistory | null>(null);
  const [latency, setLatency] = useState<MonitoringHistory | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [historyLoading, setHistoryLoading] = useState(false);
  const detailGeneration = useRef(0);
  const historyGeneration = useRef(0);

  useEffect(() => {
    setDetail(null); setError(''); setInterfaceId(''); setPortHistory(null); setDeviceHistory(null); setLatency(null);
  }, [targetId]);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      const generation = ++detailGeneration.current;
      try {
        const result = await fetchMonitoringTarget(targetId, { signal: controller.signal });
        if (controller.signal.aborted || generation !== detailGeneration.current) return;
        setDetail(result);
        setError('');
        setInterfaceId((current) => (result.interfaces.some((row) => row.id === current)
          ? current : defaultInterfaceId(result.interfaces)));
      } catch (cause) {
        if (controller.signal.aborted || generation !== detailGeneration.current) return;
        setError(formatApiError(cause, 'Не удалось загрузить устройство'));
      }
    };
    void load();
    const timer = setInterval(() => { void load(); }, MONITORING_REFRESH_MS);
    return () => { controller.abort(); clearInterval(timer); };
  }, [targetId]);

  const loadHistory = useCallback(async (signal: AbortSignal, silent: boolean) => {
    const generation = ++historyGeneration.current;
    if (!silent) setHistoryLoading(true);
    const settled = await Promise.allSettled([
      fetchMonitoringHistory(targetId, { hours, signal }),
      interfaceId ? fetchMonitoringHistory(targetId, { interfaceId, hours, signal }) : Promise.resolve(null),
      fetchMonitoringLatency(targetId, { hours, signal }),
    ]);
    if (signal.aborted || generation !== historyGeneration.current) return;
    const [device, port, ping] = settled;
    if (device.status === 'fulfilled') setDeviceHistory(device.value);
    if (port.status === 'fulfilled') setPortHistory(port.value);
    if (ping.status === 'fulfilled') setLatency(ping.value);
    const failed = settled.find((item) => item.status === 'rejected') as PromiseRejectedResult | undefined;
    setHistoryError(failed ? formatApiError(failed.reason, 'Не удалось загрузить графики') : '');
    setHistoryLoading(false);
  }, [targetId, hours, interfaceId]);

  useEffect(() => {
    if (tab !== 'graphs' || !detail) return undefined;
    const controller = new AbortController();
    void loadHistory(controller.signal, false);
    const timer = setInterval(() => { void loadHistory(controller.signal, true); }, HISTORY_REFRESH_MS);
    return () => { controller.abort(); clearInterval(timer); };
  }, [tab, loadHistory, Boolean(detail)]); // eslint-disable-line react-hooks/exhaustive-deps

  const merged = detail ?? target;
  const status = targetStatus(merged);
  const current = merged.current || {};
  const device = current.device || {};
  const stale = isStale(current.last_success_at);
  const notice = outageNotice(merged);
  const interfaces = detail?.interfaces ?? [];
  const selectedInterface = interfaces.find((row) => row.id === interfaceId);
  const devicePoints = deviceHistory?.points ?? [];
  const portPoints = portHistory?.points ?? [];
  const latencyPoints = latency?.points ?? [];
  const mbps = (value: number) => formatBps(value);
  const percent = (value: number) => `${formatNumber(value)} %`;
  const color = toneColor(tokens, status.tone);

  return (
    <View testID="native-monitoring-detail" style={styles.stack}>
      <AccountSectionCard tokens={tokens} title={displayTargetName(merged)} description={`${merged.address}${merged.port ? `:${merged.port}` : ''}${device.description ? ` · ${device.description}` : ''}`}>
        <View style={styles.statusRow}>
          <View style={[styles.dot, { backgroundColor: color }]} />
          <Text testID="native-monitoring-detail-status" style={[styles.statusText, { color }]}>{status.label}</Text>
        </View>
        {notice ? <Text style={[styles.note, { color: status.tone === 'error' ? tokens.error : tokens.textSecondary }]}>{notice}</Text> : null}
        <Text style={[styles.note, { color: tokens.textSecondary }]}>
          ICMP: {isStale(current.icmp_checked_at || current.checked_at, 20) ? 'данные устарели'
            : current.ping?.status === 'online' ? 'отвечает' : current.ping?.status === 'offline' ? 'нет ответа' : 'не проверен'}
          {' · '}SNMP: {current.snmp_status === 'ok' ? (stale ? 'данные устарели' : 'отвечает') : current.snmp_status === 'error' ? 'ошибка' : 'не проверен'}
        </Text>
        <Text style={[styles.note, { color: tokens.textTertiary }]}>Последний успех SNMP: {formatTime(current.last_success_at)}</Text>
        {current.snmp_error ? <Text style={[styles.note, { color: tokens.warning }]}>{current.snmp_error}. Показаны последние известные значения.</Text> : null}
        <View style={styles.metrics}>
          <Metric label="CPU" value={device.cpu_pct} unit="%" tokens={tokens} dim={stale} />
          <Metric label="Память" value={device.memory_pct} unit="%" tokens={tokens} dim={stale} />
          <Metric label="Температура" value={device.temperature_c} unit="°C" tokens={tokens} dim={stale} />
          <Metric label="Задержка HUB" value={current.ping?.latency_ms} unit="мс" tokens={tokens} dim={stale} />
        </View>
      </AccountSectionCard>

      {error ? <Text accessibilityRole="alert" style={[styles.note, { color: tokens.error }]}>{error}</Text> : null}

      <NativeSegmentedControl
        options={DETAIL_TABS}
        selected={tab}
        onSelect={(value) => setTab(value as DetailTab)}
        tokens={tokens}
        testIDPrefix="native-monitoring-tab"
      />

      {!detail && !error ? <ActivityIndicator color={tokens.primary} style={styles.loader} /> : null}

      {detail && tab === 'graphs' ? (
        <AccountSectionCard tokens={tokens} title="Графики">
          <View style={styles.chips}>
            {MONITORING_PERIOD_OPTIONS.map((option) => (
              <NativeFilterChip
                key={option.value}
                label={option.label}
                selected={hours === option.hours}
                tokens={tokens}
                onPress={() => setHours(option.hours)}
                testID={`native-monitoring-period-${option.value}`}
              />
            ))}
          </View>
          {interfaces.length ? (
            <NativeTabPicker
              options={interfaces.map((row) => ({ value: row.id, label: `${row.name}${row.settings?.pinned ? ' · закреплён' : ''}${row.settings?.critical ? ' · важный' : ''}` }))}
              selected={interfaceId}
              onSelect={setInterfaceId}
              tokens={tokens}
              testIDPrefix="native-monitoring-interface"
              title="Интерфейс"
              fallbackIcon="ethernet"
            />
          ) : null}
          {historyError ? <Text accessibilityRole="alert" style={[styles.note, { color: tokens.warning }]}>{historyError}</Text> : null}
          {historyLoading && !portHistory && !deviceHistory ? <ActivityIndicator color={tokens.primary} style={styles.loader} /> : null}
          <View style={styles.charts}>
            <NativeMonitoringChart testID="native-monitoring-chart-rx" title={`Приём${selectedInterface ? ` · ${selectedInterface.name}` : ''}`} values={bucketSeries(portPoints, 'rx_bps')} format={mbps} color={tokens.primary} tokens={tokens} />
            <NativeMonitoringChart testID="native-monitoring-chart-tx" title="Передача" values={bucketSeries(portPoints, 'tx_bps')} format={mbps} color={tokens.secondary} tokens={tokens} />
            <NativeMonitoringChart testID="native-monitoring-chart-cpu" title="CPU" values={bucketSeries(devicePoints, 'cpu_pct')} format={percent} color={tokens.warning} tokens={tokens} />
            <NativeMonitoringChart testID="native-monitoring-chart-memory" title="Память" values={bucketSeries(devicePoints, 'memory_pct')} format={percent} color={tokens.primaryDark} tokens={tokens} />
            <NativeMonitoringChart testID="native-monitoring-chart-latency" title="Задержка до устройства (ICMP с сервера HUB)" values={bucketSeries(latencyPoints, 'latency_ms')} format={(value) => `${formatNumber(value)} мс`} color={tokens.success} tokens={tokens} />
          </View>
          <Text style={[styles.note, { color: tokens.textTertiary }]}>Провалы данных показаны разрывами. История начинается с включения сбора HUB.</Text>
        </AccountSectionCard>
      ) : null}

      {detail && tab === 'interfaces' ? (
        <AccountSectionCard tokens={tokens} title="Интерфейсы" description="Физические и логические интерфейсы">
          {!interfaces.length ? <Text style={[styles.note, { color: tokens.textSecondary }]}>Интерфейсы появятся после успешного обнаружения SNMP.</Text> : null}
          {interfaces.map((item) => {
            const state = interfaceStatus(item);
            const value = item.current || {};
            return (
              <Pressable
                key={item.id}
                testID={`native-monitoring-interface-row-${item.id}`}
                accessibilityRole="button"
                accessibilityLabel={`Графики интерфейса ${item.name}. ${state.label}`}
                onPress={() => { setInterfaceId(item.id); setTab('graphs'); }}
                style={[styles.ifaceRow, { borderColor: tokens.borderSoft }]}
              >
                <View style={styles.ifaceMain}>
                  <Text numberOfLines={1} style={[styles.ifaceName, { color: tokens.textPrimary }]}>{item.name}</Text>
                  {value.alias ? <Text numberOfLines={1} style={[styles.note, { color: tokens.textTertiary }]}>{value.alias}</Text> : null}
                  <Text style={[styles.note, { color: tokens.textSecondary }]}>
                    ↓ {formatBps(value.rx_bps)} · ↑ {formatBps(value.tx_bps)}{value.oper === 1 ? ` · линк ${formatBps(value.speed_bps)}` : ''}
                  </Text>
                </View>
                <Text style={[styles.ifaceState, { color: toneColor(tokens, state.tone) }]}>{state.label}</Text>
                <MaterialCommunityIcons name="chevron-right" size={20} color={tokens.iconMuted} />
              </Pressable>
            );
          })}
        </AccountSectionCard>
      ) : null}

      {detail && tab === 'events' ? (
        <AccountSectionCard tokens={tokens} title="История событий">
          {!detail.events.length ? <Text style={[styles.note, { color: tokens.textSecondary }]}>Событий пока нет.</Text> : null}
          {detail.events.map((event) => (
            <View key={event.id} testID={`native-monitoring-event-${event.id}`} style={[styles.eventRow, { borderColor: tokens.borderSoft }]}>
              <MaterialCommunityIcons
                name={event.closed_at ? 'check-circle-outline' : 'alert-outline'}
                size={20}
                color={toneColor(tokens, eventTone(event))}
              />
              <View style={styles.ifaceMain}>
                <Text style={[styles.ifaceName, { color: tokens.textPrimary }]}>{event.title}</Text>
                <Text style={[styles.note, { color: tokens.textSecondary }]}>
                  {formatTime(event.opened_at)}{event.closed_at ? ` → ${formatTime(event.closed_at)}` : ''}
                  {' · '}{event.closed_at ? 'Завершено' : 'Открыто'} · {formatDuration(event.opened_at, event.closed_at || Date.now())}
                </Text>
              </View>
            </View>
          ))}
        </AccountSectionCard>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  statusText: { fontSize: 15, fontWeight: '800' },
  note: { fontSize: 12, lineHeight: 17, marginTop: 4 },
  metrics: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12 },
  metric: { minWidth: '45%', flexGrow: 1 },
  metricLabel: { fontSize: 12, fontWeight: '600' },
  metricValue: { fontSize: 18, fontWeight: '800' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  charts: { gap: 16, marginTop: 12 },
  loader: { marginVertical: 12 },
  ifaceRow: { minHeight: 56, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8 },
  ifaceMain: { flex: 1, minWidth: 0 },
  ifaceName: { fontSize: 14, fontWeight: '800' },
  ifaceState: { fontSize: 12, fontWeight: '800' },
  eventRow: { borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 8 },
});
