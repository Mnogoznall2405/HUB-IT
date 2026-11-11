import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import { getConstructionWork, type ConstructionWorkItem, type ConstructionWorkProgress } from '../../api/constructionApi';
import { formatApiError } from '../../api/formatError';
import { useAuth } from '../../auth/AuthContext';
import { formatNativeSnapshotSavedAt, readNativeEntitySnapshot, writeNativeEntitySnapshot } from '../../cache/nativeSnapshotCache';
import { constructionHref } from '../../construction/nativeConstructionRoutes';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens } from '../../theme/fluentTokens';
import { AccountActionRow, AccountSectionCard, AccountSecondaryButton } from '../account/AccountChrome';

const today = () => {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
const dateLabel = (value?: string | null) => value ? value.split('-').reverse().join('.') : '—';
const amount = (value: number | string) => Number(value).toLocaleString('ru-RU', { maximumFractionDigits: 4 });
const percent = (value: number | null) => value == null ? 'Не рассчитано' : `${amount(value)}%`;
export const constructionWorkSnapshotKey = (objectId: string, groupRef: string | undefined, date: string, archived: boolean) =>
  JSON.stringify(['work-progress', objectId, groupRef, date, archived]);

export function NativeConstructionWorkPanel({ objectId, groupRef }: { objectId: string; groupRef?: string }) {
  const { user, hasPermission, offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const allowed = hasPermission('construction.read');
  const [date, setDate] = useState(today);
  const [draftDate, setDraftDate] = useState(date);
  const [dateError, setDateError] = useState('');
  const [archived, setArchived] = useState(false);
  const [section, setSection] = useState('');
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<ConstructionWorkProgress | null>(null);
  const [savedAt, setSavedAt] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const key = constructionWorkSnapshotKey(objectId, groupRef, date, archived);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const current = () => active && !controller.signal.aborted;
    setData(null); setError(''); setSavedAt(0); setLoading(false);
    if (!allowed || !user?.id) return () => { active = false; controller.abort(); };
    const userId = user.id;
    setLoading(true);
    void (async () => {
      try {
        const cached = await readNativeEntitySnapshot<ConstructionWorkProgress>('construction-details', userId, key);
        if (!current()) return;
        if (cached) { setData(cached.data); setSavedAt(cached.savedAt); }
        if (offlineMode) {
          if (!cached) setError('Нет сохранённого хода работ для этой даты. Откройте его при подключении к сети.');
          return;
        }
        const result = await getConstructionWork({ objectId, groupRef }, { as_of: date, include_archived: archived }, controller.signal);
        if (!current()) return;
        setData(result); setSavedAt(0);
        await writeNativeEntitySnapshot('construction-details', userId, key, result);
      } catch (cause) {
        if (current()) setError(formatApiError(cause, 'Не удалось загрузить ход работ.'));
      } finally { if (current()) setLoading(false); }
    })();
    return () => { active = false; controller.abort(); };
  }, [allowed, user?.id, offlineMode, objectId, groupRef, date, archived, key, revision]);

  const availableItems = useMemo(() => (data?.items || []).filter(item => item.plan.archived === archived), [data, archived]);
  const sections = useMemo(() => [...new Set(availableItems.map(item => item.plan.section))], [availableItems]);
  const items = useMemo(() => availableItems.filter(item => !section || item.plan.section === section), [availableItems, section]);
  const text = { color: tokens.textPrimary, fontSize: 15, lineHeight: 22 };
  const muted = { ...text, color: tokens.textSecondary };
  const select = (label: string, selected: boolean, onPress: () => void) => (
    <Pressable key={label} accessibilityRole="button" accessibilityState={{ selected }} onPress={onPress}
      style={{ padding: 10, borderWidth: 1, borderRadius: 10, borderColor: tokens.border, backgroundColor: selected ? tokens.selected : tokens.panelSolid }}>
      <Text style={text}>{label}</Text>
    </Pressable>
  );
  const applyDate = () => {
    const value = draftDate.trim();
    const parsed = new Date(`${value}T12:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value
      || value < '2000-01-01' || value > '2100-12-31') {
      setDateError('Укажите существующую дату в формате ГГГГ-ММ-ДД (2000–2100).'); return;
    }
    setDateError(''); setSection(''); setDate(value);
  };
  const workCard = ({ item }: { item: ConstructionWorkItem }) => <AccountSectionCard tokens={tokens} title={item.plan.name}>
    <Text style={muted}>{item.plan.section}{!groupRef ? ` · ${data?.directions.find(direction => direction.group_ref === item.group_ref)?.name || 'Направление'}` : ''}</Text>
    <Text style={text}>Выполнение: {percent(item.percent)}{item.overdue ? ' · Просрочено' : ''}{item.plan.archived ? ' · Архив' : ''}</Text>
    <Text style={text}>План: {amount(item.plan.planned_quantity)} {item.plan.unit} · Факт: {amount(item.total_quantity)} {item.plan.unit}</Text>
    <Text style={text}>Осталось: {amount(item.remaining_quantity)} {item.plan.unit}</Text>
    <Text style={muted}>Плановые сроки: {dateLabel(item.plan.planned_start)} — {dateLabel(item.plan.planned_end)}</Text>
    {item.plan.revised_start || item.plan.revised_end ? <Text style={muted}>Уточнённые сроки: {dateLabel(item.plan.revised_start)} — {dateLabel(item.plan.revised_end)}</Text> : null}
    <Text style={muted}>Фактические сроки: {dateLabel(item.plan.actual_start)} — {dateLabel(item.plan.actual_end)}</Text>
    <Text style={text}>За {dateLabel(data?.as_of)}: {amount(item.day.quantity)} {item.plan.unit}</Text>
    <Text style={muted}>ИТР: {item.day.engineers} · Монтажники: {item.day.installers}</Text>
    {item.day.comment ? <Text style={text}>За смену: {item.day.comment}</Text> : null}
    {item.plan.material_comment ? <Text style={text}>Материалы: {item.plan.material_comment}</Text> : null}
    {item.plan.production_comment ? <Text style={text}>Производство: {item.plan.production_comment}</Text> : null}
  </AccountSectionCard>;

  if (!allowed) return <Text style={text}>Нет доступа к ходу работ.</Text>;
  return <FlatList style={{ flex: 1 }} data={items} keyExtractor={item => item.id} renderItem={workCard}
    keyboardShouldPersistTaps="handled"
    initialNumToRender={8} maxToRenderPerBatch={8} windowSize={5}
    contentContainerStyle={{ gap: 12, paddingBottom: 16 }}
    refreshing={loading && Boolean(data)} onRefresh={!offlineMode ? () => setRevision(value => value + 1) : undefined}
    ListHeaderComponent={<View style={{ gap: 12 }}>
      <Text style={muted}>План и фактическое выполнение работ на выбранную дату.</Text>
      <Text style={text}>Дата учёта (ГГГГ-ММ-ДД)</Text>
      <TextInput accessibilityLabel="Дата учёта" value={draftDate} onChangeText={setDraftDate} placeholder="ГГГГ-ММ-ДД"
        placeholderTextColor={tokens.textSecondary} style={{ ...text, padding: 12, borderWidth: 1, borderColor: tokens.border, borderRadius: 10 }} />
      <AccountSecondaryButton tokens={tokens} label="Показать на дату" onPress={applyDate} />
      {dateError ? <Text accessibilityRole="alert" style={{ color: tokens.error }}>{dateError}</Text> : null}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {select('Текущие работы', !archived, () => { setSection(''); setArchived(false); })}
        {select('Архив работ', archived, () => { setSection(''); setArchived(true); })}
      </View>
      {offlineMode || savedAt ? <Text style={muted}>Сохранённая копия{savedAt ? ` · ${formatNativeSnapshotSavedAt(savedAt)}` : ''}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: tokens.error }}>{error}</Text> : null}
      {error && !offlineMode ? <AccountSecondaryButton tokens={tokens} label="Повторить загрузку работ" onPress={() => setRevision(value => value + 1)} /> : null}
      {data ? <AccountSectionCard tokens={tokens} title={`Сводка на ${dateLabel(data.as_of)}`}>
        <Text style={text}>Общее выполнение: {percent(data.summary.percent)}</Text>
        <Text style={muted}>Текущих работ: {data.summary.total} · Завершено: {data.summary.completed} · Просрочено: {data.summary.overdue}</Text>
        <Text style={muted}>Сверх плана: {data.summary.over_plan}</Text>
        {data.summary.missing_weights_or_plan ? <Text style={muted}>Без веса или планового объёма: {data.summary.missing_weights_or_plan}. Сводный процент может быть неполным.</Text> : null}
        {data.summary.calculation?.notes.map((note, index) => <Text key={index} style={muted}>{note}</Text>)}
        {!groupRef ? data.directions.map(direction => <AccountActionRow key={direction.group_ref} tokens={tokens} icon="source-branch"
          label={direction.name} subtitle={`Выполнение: ${percent(direction.percent)} · Работ: ${direction.total}`}
          onPress={() => router.push(constructionHref({ objectId, groupRef: direction.group_ref, tab: 'work' }) as never)} />) : null}
        {data.calculation_sections?.map(value => <Text key={value.name} style={muted}>{value.name}: {percent(value.percent)}</Text>)}
      </AccountSectionCard> : null}
      {sections.length > 1 ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {select('Все разделы', !section, () => setSection(''))}
        {sections.map(name => select(name, section === name, () => setSection(name)))}
      </View> : null}
    </View>}
    ListEmptyComponent={!loading && !error ? <Text style={muted}>{archived ? 'Архивных работ нет' : 'Работы на эту дату не найдены'}</Text> : null}
    ListFooterComponent={loading ? <ActivityIndicator accessibilityLabel="Загрузка хода работ" color={tokens.primary} /> : null} />;
}
