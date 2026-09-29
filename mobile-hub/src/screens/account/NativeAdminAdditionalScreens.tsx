import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, Switch, Text, View } from 'react-native';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as api from '../../api/adminSettingsApi';
import { listAvailableDatabases } from '../../api/databaseApi';
import {
  AI_BOT_TOOL_GROUPS,
  aiBotToolsEnabledInGroup,
  toggleAiBotTool,
} from '../../account/aiBotTools';
import { useAuth } from '../../auth/AuthContext';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens } from '../../theme/fluentTokens';
import { useNativeBottomNavInset } from '../../navigation/useNativeBottomNavInset';
import { HubTextField } from '../../components/ui/HubTextField';
import { AccountActionRow, AccountPrimaryButton, AccountScreenScaffold, AccountSecondaryButton, AccountSectionCard, AccountSubpage } from './AccountChrome';
import { goBackOrReplace } from './accountBack';
import { useNativeAdminData } from './useNativeAdminData';
import { NativeAdminEnvEditor } from './NativeAdminEnvEditor';

function useAdminTheme() {
  const { preferences } = usePreferences();
  return useFluentTokens(preferences.theme_mode);
}
function AdminStatus({ state }: { state: { allowed: boolean; ready: boolean; error: string; busy: boolean; reload: () => void } }) {
  const tokens = useAdminTheme();
  return <View style={{ gap: 10 }}>
    {!state.allowed ? <Text style={{ color: tokens.textPrimary }}>Нет доступа к этому разделу.</Text> : !state.ready
      ? <Text style={{ color: tokens.textSecondary }}>Для администрирования требуется подключение к сети.</Text> : null}
    {state.error ? <><Text accessibilityRole="alert" style={{ color: tokens.error }}>{state.error}</Text>
      <AccountSecondaryButton tokens={tokens} label="Повторить" onPress={state.reload} /></> : null}
    {state.busy ? <ActivityIndicator color={tokens.primary} /> : null}
  </View>;
}
const back = () => goBackOrReplace('/(shell)/menu/admin');

export function NativeAdminAdUsersScreen() {  const access = useAuth();
  return <AdUsersScreen key={`${access.user?.id}:${access.user?.role}:${access.offlineMode}`} />;
}
function AdUsersScreen() {
  const state = useNativeAdminData('ad-users', api.getAdCandidates);
  const tokens = useAdminTheme();
  const navInset = useNativeBottomNavInset();
  const [search, setSearch] = useState('');
  const [result, setResult] = useState('');
  const rows = (state.data || []).filter(item => `${item.login} ${item.display_name || item.full_name || ''} ${item.department || ''}`.toLowerCase().includes(search.toLowerCase()));
  const act = (item: api.AdCandidate) => Alert.alert('Пользователь AD', `Обновить учётную запись HUB-IT для ${item.login}?`, [
    { text: 'Отмена', style: 'cancel' },
    { text: 'Продолжить', onPress: () => { void state.run(async () => {
      if (item.import_status === 'new') await api.importAdUser(item.login);
      else {
        const response = await api.syncAdUser(item.login);
        if (response?.errors?.length || response?.not_found || response?.skipped_conflict) throw new Error('Не удалось синхронизировать выбранную учётную запись. Проверьте её состояние в AD.');
      }
    }).then(saved => { if (saved) setResult('Учётная запись обновлена.'); }); } },
  ]);
  return <AccountScreenScaffold title="Пользователи AD" tokens={tokens} onBack={back} scroll={false} contentUnderNav>
    <FlatList
      initialNumToRender={12}
      maxToRenderPerBatch={10}
      windowSize={7}
      data={rows} keyExtractor={item => item.login} contentContainerStyle={{ gap: 12, paddingBottom: navInset }}
      ListHeaderComponent={<View style={{ gap: 12 }}><AdminStatus state={state} />
        {state.ready ? <HubTextField label="Поиск пользователей AD" value={search} onChangeText={setSearch} /> : null}
        {state.ready && result ? <Text style={{ color: tokens.textPrimary }}>{result}</Text> : null}</View>}
      ListEmptyComponent={state.ready && !state.busy && !state.error ? <Text style={{ color: tokens.textSecondary }}>Пользователи не найдены</Text> : null}
      renderItem={({ item }) => <AccountSectionCard tokens={tokens} title={item.display_name || item.full_name || item.login} description={`${item.login} · ${item.department || 'Отдел не указан'}`}>
        {item.import_status === 'local_conflict' ? <Text style={{ color: tokens.error }}>Конфликт с локальной учётной записью</Text>
          : <AccountSecondaryButton tokens={tokens} label={item.import_status === 'new' ? 'Импортировать' : 'Синхронизировать'} disabled={!state.ready || state.busy} onPress={() => act(item)} />}
      </AccountSectionCard>} />
  </AccountScreenScaffold>;
}

const emptyBot: Partial<api.AdminAiBot> = {
  title: '', slug: '', description: '', model: '', system_prompt: '',
  temperature: 0.2, max_tokens: 2000, is_enabled: true,
  allow_file_input: true, allow_generated_artifacts: true, allow_kb_document_delivery: false,
  enabled_tools: [], allowed_kb_scope: [],
  tool_settings: { multi_db_mode: 'single', allowed_databases: [], max_tool_rounds: 6, max_tool_calls_per_round: 3 },
};
export function NativeAdminAiBotsScreen() {
  const access = useAuth();
  return <AiBotsScreen key={`${access.user?.id}:${access.user?.role}:${access.offlineMode}:${access.hasPermission('settings.ai.manage')}`} />;
}
function AiBotsScreen() {
  const state = useNativeAdminData('ai-bots', api.getAdminAiBots);
  const tokens = useAdminTheme();
  const navInset = useNativeBottomNavInset();
  const [draft, setDraft] = useState<Partial<api.AdminAiBot> | null>(null);
  const [accessFor, setAccessFor] = useState<api.AdminAiBot | null>(null);
  const [runsFor, setRunsFor] = useState<string | null>(null);
  const [kbScopeText, setKbScopeText] = useState('');
  const [databases, setDatabases] = useState<Array<{ id: string; name: string }>>([]);
  const openDraft = (bot: api.AdminAiBot | Partial<api.AdminAiBot>) => {
    setDraft({ ...bot });
    setKbScopeText(Array.isArray(bot.allowed_kb_scope) ? bot.allowed_kb_scope.join(', ') : '');
  };
  const [runs, setRuns] = useState<Awaited<ReturnType<typeof api.getAdminAiBotRuns>> | null>(null);
  const [runsError, setRunsError] = useState('');
  useEffect(() => { if (!state.ready) { setDraft(null); setRunsFor(null); setRuns(null); setAccessFor(null); } }, [state.ready]);
  const draftOpen = Boolean(draft);
  useEffect(() => {
    if (!draftOpen || databases.length) return;
    void listAvailableDatabases()
      .then((items) => setDatabases(items.map((item) => ({ id: item.id, name: item.name || item.id }))))
      .catch(() => setDatabases([]));
  }, [draftOpen, databases.length]);
  useEffect(() => {
    const controller = new AbortController();
    setRuns(null); setRunsError('');
    if (runsFor && state.ready) void api.getAdminAiBotRuns(runsFor, controller.signal).then(data => {
      if (!controller.signal.aborted) setRuns(data);
    }).catch(() => { if (!controller.signal.aborted) setRunsError('Не удалось загрузить историю запусков.'); });
    return () => controller.abort();
  }, [runsFor, state.ready]);
  const save = () => {
    if (!draft || !draft.title?.trim() || (!draft.id && (draft.slug?.trim().length || 0) < 2)) return;
    const toolSettings = draft.tool_settings || {};
    const fields = { title: draft.title, description: draft.description, model: draft.model, system_prompt: draft.system_prompt,
      temperature: draft.temperature, max_tokens: draft.max_tokens, is_enabled: draft.is_enabled,
      allow_file_input: draft.allow_file_input, allow_generated_artifacts: draft.allow_generated_artifacts,
      allow_kb_document_delivery: draft.allow_kb_document_delivery,
      enabled_tools: Array.isArray(draft.enabled_tools) ? draft.enabled_tools : [],
      allowed_kb_scope: kbScopeText.split(',').map((value) => value.trim()).filter(Boolean),
      tool_settings: {
        multi_db_mode: toolSettings.multi_db_mode === 'multi' ? 'multi' : 'single',
        allowed_databases: Array.isArray(toolSettings.allowed_databases) ? toolSettings.allowed_databases : [],
        max_tool_rounds: Number(toolSettings.max_tool_rounds ?? 6),
        max_tool_calls_per_round: Number(toolSettings.max_tool_calls_per_round ?? 3),
      },
      ...(!draft.id ? { slug: draft.slug } : {}) };
    void state.run(() => api.saveAdminAiBot(draft.id || null, fields)).then(saved => { if (saved) setDraft(null); });
  };
  return <AccountScreenScaffold title="AI-боты" tokens={tokens} onBack={back} scroll={false} contentUnderNav>
    <FlatList data={state.data || []} keyExtractor={bot => bot.id} initialNumToRender={12} maxToRenderPerBatch={10} windowSize={7}
      contentContainerStyle={{ paddingBottom: navInset }}
      ListHeaderComponent={<View style={{ gap: 12 }}>
    <AdminStatus state={state} />
    {state.ready ? <AccountPrimaryButton tokens={tokens} label="Создать бота" onPress={() => openDraft({ ...emptyBot })} disabled={state.busy} /> : null}
      </View>} renderItem={({ item: bot }) => (<AccountSectionCard key={bot.id} tokens={tokens} title={bot.title} description={`${bot.model || 'Модель по умолчанию'} · ${bot.is_enabled ? 'Включён' : 'Выключен'}`}>
      <AccountSecondaryButton tokens={tokens} label={`Настроить ${bot.title}`} onPress={() => openDraft(bot)} disabled={!state.ready || state.busy} />
      <AccountSecondaryButton tokens={tokens} label={`Доступ к ${bot.title}`} onPress={() => setAccessFor(bot)} disabled={!state.ready || state.busy} />
      <AccountSecondaryButton tokens={tokens} label={`Запуски ${bot.title}`} onPress={() => setRunsFor(bot.id)} />
    </AccountSectionCard>)} />
    <AiBotAccessSubpage bot={accessFor} tokens={tokens} ready={state.ready} onClose={() => setAccessFor(null)} />
    <AccountSubpage visible={Boolean(draft) && state.ready} title="Настройки AI-бота" tokens={tokens} onClose={() => setDraft(null)}>
      <AdminStatus state={state} />
      {draft ? <>
        {(['title', ...(!draft.id ? ['slug'] : []), 'description', 'model', 'system_prompt'] as const).map(key => {
          const field = key as keyof api.AdminAiBot;
          const labels: Record<string, string> = { title: 'Название', slug: 'Идентификатор', description: 'Описание', model: 'Модель', system_prompt: 'Системная инструкция' };
          return <HubTextField key={key} label={labels[key]} value={String(draft[field] || '')} multiline={key === 'system_prompt' || key === 'description'} onChangeText={value => setDraft({ ...draft, [key]: value })} />;
        })}
        <HubTextField label="Температура (0–2)" value={String(draft.temperature ?? 0.2)} keyboardType="decimal-pad" onChangeText={value => setDraft({ ...draft, temperature: Number(value.replace(',', '.')) })} />
        <HubTextField label="Максимум токенов (256–16000)" value={String(draft.max_tokens ?? 2000)} keyboardType="number-pad" onChangeText={value => setDraft({ ...draft, max_tokens: Number(value) })} />
        {([['is_enabled', 'Бот включён'], ['allow_file_input', 'Принимать файлы'], ['allow_generated_artifacts', 'Создавать файлы'], ['allow_kb_document_delivery', 'Выдавать документы базы знаний']] as const).map(([key, label]) => <View key={key} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text style={{ color: tokens.textPrimary, flex: 1 }}>{label}</Text><Switch accessibilityLabel={label} value={Boolean(draft[key])} onValueChange={value => setDraft({ ...draft, [key]: value })} />
        </View>)}
        <AccountSectionCard tokens={tokens} title="Инструменты" description="Какие действия и данные доступны боту при ответах.">
          {AI_BOT_TOOL_GROUPS.map((group) => (
            <AiBotToolGroup
              key={group.key}
              tokens={tokens}
              title={group.title}
              options={group.options}
              enabled={Array.isArray(draft.enabled_tools) ? draft.enabled_tools : []}
              onToggle={(toolId, value) => setDraft({
                ...draft,
                enabled_tools: toggleAiBotTool(draft.enabled_tools || [], toolId, value),
              })}
            />
          ))}
        </AccountSectionCard>
        <AccountSectionCard tokens={tokens} title="Параметры инструментов" description="Ограничения вызова инструментов и доступных баз.">
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {([['single', 'Одна база'], ['multi', 'Несколько баз']] as const).map(([mode, label]) => (
              <Pressable
                key={mode}
                accessibilityRole="button"
                accessibilityLabel={label}
                accessibilityState={{ selected: (draft.tool_settings?.multi_db_mode || 'single') === mode }}
                onPress={() => setDraft({ ...draft, tool_settings: { ...draft.tool_settings, multi_db_mode: mode } })}
                style={{ flex: 1, minHeight: 40, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center',
                  borderColor: (draft.tool_settings?.multi_db_mode || 'single') === mode ? tokens.primary : tokens.borderSoft,
                  backgroundColor: (draft.tool_settings?.multi_db_mode || 'single') === mode ? tokens.accentSoft : 'transparent' }}
              >
                <Text style={{ color: (draft.tool_settings?.multi_db_mode || 'single') === mode ? tokens.primary : tokens.textSecondary, fontWeight: '700' }}>{label}</Text>
              </Pressable>
            ))}
          </View>
          {databases.length ? (
            <View style={{ marginTop: 10 }}>
              <Text style={{ color: tokens.textSecondary, fontSize: 12, marginBottom: 4 }}>Доступные базы для мульти-БД поиска</Text>
              {databases.map((database) => (
                <View key={database.id} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 40 }}>
                  <Text style={{ color: tokens.textPrimary, flex: 1 }}>{database.name}</Text>
                  <Switch
                    accessibilityLabel={`База ${database.name}`}
                    value={(draft.tool_settings?.allowed_databases || []).includes(database.id)}
                    onValueChange={(value) => {
                      const current = draft.tool_settings?.allowed_databases || [];
                      setDraft({
                        ...draft,
                        tool_settings: {
                          ...draft.tool_settings,
                          allowed_databases: value ? [...current, database.id] : current.filter((id) => id !== database.id),
                        },
                      });
                    }}
                  />
                </View>
              ))}
            </View>
          ) : null}
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            <View style={{ flex: 1 }}>
              <HubTextField label="Раундов инструментов (1–12)" keyboardType="number-pad" value={String(draft.tool_settings?.max_tool_rounds ?? 6)}
                onChangeText={(value) => setDraft({ ...draft, tool_settings: { ...draft.tool_settings, max_tool_rounds: Number(value) } })} />
            </View>
            <View style={{ flex: 1 }}>
              <HubTextField label="Вызовов за раунд (1–10)" keyboardType="number-pad" value={String(draft.tool_settings?.max_tool_calls_per_round ?? 3)}
                onChangeText={(value) => setDraft({ ...draft, tool_settings: { ...draft.tool_settings, max_tool_calls_per_round: Number(value) } })} />
            </View>
          </View>
          <View style={{ marginTop: 10 }}>
            <HubTextField label="KB scope (секции БЗ через запятую)" value={kbScopeText} onChangeText={setKbScopeText} autoCapitalize="none" />
          </View>
        </AccountSectionCard>
        <AccountPrimaryButton tokens={tokens} label="Сохранить бота" disabled={state.busy || !draft.title?.trim() || (!draft.id && (draft.slug?.length || 0) < 2) || !Number.isFinite(draft.temperature) || Number(draft.temperature) < 0 || Number(draft.temperature) > 2 || Number(draft.max_tokens) < 256 || Number(draft.max_tokens) > 16000} onPress={save} />
      </> : null}
    </AccountSubpage>
    <AccountSubpage visible={Boolean(runsFor) && state.ready} scroll={false} title="История запусков" tokens={tokens} onClose={() => setRunsFor(null)}>
      {runsError ? <Text accessibilityRole="alert" style={{ color: tokens.error }}>{runsError}</Text> : !runs ? <ActivityIndicator color={tokens.primary} /> : runs.items.length === 0 ? <Text style={{ color: tokens.textSecondary }}>Запусков пока нет</Text> : <FlatList data={runs.items} keyExtractor={run => run.id} initialNumToRender={12} maxToRenderPerBatch={10} windowSize={7} renderItem={({ item: run }) => <AccountSectionCard tokens={tokens} title={run.status} description={run.created_at}>{null}</AccountSectionCard>} />}
    </AccountSubpage>
  </AccountScreenScaffold>;
}

function AiBotToolGroup({ tokens, title, options, enabled, onToggle }: {
  tokens: ReturnType<typeof useAdminTheme>;
  title: string;
  options: Array<{ id: string; label: string }>;
  enabled: string[];
  onToggle: (toolId: string, value: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const count = aiBotToolsEnabledInGroup(enabled, options);
  return (
    <View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded }}
        onPress={() => setExpanded((value) => !value)}
        style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 }}
      >
        <Text style={{ flex: 1, color: tokens.textPrimary, fontWeight: '700' }}>{title}</Text>
        <Text style={{ color: count ? tokens.primary : tokens.textSecondary, fontWeight: '700', fontSize: 12 }}>
          {count}/{options.length}
        </Text>
        <MaterialCommunityIcons name={expanded ? 'chevron-up' : 'chevron-down'} size={20} color={tokens.iconMuted} />
      </Pressable>
      {expanded ? options.map((option) => (
        <View key={option.id} style={{ minHeight: 40, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingLeft: 8 }}>
          <Text style={{ color: tokens.textPrimary, flex: 1, marginRight: 8 }}>{option.label}</Text>
          <Switch
            accessibilityLabel={option.label}
            value={enabled.includes(option.id)}
            onValueChange={(value) => onToggle(option.id, value)}
          />
        </View>
      )) : null}
    </View>
  );
}

function AiBotAccessSubpage({ bot, tokens, ready, onClose }: {
  bot: api.AdminAiBot | null;
  tokens: ReturnType<typeof useAdminTheme>;
  ready: boolean;
  onClose: () => void;
}) {
  const botId = bot?.id || '';
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<api.AdminAiBotAccessUser[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [savingId, setSavingId] = useState(0);
  const [error, setError] = useState('');
  const generation = useRef(0);

  useEffect(() => {
    setItems([]);
    setQuery('');
    setOffset(0);
    setError('');
  }, [botId]);

  useEffect(() => {
    if (!botId || !ready) return undefined;
    const version = ++generation.current;
    setLoading(true);
    const timer = setTimeout(() => {
      void api.getAdminAiBotAccessUsers(botId, { q: query.trim(), offset, limit: 30 })
        .then((result) => {
          if (version !== generation.current) return;
          setItems((current) => offset === 0 ? result.items : [...current, ...result.items]);
          setHasMore(Boolean(result.has_more));
        })
        .catch(() => { if (version === generation.current) setError('Не удалось загрузить доступ.'); })
        .finally(() => { if (version === generation.current) setLoading(false); });
    }, query.trim() ? 250 : 0);
    return () => { clearTimeout(timer); };
  }, [botId, offset, query, ready]);

  const update = (item: api.AdminAiBotAccessUser, allowed: boolean) => {
    if (!botId || savingId || item.automatic) return;
    const version = generation.current;
    setSavingId(item.user_id);
    void api.setAdminAiBotAccess(botId, item.user_id, allowed)
      .then(() => {
        if (version === generation.current) {
          setItems((current) => current.map((row) => row.user_id === item.user_id ? { ...row, allowed } : row));
        }
      })
      .catch(() => { if (version === generation.current) setError('Не удалось изменить доступ.'); })
      .finally(() => { if (version === generation.current) setSavingId(0); });
  };

  return (
    <AccountSubpage visible={Boolean(bot) && ready} scroll={false} title={`Доступ: ${bot?.title || 'бот'}`} tokens={tokens} onClose={onClose}>
      <FlatList
        data={items}
        keyExtractor={(item) => String(item.user_id)}
        initialNumToRender={16}
        maxToRenderPerBatch={12}
        windowSize={7}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ gap: 10 }}
        ListHeaderComponent={(
          <View style={{ gap: 10 }}>
            <Text style={{ color: tokens.textSecondary, fontSize: 12, lineHeight: 16 }}>
              Администраторы доступны всем ботам. Ограничения доступа применяются сразу.
            </Text>
            <HubTextField
              label="Поиск сотрудников"
              value={query}
              onChangeText={(value) => { setQuery(value); setOffset(0); }}
            />
            {error ? <Text accessibilityRole="alert" style={{ color: tokens.error }}>{error}</Text> : null}
          </View>
        )}
        ListEmptyComponent={loading
          ? <ActivityIndicator color={tokens.primary} />
          : <Text style={{ color: tokens.textSecondary }}>Сотрудники не найдены.</Text>}
        ListFooterComponent={hasMore ? (
          <AccountSecondaryButton tokens={tokens} label="Показать ещё" onPress={() => setOffset((value) => value + 30)} disabled={loading} />
        ) : null}
        renderItem={({ item }) => (
          <View style={{ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text numberOfLines={1} style={{ color: tokens.textPrimary, fontWeight: '700' }}>
                {item.title || item.full_name || item.username || `Сотрудник #${item.user_id}`}
              </Text>
              <Text numberOfLines={1} style={{ color: tokens.textSecondary, fontSize: 12 }}>
                {[item.username ? `@${String(item.username).replace(/^@/, '')}` : '', item.automatic ? 'доступ автоматический' : ''].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <Switch
              accessibilityLabel={`Доступ ${item.title || item.full_name || item.username || item.user_id} к боту`}
              value={Boolean(item.allowed)}
              disabled={Boolean(item.automatic) || savingId === item.user_id}
              onValueChange={(value) => update(item, value)}
            />
          </View>
        )}
      />
    </AccountSubpage>
  );
}

export function NativeAdminSystemScreen() {
  const access = useAuth();
  return <SystemScreen key={`${access.user?.id}:${access.user?.role}:${access.offlineMode}`} />;
}
function SystemScreen() {
  const state = useNativeAdminData('system', api.getAdminAppSettings);
  const tokens = useAdminTheme();
  const [ips, setIps] = useState('');
  const [controller, setController] = useState<string | null>(null);
  const [envOpen, setEnvOpen] = useState(false);
  useEffect(() => { if (!state.ready) setEnvOpen(false); }, [state.ready]);
  useEffect(() => { setIps(state.data?.admin_login_allowed_ips.join('\n') || ''); setController(state.data?.transfer_act_reminder_controller_username || null); }, [state.data]);
  const save = () => Alert.alert('Системные настройки', 'Сохранить контролёра актов и список IP для административного входа?', [
    { text: 'Отмена', style: 'cancel' },
    { text: 'Сохранить', onPress: () => { void state.run(() => api.saveAdminAppSettings({ transfer_act_reminder_controller_username: controller, admin_login_allowed_ips: ips.split(/[\n,;]/).map(value => value.trim()).filter(Boolean) })); } },
  ]);
  return <AccountScreenScaffold title="Система" tokens={tokens} onBack={back}>
    <AdminStatus state={state} />
    {state.data && state.ready ? <>
      {state.data.warning ? <Text style={{ color: tokens.error }}>{state.data.warning}</Text> : null}
      <AccountSectionCard tokens={tokens} title="Контролёр актов" description="Получатель напоминаний о незагруженных актах.">
        <AccountActionRow tokens={tokens} icon={controller === null ? 'radiobox-marked' : 'radiobox-blank'} label="По умолчанию" onPress={() => setController(null)} />
        {state.data.available_controllers.map(item => <AccountActionRow key={item.username} tokens={tokens} icon={controller === item.username ? 'radiobox-marked' : 'radiobox-blank'} label={item.full_name || item.username} onPress={() => setController(item.username)} />)}
      </AccountSectionCard>
      <AccountSectionCard tokens={tokens} title="Административный вход" description="Разрешённые IP-адреса, по одному на строку. Ошибочный список может ограничить вход администраторов.">
        <HubTextField label="Разрешённые IP" value={ips} multiline onChangeText={setIps} autoCapitalize="none" />
      </AccountSectionCard>
      <AccountPrimaryButton tokens={tokens} label="Сохранить системные настройки" onPress={save} disabled={state.busy} />
      <AccountSecondaryButton tokens={tokens} label="Серверные переменные" onPress={() => setEnvOpen(true)} />
    </> : null}
    <AccountSubpage visible={envOpen && state.ready} title="Серверные переменные" tokens={tokens} onClose={() => setEnvOpen(false)}>
      {envOpen && state.ready ? <NativeAdminEnvEditor /> : null}
    </AccountSubpage>
  </AccountScreenScaffold>;
}
