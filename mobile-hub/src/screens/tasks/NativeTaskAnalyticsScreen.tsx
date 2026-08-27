import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { formatApiError } from '../../api/formatError';
import {
  getTaskAnalytics,
  getTaskObjects,
  getTaskProjects,
  searchTaskAssignees,
  type TaskAnalyticsDateBasis,
  type TaskAnalyticsGroup,
  type TaskAnalyticsParams,
  type TaskAnalyticsPayload,
  type TaskAssignee,
  type TaskObject,
  type TaskProject,
} from '../../api/taskApi';
import { useAuth } from '../../auth/AuthContext';
import { shareNativeFile } from '../../files/nativeAttachmentDownloads';
import { usePreferences } from '../../preferences/PreferencesContext';
import { downloadNativeTaskAnalytics } from '../../tasks/nativeTaskFiles';
import { useFluentTokens, type FluentTokens } from '../../theme/fluentTokens';
import {
  AccountLoading,
  AccountPrimaryButton,
  AccountScreenScaffold,
  AccountSecondaryButton,
  AccountSectionCard,
} from '../account/AccountChrome';

type PeriodPreset = '7d' | '30d' | 'month' | 'quarter' | 'year' | 'custom';

type AnalyticsFilters = {
  preset: PeriodPreset;
  startDate: string;
  endDate: string;
  dateBasis: TaskAnalyticsDateBasis;
  projectIds: string[];
  objectIds: string[];
  participantUserIds: number[];
};

const PERIOD_OPTIONS: Array<{ value: PeriodPreset; label: string }> = [
  { value: '7d', label: '7 дней' },
  { value: '30d', label: '30 дней' },
  { value: 'month', label: 'Месяц' },
  { value: 'quarter', label: 'Квартал' },
  { value: 'year', label: 'Год' },
  { value: 'custom', label: 'Свои даты' },
];

const DATE_BASIS_OPTIONS: Array<{ value: TaskAnalyticsDateBasis; label: string }> = [
  { value: 'protocol_date', label: 'Постановка' },
  { value: 'completed_at', label: 'Завершение' },
  { value: 'due_at', label: 'Срок' },
];

function dateInput(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, '0');
  const day = String(value.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function taskAnalyticsRange(preset: PeriodPreset, now = new Date()): Pick<AnalyticsFilters, 'startDate' | 'endDate'> {
  if (preset === 'custom') return { startDate: '', endDate: '' };
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const start = new Date(end);
  if (preset === '7d') start.setDate(start.getDate() - 6);
  else if (preset === '30d') start.setDate(start.getDate() - 29);
  else if (preset === 'month') start.setDate(1);
  else if (preset === 'quarter') start.setMonth(Math.floor(start.getMonth() / 3) * 3, 1);
  else start.setMonth(0, 1);
  return { startDate: dateInput(start), endDate: dateInput(end) };
}

function validDateInput(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00`);
  return !Number.isNaN(parsed.getTime()) && dateInput(parsed) === value;
}

function initialFilters(): AnalyticsFilters {
  return {
    preset: '30d',
    ...taskAnalyticsRange('30d'),
    dateBasis: 'protocol_date',
    projectIds: [],
    objectIds: [],
    participantUserIds: [],
  };
}

function toApiParams(filters: AnalyticsFilters): TaskAnalyticsParams {
  return {
    start_date: filters.startDate,
    end_date: filters.endDate,
    date_basis: filters.dateBasis,
    project_ids: filters.projectIds,
    object_ids: filters.objectIds,
    participant_user_ids: filters.participantUserIds,
  };
}

function toggleValue<T extends string | number>(items: T[], value: T): T[] {
  return items.includes(value) ? items.filter((item) => item !== value) : [...items, value];
}

function Metric({ label, value, color, tokens }: {
  label: string;
  value: string | number;
  color?: string;
  tokens: FluentTokens;
}) {
  return (
    <View style={[styles.metric, { borderColor: tokens.borderSoft, backgroundColor: tokens.pageBg }]}> 
      <Text style={[styles.metricValue, { color: color || tokens.textPrimary }]}>{value}</Text>
      <Text style={[styles.metricLabel, { color: tokens.textSecondary }]}>{label}</Text>
    </View>
  );
}

function ChoiceChip<T extends string>({ value, label, selected, tokens, onPress }: {
  value: T;
  label: string;
  selected: boolean;
  tokens: FluentTokens;
  onPress: (value: T) => void;
}) {
  return (
    <Pressable
      onPress={() => onPress(value)}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? tokens.selected : tokens.pageBg,
          borderColor: selected ? tokens.selectedBorder : tokens.borderSoft,
        },
      ]}
    >
      <Text style={[styles.chipText, { color: selected ? tokens.primary : tokens.textSecondary }]}>{label}</Text>
    </Pressable>
  );
}

function FilterOption({ label, subtitle, selected, tokens, onPress, testID }: {
  label: string;
  subtitle?: string;
  selected: boolean;
  tokens: FluentTokens;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      testID={testID}
      onPress={onPress}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: selected }}
      style={[styles.filterOption, { borderBottomColor: tokens.borderSoft }]}
    >
      <MaterialCommunityIcons
        name={selected ? 'checkbox-marked' : 'checkbox-blank-outline'}
        size={22}
        color={selected ? tokens.primary : tokens.iconMuted}
      />
      <View style={styles.flex}>
        <Text style={[styles.filterLabel, { color: tokens.textPrimary }]}>{label}</Text>
        {subtitle ? <Text style={[styles.filterSubtitle, { color: tokens.textSecondary }]}>{subtitle}</Text> : null}
      </View>
    </Pressable>
  );
}

function AnalyticsGroupSection({ title, rows, label, tokens }: {
  title: string;
  rows: TaskAnalyticsGroup[];
  label: (row: TaskAnalyticsGroup) => string;
  tokens: FluentTokens;
}) {
  return (
    <AccountSectionCard tokens={tokens} title={title}>
      {rows.length ? rows.slice(0, 20).map((row, index) => (
        <View key={`${title}-${index}-${label(row)}`} style={[styles.groupRow, { borderBottomColor: tokens.borderSoft }]}> 
          <View style={styles.flex}>
            <Text numberOfLines={2} style={[styles.groupName, { color: tokens.textPrimary }]}>{label(row)}</Text>
            <Text style={[styles.groupMeta, { color: tokens.textSecondary }]}> 
              Открыто {row.open || 0} · В работе {row.in_progress || 0} · Просрочено {row.overdue || 0}
            </Text>
          </View>
          <View style={[styles.groupTotal, { backgroundColor: tokens.selected }]}> 
            <Text style={[styles.groupTotalText, { color: tokens.primary }]}>{row.total || 0}</Text>
          </View>
        </View>
      )) : (
        <Text style={[styles.empty, { color: tokens.textSecondary }]}>Нет данных за выбранный период.</Text>
      )}
    </AccountSectionCard>
  );
}

export function NativeTaskAnalyticsScreen() {
  const { hasPermission, offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const allowed = hasPermission('tasks.read');
  const [filters, setFilters] = useState<AnalyticsFilters>(initialFilters);
  const [applied, setApplied] = useState<AnalyticsFilters>(initialFilters);
  const [payload, setPayload] = useState<TaskAnalyticsPayload | null>(null);
  const [projects, setProjects] = useState<TaskProject[]>([]);
  const [objects, setObjects] = useState<TaskObject[]>([]);
  const [participants, setParticipants] = useState<TaskAssignee[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [filtersVisible, setFiltersVisible] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async (nextFilters: AnalyticsFilters, refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    setError('');
    setMessage('');
    try {
      const next = await getTaskAnalytics(toApiParams(nextFilters));
      setPayload(next);
      setApplied(nextFilters);
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось загрузить аналитику задач.'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    if (!allowed) return;
    const current = initialFilters();
    void load(current);
    void Promise.all([getTaskProjects(), getTaskObjects(), searchTaskAssignees('', 100)])
      .then(([nextProjects, nextObjects, nextParticipants]) => {
        setProjects(nextProjects);
        setObjects(nextObjects);
        setParticipants(nextParticipants);
      })
      .catch(() => undefined);
  }, [allowed, load]);

  const visibleObjects = useMemo(() => (
    filters.projectIds.length
      ? objects.filter((item) => filters.projectIds.includes(String(item.project_id)))
      : objects
  ), [filters.projectIds, objects]);

  const validationError = useMemo(() => {
    if (!validDateInput(filters.startDate) || !validDateInput(filters.endDate)) {
      return 'Укажите даты в формате ГГГГ-ММ-ДД.';
    }
    if (filters.startDate > filters.endDate) return 'Начальная дата не может быть позже конечной.';
    return '';
  }, [filters.endDate, filters.startDate]);

  const applyPreset = (preset: PeriodPreset) => {
    setFilters((current) => ({ ...current, preset, ...taskAnalyticsRange(preset) }));
  };

  const applyFilters = () => {
    if (validationError) {
      setError(validationError);
      return;
    }
    void load(filters);
  };

  const exportExcel = async () => {
    if (offlineMode || exporting) return;
    setExporting(true);
    setError('');
    setMessage('');
    try {
      const exported = await downloadNativeTaskAnalytics(toApiParams(applied));
      await shareNativeFile(exported.file, exported.fileName, exported.mimeType);
      setMessage('Excel-отчёт сформирован.');
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось экспортировать аналитику.'));
    } finally {
      setExporting(false);
    }
  };

  if (!allowed) {
    return (
      <AccountScreenScaffold title="Аналитика задач" onBack={() => router.back()} tokens={tokens}>
        <AccountSectionCard tokens={tokens} title="Нет доступа" description="Нужно право tasks.read.">{null}</AccountSectionCard>
      </AccountScreenScaffold>
    );
  }

  const summary = payload?.summary;
  return (
    <AccountScreenScaffold
      title="Аналитика задач"
      onBack={() => router.back()}
      tokens={tokens}
      refreshing={refreshing}
      onRefresh={() => { void load(applied, true); }}
      rightAction={(
        <Pressable
          testID="native-task-analytics-filters-toggle"
          onPress={() => setFiltersVisible((value) => !value)}
          accessibilityRole="button"
          accessibilityLabel={filtersVisible ? 'Скрыть фильтры' : 'Показать фильтры'}
          accessibilityState={{ expanded: filtersVisible }}
          style={styles.headerAction}
        >
          <MaterialCommunityIcons name="tune-variant" size={22} color={tokens.primary} />
        </Pressable>
      )}
    >
      {offlineMode ? (
        <View accessibilityRole="alert" style={[styles.banner, { backgroundColor: `${tokens.warning}18` }]}> 
          <MaterialCommunityIcons name="cloud-off-outline" size={18} color={tokens.warning} />
          <Text style={[styles.bannerText, { color: tokens.warning }]}>Офлайн: доступны последние загруженные данные, экспорт отключён.</Text>
        </View>
      ) : null}

      {filtersVisible ? (
        <AccountSectionCard tokens={tokens} title="Фильтры" description="Период и разрез совпадают с web-аналитикой.">
          <Text style={[styles.fieldTitle, { color: tokens.textSecondary }]}>Период</Text>
          <View accessibilityRole="radiogroup" style={styles.wrapRow}>
            {PERIOD_OPTIONS.map((item) => (
              <ChoiceChip key={item.value} {...item} selected={filters.preset === item.value} tokens={tokens} onPress={applyPreset} />
            ))}
          </View>
          <View style={styles.dateRow}>
            <View style={styles.flex}>
              <Text style={[styles.inputLabel, { color: tokens.textSecondary }]}>С</Text>
              <TextInput
                testID="native-task-analytics-start-date"
                value={filters.startDate}
                onChangeText={(startDate) => setFilters((current) => ({ ...current, preset: 'custom', startDate }))}
                placeholder="ГГГГ-ММ-ДД"
                placeholderTextColor={tokens.textTertiary}
                accessibilityLabel="Начальная дата"
                style={[styles.input, { color: tokens.textPrimary, borderColor: tokens.borderSoft, backgroundColor: tokens.pageBg }]}
              />
            </View>
            <View style={styles.flex}>
              <Text style={[styles.inputLabel, { color: tokens.textSecondary }]}>По</Text>
              <TextInput
                testID="native-task-analytics-end-date"
                value={filters.endDate}
                onChangeText={(endDate) => setFilters((current) => ({ ...current, preset: 'custom', endDate }))}
                placeholder="ГГГГ-ММ-ДД"
                placeholderTextColor={tokens.textTertiary}
                accessibilityLabel="Конечная дата"
                style={[styles.input, { color: tokens.textPrimary, borderColor: tokens.borderSoft, backgroundColor: tokens.pageBg }]}
              />
            </View>
          </View>
          <Text style={[styles.fieldTitle, { color: tokens.textSecondary }]}>База дат</Text>
          <View accessibilityRole="radiogroup" style={styles.wrapRow}>
            {DATE_BASIS_OPTIONS.map((item) => (
              <ChoiceChip
                key={item.value}
                {...item}
                selected={filters.dateBasis === item.value}
                tokens={tokens}
                onPress={(dateBasis) => setFilters((current) => ({ ...current, dateBasis }))}
              />
            ))}
          </View>

          {projects.length ? (
            <View>
              <Text style={[styles.fieldTitle, { color: tokens.textSecondary }]}>Проекты</Text>
              {projects.map((item) => (
                <FilterOption
                  key={item.id}
                  testID={`native-task-analytics-project-${item.id}`}
                  label={item.name}
                  subtitle={item.code || undefined}
                  selected={filters.projectIds.includes(String(item.id))}
                  tokens={tokens}
                  onPress={() => setFilters((current) => {
                    const projectIds = toggleValue(current.projectIds, String(item.id));
                    const objectIds = current.objectIds.filter((objectId) => {
                      const object = objects.find((entry) => String(entry.id) === objectId);
                      return object ? projectIds.includes(String(object.project_id)) : false;
                    });
                    return { ...current, projectIds, objectIds };
                  })}
                />
              ))}
            </View>
          ) : null}

          {visibleObjects.length ? (
            <View>
              <Text style={[styles.fieldTitle, { color: tokens.textSecondary }]}>Объекты</Text>
              {visibleObjects.map((item) => (
                <FilterOption
                  key={item.id}
                  testID={`native-task-analytics-object-${item.id}`}
                  label={item.name}
                  subtitle={projects.find((project) => String(project.id) === String(item.project_id))?.name}
                  selected={filters.objectIds.includes(String(item.id))}
                  tokens={tokens}
                  onPress={() => setFilters((current) => ({
                    ...current,
                    objectIds: toggleValue(current.objectIds, String(item.id)),
                  }))}
                />
              ))}
            </View>
          ) : null}

          {participants.length ? (
            <View>
              <Text style={[styles.fieldTitle, { color: tokens.textSecondary }]}>Исполнители</Text>
              {participants.map((item) => (
                <FilterOption
                  key={item.id}
                  testID={`native-task-analytics-participant-${item.id}`}
                  label={item.full_name || item.username || `Пользователь ${item.id}`}
                  subtitle={[item.job_title, item.department].filter(Boolean).join(' · ') || undefined}
                  selected={filters.participantUserIds.includes(item.id)}
                  tokens={tokens}
                  onPress={() => setFilters((current) => ({
                    ...current,
                    participantUserIds: toggleValue(current.participantUserIds, item.id),
                  }))}
                />
              ))}
            </View>
          ) : null}
          {validationError ? <Text accessibilityRole="alert" style={[styles.statusText, { color: tokens.error }]}>{validationError}</Text> : null}
          <View style={styles.buttonRow}>
            <View style={styles.flex}>
              <AccountSecondaryButton
                tokens={tokens}
                label="Сбросить"
                onPress={() => setFilters(initialFilters())}
              />
            </View>
            <View style={styles.flex}>
              <AccountPrimaryButton
                testID="native-task-analytics-apply"
                tokens={tokens}
                label={loading ? 'Загрузка…' : 'Применить'}
                disabled={loading || Boolean(validationError)}
                onPress={applyFilters}
              />
            </View>
          </View>
        </AccountSectionCard>
      ) : null}

      {error ? <Text accessibilityRole="alert" style={[styles.statusText, { color: tokens.error }]}>{error}</Text> : null}
      {message ? <Text accessibilityLiveRegion="polite" style={[styles.statusText, { color: tokens.success }]}>{message}</Text> : null}
      {loading && !payload ? <AccountLoading tokens={tokens} /> : null}

      {payload ? (
        <>
          {payload.truncated ? (
            <View accessibilityRole="alert" style={[styles.banner, { backgroundColor: `${tokens.warning}18` }]}> 
              <MaterialCommunityIcons name="alert-outline" size={18} color={tokens.warning} />
              <Text style={[styles.bannerText, { color: tokens.warning }]}>Разрез ограничен серверным лимитом. Уточните период или фильтры.</Text>
            </View>
          ) : null}
          <AccountSectionCard tokens={tokens} title="Итоги" description={`${applied.startDate} — ${applied.endDate}`}>
            <View style={styles.metricsGrid}>
              <Metric label="Всего" value={summary?.total || 0} tokens={tokens} />
              <Metric label="Открыто" value={summary?.open || 0} color={tokens.primary} tokens={tokens} />
              <Metric label="Выполнено" value={summary?.done || 0} color={tokens.success} tokens={tokens} />
              <Metric label="Просрочено" value={summary?.overdue || 0} color={tokens.error} tokens={tokens} />
              <Metric label="Выполнение" value={`${summary?.completion_percent || 0}%`} tokens={tokens} />
              <Metric label="В срок" value={`${summary?.completion_on_time_percent || 0}%`} tokens={tokens} />
            </View>
          </AccountSectionCard>

          <AccountSectionCard tokens={tokens} title="Статусы">
            <View style={styles.statusList}>
              {(payload.status_breakdown || []).map((item) => {
                const max = Math.max(1, summary?.total || 0);
                const width = `${Math.max(3, Math.round((Number(item.value || 0) / max) * 100))}%` as `${number}%`;
                return (
                  <View key={item.status} style={styles.statusItem}>
                    <View style={styles.statusHeader}>
                      <Text style={[styles.filterLabel, { color: tokens.textPrimary }]}>{item.label}</Text>
                      <Text style={[styles.filterLabel, { color: tokens.textSecondary }]}>{item.value || 0}</Text>
                    </View>
                    <View style={[styles.progressTrack, { backgroundColor: tokens.borderSoft }]}> 
                      <View style={[styles.progressValue, { width, backgroundColor: item.status === 'done' ? tokens.success : tokens.primary }]} />
                    </View>
                  </View>
                );
              })}
            </View>
          </AccountSectionCard>

          <AccountSectionCard tokens={tokens} title="Динамика" description={`Группировка: ${payload.trend?.granularity || 'day'}`}>
            {(payload.trend?.items || []).length ? payload.trend.items.slice(-24).map((item) => (
              <View key={item.bucket_key} style={[styles.trendRow, { borderBottomColor: tokens.borderSoft }]}> 
                <Text style={[styles.trendLabel, { color: tokens.textSecondary }]}>{item.bucket_label}</Text>
                <Text style={[styles.trendValue, { color: tokens.primary }]}>+{item.created || 0}</Text>
                <Text style={[styles.trendValue, { color: tokens.success }]}>✓ {item.completed || 0}</Text>
                <Text style={[styles.trendValue, { color: tokens.textSecondary }]}>в срок {item.completed_on_time || 0}</Text>
              </View>
            )) : <Text style={[styles.empty, { color: tokens.textSecondary }]}>Нет динамики за выбранный период.</Text>}
          </AccountSectionCard>

          <AnalyticsGroupSection title="По исполнителям" rows={payload.by_participant || []} label={(row) => row.participant_name || 'Не назначен'} tokens={tokens} />
          <AnalyticsGroupSection title="По проектам" rows={payload.by_project || []} label={(row) => row.project_name || 'Без проекта'} tokens={tokens} />
          <AnalyticsGroupSection title="По объектам" rows={payload.by_object || []} label={(row) => row.object_name || 'Без объекта'} tokens={tokens} />

          <AccountPrimaryButton
            testID="native-task-analytics-export"
            tokens={tokens}
            label={exporting ? 'Формируем Excel…' : 'Экспортировать Excel'}
            disabled={offlineMode || exporting}
            onPress={() => { void exportExcel(); }}
          />
        </>
      ) : null}
    </AccountScreenScaffold>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, minWidth: 0 },
  headerAction: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  banner: { minHeight: 42, borderRadius: 12, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 8 },
  bannerText: { flex: 1, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  fieldTitle: { marginTop: 12, marginBottom: 6, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  wrapRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { minHeight: 44, borderRadius: 22, borderWidth: 1, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 13, fontWeight: '800' },
  dateRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  inputLabel: { marginBottom: 4, fontSize: 12, fontWeight: '700' },
  input: { minHeight: 44, borderRadius: 12, borderWidth: 1, paddingHorizontal: 10, fontSize: 14 },
  filterOption: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 9, borderBottomWidth: StyleSheet.hairlineWidth },
  filterLabel: { fontSize: 14, fontWeight: '700' },
  filterSubtitle: { marginTop: 2, fontSize: 12 },
  buttonRow: { flexDirection: 'row', gap: 10, marginTop: 14 },
  statusText: { fontSize: 13, lineHeight: 18, fontWeight: '700' },
  metricsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  metric: { width: '31%', minWidth: 92, flexGrow: 1, borderWidth: 1, borderRadius: 12, padding: 10 },
  metricValue: { fontSize: 21, lineHeight: 26, fontWeight: '900' },
  metricLabel: { marginTop: 2, fontSize: 11, lineHeight: 14, fontWeight: '700' },
  statusList: { gap: 12 },
  statusItem: { gap: 5 },
  statusHeader: { flexDirection: 'row', justifyContent: 'space-between', gap: 10 },
  progressTrack: { height: 7, borderRadius: 4, overflow: 'hidden' },
  progressValue: { height: 7, borderRadius: 4 },
  trendRow: { minHeight: 42, flexDirection: 'row', alignItems: 'center', gap: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  trendLabel: { width: 72, fontSize: 12, fontWeight: '700' },
  trendValue: { flex: 1, fontSize: 12, fontWeight: '800' },
  groupRow: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  groupName: { fontSize: 14, lineHeight: 18, fontWeight: '800' },
  groupMeta: { marginTop: 3, fontSize: 11, lineHeight: 15, fontWeight: '600' },
  groupTotal: { minWidth: 36, minHeight: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8 },
  groupTotalText: { fontSize: 13, fontWeight: '900' },
  empty: { paddingVertical: 12, textAlign: 'center', fontSize: 13 },
});
