import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { memo, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type {
  ScanAgent,
  ScanHost,
  ScanIncident,
  ScanReviewItem,
} from '../../api/scanCenterApi';
import {
  formatScanCount,
  formatScanDate,
  scanIncidentStatusLabel,
  scanReasonLabel,
  scanSeverityLabel,
} from '../../scanCenter/nativeScanCenterModel';
import type { FluentTokens } from '../../theme/fluentTokens';

function toneForSeverity(value: string, tokens: FluentTokens): string {
  const normalized = String(value || '').toLowerCase();
  if (normalized === 'high') return tokens.error;
  if (normalized === 'medium') return tokens.warning;
  if (normalized === 'low') return tokens.primary;
  return tokens.textSecondary;
}

function Badge({ label, color, tokens }: { label: string; color: string; tokens: FluentTokens }) {
  return (
    <View style={[styles.badge, { borderColor: color, backgroundColor: tokens.panelInset }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

function Meta({ children, tokens }: { children: ReactNode; tokens: FluentTokens }) {
  return <Text style={[styles.meta, { color: tokens.textSecondary }]}>{children}</Text>;
}

export const NativeScanIncidentCard = memo(function NativeScanIncidentCard({
  item,
  tokens,
}: {
  item: ScanIncident;
  tokens: FluentTokens;
}) {
  const severityColor = toneForSeverity(item.severity, tokens);
  const title = item.file_name || 'Файл без имени';
  const host = item.hostname || 'Неизвестный компьютер';
  const isNew = String(item.status || '').toLowerCase() === 'new';
  return (
    <View accessible accessibilityLabel={`${title}. ${scanSeverityLabel(item.severity)} важность. ${scanIncidentStatusLabel(item.status)}.`} style={[styles.card, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
      <View style={styles.rowBetween}>
        <Badge label={scanSeverityLabel(item.severity)} color={severityColor} tokens={tokens} />
        <Text style={[styles.date, { color: tokens.textTertiary }]}>{formatScanDate(item.created_at)}</Text>
      </View>
      <Text numberOfLines={2} style={[styles.title, { color: tokens.textPrimary }]}>{title}</Text>
      <Meta tokens={tokens}>{host}{item.branch ? ` · ${item.branch}` : ''}</Meta>
      {item.short_reason ? <Text style={[styles.description, { color: tokens.textSecondary }]}>{item.short_reason}</Text> : null}
      <View style={styles.footer}>
        <MaterialCommunityIcons name={isNew ? 'alert-circle-outline' : 'check-circle-outline'} size={18} color={isNew ? tokens.warning : tokens.success} />
        <Text style={[styles.footerText, { color: isNew ? tokens.warning : tokens.success }]}>{scanIncidentStatusLabel(item.status)}</Text>
        {item.user ? <Text numberOfLines={1} style={[styles.footerTail, { color: tokens.textTertiary }]}>{item.user}</Text> : null}
      </View>
    </View>
  );
});

export const NativeScanReviewCard = memo(function NativeScanReviewCard({
  item,
  tokens,
}: {
  item: ScanReviewItem;
  tokens: FluentTokens;
}) {
  const title = item.file_name || 'Файл без имени';
  return (
    <View accessible accessibilityLabel={`${title}. ${scanReasonLabel(item.reason)}.`} style={[styles.card, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
      <View style={styles.iconTitle}>
        <View style={[styles.iconBox, { backgroundColor: tokens.panelInset }]}>
          <MaterialCommunityIcons name="file-alert-outline" size={22} color={tokens.warning} />
        </View>
        <View style={styles.flex}>
          <Text numberOfLines={2} style={[styles.title, { color: tokens.textPrimary }]}>{title}</Text>
          <Meta tokens={tokens}>{item.hostname || item.agent_id || 'Неизвестный компьютер'}{item.branch ? ` · ${item.branch}` : ''}</Meta>
        </View>
      </View>
      <Text style={[styles.description, { color: tokens.warning }]}>{scanReasonLabel(item.reason)}</Text>
      <Text style={[styles.date, { color: tokens.textTertiary }]}>{formatScanDate(item.created_at)}</Text>
    </View>
  );
});

export const NativeScanAgentCard = memo(function NativeScanAgentCard({
  item,
  tokens,
}: {
  item: ScanAgent;
  tokens: FluentTokens;
}) {
  const activeStatus = String(item.active_task?.status || '').trim();
  const activeCommand = String(item.active_task?.command || '').trim();
  return (
    <View accessible accessibilityLabel={`${item.hostname}. ${item.is_online ? 'На связи' : 'Не в сети'}.`} style={[styles.card, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
      <View style={styles.iconTitle}>
        <View style={[styles.onlineDot, { backgroundColor: item.is_online ? tokens.success : tokens.textTertiary }]} />
        <View style={styles.flex}>
          <Text numberOfLines={1} style={[styles.title, { color: tokens.textPrimary }]}>{item.hostname || item.agent_id}</Text>
          <Meta tokens={tokens}>{item.branch || 'Филиал не указан'}{item.ip_address ? ` · ${item.ip_address}` : ''}</Meta>
        </View>
        <Badge label={item.is_online ? 'На связи' : 'Офлайн'} color={item.is_online ? tokens.success : tokens.textSecondary} tokens={tokens} />
      </View>
      <View style={styles.footer}>
        <Text style={[styles.footerText, { color: tokens.textSecondary }]}>Версия {item.version || '—'}</Text>
        <Text style={[styles.footerTail, { color: tokens.textTertiary }]}>Последняя связь: {formatScanDate(item.last_seen_at)}</Text>
      </View>
      {activeStatus ? (
        <View style={[styles.taskBox, { backgroundColor: tokens.panelInset }]}>
          <MaterialCommunityIcons name="progress-clock" size={18} color={tokens.primary} />
          <Text style={[styles.taskText, { color: tokens.textSecondary }]}>{activeCommand || 'Задание'} · {activeStatus}</Text>
        </View>
      ) : null}
    </View>
  );
});

export const NativeScanHostCard = memo(function NativeScanHostCard({
  item,
  tokens,
}: {
  item: ScanHost;
  tokens: FluentTokens;
}) {
  const severityColor = toneForSeverity(item.top_severity, tokens);
  return (
    <View accessible accessibilityLabel={`${item.hostname}. Новых инцидентов ${item.incidents_new}. Всего ${item.incidents_total}.`} style={[styles.card, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
      <View style={styles.iconTitle}>
        <View style={[styles.iconBox, { backgroundColor: tokens.panelInset }]}>
          <MaterialCommunityIcons name="laptop" size={22} color={severityColor} />
        </View>
        <View style={styles.flex}>
          <Text numberOfLines={1} style={[styles.title, { color: tokens.textPrimary }]}>{item.hostname}</Text>
          <Meta tokens={tokens}>{item.branch || 'Филиал не указан'}{item.ip_address ? ` · ${item.ip_address}` : ''}</Meta>
        </View>
        <Badge label={`${formatScanCount(item.incidents_new)} новых`} color={item.incidents_new > 0 ? tokens.warning : tokens.success} tokens={tokens} />
      </View>
      <View style={styles.footer}>
        <Text style={[styles.footerText, { color: tokens.textSecondary }]}>Всего: {formatScanCount(item.incidents_total)}</Text>
        <Text style={[styles.footerTail, { color: tokens.textTertiary }]}>Последняя находка: {formatScanDate(item.last_incident_at)}</Text>
      </View>
      {item.top_exts.length ? <Meta tokens={tokens}>Форматы: {item.top_exts.slice(0, 5).join(', ')}</Meta> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 14, gap: 8 },
  rowBetween: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  iconTitle: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  iconBox: { width: 42, height: 42, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  flex: { flex: 1, minWidth: 0 },
  title: { fontSize: 15, lineHeight: 20, fontWeight: '800' },
  meta: { fontSize: 12, lineHeight: 17 },
  description: { fontSize: 13, lineHeight: 18 },
  date: { fontSize: 11, lineHeight: 16 },
  badge: { minHeight: 28, borderWidth: 1, borderRadius: 14, paddingHorizontal: 9, alignItems: 'center', justifyContent: 'center' },
  badgeText: { fontSize: 11, lineHeight: 15, fontWeight: '800' },
  footer: { minHeight: 24, flexDirection: 'row', alignItems: 'center', gap: 5 },
  footerText: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  footerTail: { flex: 1, minWidth: 0, fontSize: 11, lineHeight: 16, textAlign: 'right' },
  onlineDot: { width: 12, height: 12, borderRadius: 6 },
  taskBox: { minHeight: 36, borderRadius: 10, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 7 },
  taskText: { flex: 1, fontSize: 12, lineHeight: 17 },
});
