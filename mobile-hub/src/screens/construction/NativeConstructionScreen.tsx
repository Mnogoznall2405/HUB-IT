import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, TextInput, View } from 'react-native';
import * as constructionApi from '../../api/constructionApi';
import type { ConstructionDetail, ConstructionObject, ConstructionPage, ConstructionRequest, ConstructionScope } from '../../api/constructionApi';
import { formatApiError } from '../../api/formatError';
import { useAuth } from '../../auth/AuthContext';
import { readNativeEntitySnapshot, writeNativeEntitySnapshot, formatNativeSnapshotSavedAt } from '../../cache/nativeSnapshotCache';
import { constructionHref } from '../../construction/nativeConstructionRoutes';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens } from '../../theme/fluentTokens';
import { AccountActionRow, AccountScreenScaffold, AccountSectionCard, AccountSecondaryButton } from '../account/AccountChrome';
import { goBackOrReplace } from '../account/accountBack';
import { NativeConstructionWorkPanel } from './NativeConstructionWorkPanel';

type Content = { detail?: ConstructionDetail; request?: ConstructionRequest; page?: ConstructionPage<ConstructionObject | ConstructionRequest> };
const roles: Record<string, string> = {
  project_lead: 'Руководитель проекта', pto_manager: 'Руководитель ПТО',
  umto_coordinator: 'Координатор УМТО', chief_project_engineer: 'Главный инженер проекта',
};
const dateText = (value?: string) => value ? new Date(value).toLocaleDateString('ru-RU') : '—';

export function NativeConstructionScreen(scope: ConstructionScope) {
  const { user, hasPermission } = useAuth();
  const allowed = hasPermission('construction.read');
  return <ConstructionContent key={`${user?.id}:${allowed}:${scope.objectId}:${scope.groupRef}:${scope.requestRef}:${scope.tab}`} {...scope} />;
}

function ConstructionContent({ objectId, groupRef, requestRef, tab }: ConstructionScope) {
  const { user, hasPermission, offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const allowed = hasPermission('construction.read');
  const [query, setQuery] = useState('');
  const [draft, setDraft] = useState('');
  const [view, setView] = useState('active');
  const [kind, setKind] = useState('project');
  const [content, setContent] = useState<Content | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [cachedAt, setCachedAt] = useState(0);
  const [revision, setRevision] = useState(0);
  const [cursor, setCursor] = useState('');
  const [activeTab, setActiveTab] = useState(tab === 'work' && objectId && !requestRef ? 'work' : 'requests');
  const generation = useRef(0);
  const currentContent = useRef(content);
  const detailCache = useRef<{ revision: number; detail: ConstructionDetail } | null>(null);
  currentContent.current = content;
  const cacheKey = JSON.stringify([objectId, groupRef, requestRef, query, view, kind]);

  useEffect(() => {
    const timer = setTimeout(() => { setQuery(draft.trim()); setCursor(''); }, 300);
    return () => clearTimeout(timer);
  }, [draft]);

  useEffect(() => {
    const lease = ++generation.current;
    const controller = new AbortController();
    const current = () => generation.current === lease && !controller.signal.aborted;
    if (offlineMode) detailCache.current = null;
    if (!allowed || !user?.id) { setLoading(false); return () => controller.abort(); }
    if (activeTab === 'work') { setLoading(false); return () => controller.abort(); }
    const userId = user.id;
    setLoading(true);
    setError('');
    if (!cursor) setContent(null);
    void (async () => {
      const cached = await readNativeEntitySnapshot<Content>('construction-details', userId, cacheKey);
      if (!current()) return;
      if (cached && !cursor) { setContent(cached.data); setCachedAt(cached.savedAt); }
      if (offlineMode) {
        if (!cached) setError('Нет сохранённой копии. Откройте этот раздел при подключении к сети.');
        setLoading(false);
        return;
      }
      try {
        const scope = { objectId, groupRef, requestRef };
        let next: Content;
        if (requestRef) next = { request: await constructionApi.getConstructionRequest(scope, controller.signal) };
        else if (objectId) {
          const [detail, page] = await Promise.all([
            detailCache.current?.revision === revision
              ? Promise.resolve(detailCache.current.detail)
              : constructionApi.getConstructionDetail(scope, controller.signal),
            constructionApi.getConstructionRequests(scope, { q: query, view, cursor }, controller.signal),
          ]);
          next = { detail, page };
        } else next = { page: await constructionApi.getConstructionObjects({ q: query, kind, cursor }, controller.signal) };
        if (!current()) return;
        if (next.detail) detailCache.current = { revision, detail: next.detail };
        if (cursor && next.page && !next.page.snapshot_changed) {
          const rows = [...(currentContent.current?.page?.items || []), ...next.page.items];
          const seen = new Set<string>();
          next.page.items = rows.filter(row => {
            const id = 'object_ref' in row ? row.object_ref : row.request_ref;
            if (seen.has(id)) return false;
            seen.add(id); return true;
          });
        }
        setContent(next); setCachedAt(0);
        void writeNativeEntitySnapshot('construction-details', userId, cacheKey, next);
      } catch (cause) {
        if (current()) setError(formatApiError(cause, 'Не удалось загрузить данные объекта.'));
      } finally { if (current()) setLoading(false); }
    })();
    return () => { controller.abort(); generation.current += 1; };
  }, [allowed, user?.id, offlineMode, objectId, groupRef, requestRef, query, view, kind, cursor, revision, cacheKey, activeTab]);

  const open = (scope: ConstructionScope) => router.push(constructionHref(scope) as never);
  const title = content?.request?.request_number || content?.detail?.group_name || content?.detail?.name || 'Объекты строительства';
  const textStyle = { color: tokens.textPrimary, fontSize: 15, lineHeight: 22 };
  const mutedStyle = { ...textStyle, color: tokens.textSecondary };
  const refresh = () => { setCursor(''); setRevision(value => value + 1); };
  const back = () => goBackOrReplace(objectId ? '/(shell)/construction' : '/(shell)/menu');
  const choice = (label: string, value: string, selected: string, select: (value: string) => void) => (
    <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: selected === value }}
      onPress={() => { select(value); setCursor(''); }}
      style={{ padding: 10, borderRadius: 10, borderWidth: 1, borderColor: tokens.border, backgroundColor: selected === value ? tokens.selected : tokens.panelSolid }}>
      <Text style={textStyle}>{label}</Text>
    </Pressable>
  );
  const tabs = allowed && objectId && !requestRef ? <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
    {choice('Заявки', 'requests', activeTab, setActiveTab)}
    {choice('Ход работ', 'work', activeTab, setActiveTab)}
  </View> : null;
  if (allowed && objectId && !requestRef && activeTab === 'work') return (
    <AccountScreenScaffold title={content?.detail?.group_name || content?.detail?.name || 'Ход работ'} tokens={tokens} onBack={back} scroll={false}>
      {tabs}
      <NativeConstructionWorkPanel objectId={objectId} groupRef={groupRef} />
    </AccountScreenScaffold>
  );
  const header = <View style={{ gap: 12 }}>
    {!allowed ? <AccountSectionCard tokens={tokens} title="Нет доступа" description="Требуется право просмотра объектов строительства.">{null}</AccountSectionCard> : <>
      {offlineMode || cachedAt ? <Text style={mutedStyle}>Сохранённая копия{cachedAt ? ` · ${formatNativeSnapshotSavedAt(cachedAt)}` : ''}</Text> : null}
      {error ? <Text accessibilityRole="alert" style={{ color: tokens.error }}>{error}</Text> : null}
      {error && !offlineMode ? <AccountSecondaryButton tokens={tokens} label="Повторить" onPress={refresh} /> : null}
      {!requestRef ? <>
        <TextInput accessibilityLabel={objectId ? 'Поиск заявок' : 'Поиск объектов'} placeholder={objectId ? 'Номер заявки, материал' : 'Название объекта'}
          placeholderTextColor={tokens.textSecondary} value={draft} onChangeText={setDraft}
          style={{ ...textStyle, borderColor: tokens.border, borderWidth: 1, borderRadius: 12, padding: 12 }} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {objectId ? <>{choice('Активные', 'active', view, setView)}{choice('История', 'history', view, setView)}</>
            : <>{choice('Объекты', 'project', kind, setKind)}{choice('Все', 'all', kind, setKind)}{choice('Общие', 'general', kind, setKind)}{choice('Без объекта', 'unassigned', kind, setKind)}</>}
        </View>
      </> : null}
      {content?.detail ? <AccountSectionCard tokens={tokens} title={content.detail.object_name || content.detail.name || content.detail.group_name}>
        {(content.detail.team || content.detail.object_team || []).map((member, index) => (
          <Text key={`${member.role_key}:${index}`} style={textStyle}>{roles[member.role_key] || member.role_key}: {member.full_name}</Text>
        ))}
        {!groupRef ? (content.detail.groups || []).map(group => <AccountActionRow key={group.group_ref} tokens={tokens} icon="source-branch"
          label={group.group_name} subtitle={`Активных заявок: ${group.active_request_count ?? '—'}`}
          onPress={() => open({ objectId, groupRef: group.group_ref })} />) : null}
      </AccountSectionCard> : null}
      {content?.request ? <AccountSectionCard tokens={tokens} title={content.request.current_state?.label || content.request.stage?.label || 'Заявка'}>
        <Text style={mutedStyle}>{content.request.current_state?.description || content.request.progress_label}</Text>
        <Text style={textStyle}>Дата: {dateText(content.request.date)} · Требуется: {dateText(content.request.required_date)}</Text>
        <Text style={textStyle}>Склад: {content.request.warehouse_name || '—'}</Text>
        <Text style={textStyle}>Подразделение: {content.request.department_name || '—'}</Text>
        <Text style={textStyle}>Ответственный: {content.request.responsible_name || '—'}</Text>
        <Text style={textStyle}>Закупщики: {content.request.manager_names?.join(', ') || '—'}</Text>
        <Text style={textStyle}>Поставщики: {content.request.supplier_names?.join(', ') || '—'}</Text>
        {(content.request.item_groups || content.request.nomenclature_items || []).map((item, index) => <View key={index} style={{ gap: 4, paddingVertical: 10, borderTopWidth: 1, borderColor: tokens.border }}>
          <Text style={textStyle}>{item.name || item.nomenclature_name}{item.cancelled ? ' · Отменено' : ''}</Text>
          {item.characteristic_name ? <Text style={mutedStyle}>{item.characteristic_name}</Text> : null}
          <Text style={mutedStyle}>Заявлено: {item.qty_requested ?? item.quantity ?? '—'} {item.unit || item.unit_name} · Заказано: {item.qty_ordered ?? '—'} · Получено: {item.qty_received ?? '—'}</Text>
        </View>)}
      </AccountSectionCard> : null}
      {content?.page?.scan_truncated || content?.page?.truncated ? <Text style={mutedStyle}>Показана ограниченная выборка. Уточните поиск.</Text> : null}
      {content?.page?.cache?.state === 'stale' ? <Text style={mutedStyle}>Данные 1С могут быть устаревшими.</Text> : null}
    </>}
  </View>;
  return <AccountScreenScaffold title={title} tokens={tokens} onBack={back} scroll={false}>
    {tabs}
    <FlatList
      initialNumToRender={12}
      maxToRenderPerBatch={10}
      windowSize={7}
      data={allowed ? content?.page?.items || [] : []} keyExtractor={row => 'object_ref' in row ? row.object_ref : row.request_ref}
      ListHeaderComponent={header} contentContainerStyle={{ gap: 12, paddingBottom: 16 }}
      refreshing={loading && Boolean(content)} onRefresh={allowed && !offlineMode ? refresh : undefined}
      renderItem={({ item }) => 'object_ref' in item ? <AccountSectionCard tokens={tokens}>
        {item.kind === 'project' ? <AccountActionRow tokens={tokens} icon="office-building-outline" label={item.name}
          subtitle={`Заявок: ${item.request_count}`} onPress={() => open({ objectId: item.managed_object_id || item.object_ref })} />
          : <><Text style={textStyle}>{item.name}</Text><Text style={mutedStyle}>Заявок: {item.request_count}. Заявки общего назначения не входят в карточку строительного объекта.</Text></>}
        {(item.team || []).map((member, index) => <Text key={index} style={mutedStyle}>{member.full_name}</Text>)}
      </AccountSectionCard> : <AccountSectionCard tokens={tokens}>
        <AccountActionRow tokens={tokens} icon="file-document-outline" label={item.request_number || 'Заявка'}
          subtitle={`${item.stage?.label || 'Состояние не определено'} · ${item.warehouse_name || 'Склад не указан'}`}
          onPress={() => open({ objectId, groupRef, requestRef: item.request_ref })} />
      </AccountSectionCard>}
      ListEmptyComponent={allowed && !loading && !error && !requestRef ? <Text style={mutedStyle}>{objectId ? 'Заявки не найдены' : 'Объекты не найдены'}</Text> : null}
      ListFooterComponent={loading ? <ActivityIndicator color={tokens.primary} /> : content?.page?.has_more && content.page.next_cursor && !offlineMode
        ? <AccountSecondaryButton tokens={tokens} label="Показать ещё" onPress={() => setCursor(content.page!.next_cursor!)} /> : null} />
  </AccountScreenScaffold>;
}
