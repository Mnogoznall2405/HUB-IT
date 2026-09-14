import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Switch, Text, View } from 'react-native';
import * as api from '../../api/adminSettingsApi';
import { useAuth } from '../../auth/AuthContext';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens } from '../../theme/fluentTokens';
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

export function NativeAdminAdUsersScreen() {
  const access = useAuth();
  return <AdUsersScreen key={`${access.user?.id}:${access.user?.role}:${access.offlineMode}`} />;
}
function AdUsersScreen() {
  const state = useNativeAdminData('ad-users', api.getAdCandidates);
  const tokens = useAdminTheme();
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
  return <AccountScreenScaffold title="Пользователи AD" tokens={tokens} onBack={back} scroll={false}>
    <FlatList
      initialNumToRender={12}
      maxToRenderPerBatch={10}
      windowSize={7}
      data={rows} keyExtractor={item => item.login} contentContainerStyle={{ gap: 12 }}
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

const emptyBot: Partial<api.AdminAiBot> = { title: '', slug: '', description: '', model: '', system_prompt: '', temperature: 0.2, max_tokens: 2000, is_enabled: true, allow_file_input: true, allow_generated_artifacts: true, allow_kb_document_delivery: false };
export function NativeAdminAiBotsScreen() {
  const access = useAuth();
  return <AiBotsScreen key={`${access.user?.id}:${access.user?.role}:${access.offlineMode}:${access.hasPermission('settings.ai.manage')}`} />;
}
function AiBotsScreen() {
  const state = useNativeAdminData('ai-bots', api.getAdminAiBots);
  const tokens = useAdminTheme();
  const [draft, setDraft] = useState<Partial<api.AdminAiBot> | null>(null);
  const [runsFor, setRunsFor] = useState<string | null>(null);
  const [runs, setRuns] = useState<Awaited<ReturnType<typeof api.getAdminAiBotRuns>> | null>(null);
  const [runsError, setRunsError] = useState('');
  useEffect(() => { if (!state.ready) { setDraft(null); setRunsFor(null); setRuns(null); } }, [state.ready]);
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
    // Send edited fields only; preserve tools, access scope and other server configuration.
    const fields = { title: draft.title, description: draft.description, model: draft.model, system_prompt: draft.system_prompt,
      temperature: draft.temperature, max_tokens: draft.max_tokens, is_enabled: draft.is_enabled,
      allow_file_input: draft.allow_file_input, allow_generated_artifacts: draft.allow_generated_artifacts,
      allow_kb_document_delivery: draft.allow_kb_document_delivery, ...(!draft.id ? { slug: draft.slug } : {}) };
    void state.run(() => api.saveAdminAiBot(draft.id || null, fields)).then(saved => { if (saved) setDraft(null); });
  };
  return <AccountScreenScaffold title="AI-боты" tokens={tokens} onBack={back} scroll={false}>
    <FlatList data={state.data || []} keyExtractor={bot => bot.id} initialNumToRender={12} maxToRenderPerBatch={10} windowSize={7}
      ListHeaderComponent={<View style={{ gap: 12 }}>
    <AdminStatus state={state} />
    {state.ready ? <AccountPrimaryButton tokens={tokens} label="Создать бота" onPress={() => setDraft({ ...emptyBot })} disabled={state.busy} /> : null}
      </View>} renderItem={({ item: bot }) => (<AccountSectionCard key={bot.id} tokens={tokens} title={bot.title} description={`${bot.model || 'Модель по умолчанию'} · ${bot.is_enabled ? 'Включён' : 'Выключен'}`}>
      <AccountSecondaryButton tokens={tokens} label={`Настроить ${bot.title}`} onPress={() => setDraft({ ...bot })} disabled={!state.ready || state.busy} />
      <AccountSecondaryButton tokens={tokens} label={`Запуски ${bot.title}`} onPress={() => setRunsFor(bot.id)} />
    </AccountSectionCard>)} />
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
        <AccountPrimaryButton tokens={tokens} label="Сохранить бота" disabled={state.busy || !draft.title?.trim() || (!draft.id && (draft.slug?.length || 0) < 2) || !Number.isFinite(draft.temperature) || Number(draft.temperature) < 0 || Number(draft.temperature) > 2 || Number(draft.max_tokens) < 256 || Number(draft.max_tokens) > 16000} onPress={save} />
      </> : null}
    </AccountSubpage>
    <AccountSubpage visible={Boolean(runsFor) && state.ready} scroll={false} title="История запусков" tokens={tokens} onClose={() => setRunsFor(null)}>
      {runsError ? <Text accessibilityRole="alert" style={{ color: tokens.error }}>{runsError}</Text> : !runs ? <ActivityIndicator color={tokens.primary} /> : runs.items.length === 0 ? <Text style={{ color: tokens.textSecondary }}>Запусков пока нет</Text> : <FlatList data={runs.items} keyExtractor={run => run.id} initialNumToRender={12} maxToRenderPerBatch={10} windowSize={7} renderItem={({ item: run }) => <AccountSectionCard tokens={tokens} title={run.status} description={run.created_at}>{null}</AccountSectionCard>} />}
    </AccountSubpage>
  </AccountScreenScaffold>;
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
