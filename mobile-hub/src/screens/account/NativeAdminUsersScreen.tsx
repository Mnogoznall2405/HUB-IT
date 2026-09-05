import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { ROLE_OPTIONS, SETTINGS_PERMISSION_GROUPS } from '../../account/accountConstants';
import {
  getDbName,
  normalizePermissions,
  roleLabel,
  summarizePermissions,
  type DatabaseOption,
} from '../../account/accountFormat';
import { canAccessAdminSection } from '../../account/accountNavigation';
import * as userAdminApi from '../../api/authUserAdminApi';
import { listAvailableDatabases } from '../../api/databaseApi';
import { formatApiError } from '../../api/formatError';
import { useAuth } from '../../auth/AuthContext';
import { HubTextField } from '../../components/ui/HubTextField';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens } from '../../theme/fluentTokens';
import {
  AccountLoading,
  AccountPrimaryButton,
  AccountScreenScaffold,
  AccountSecondaryButton,
  AccountSectionCard,
  AccountStatusText,
} from './AccountChrome';
import { goBackOrReplace } from './accountBack';

type UserDraft = {
  id: number | null;
  username: string;
  password: string;
  full_name: string;
  department: string;
  job_title: string;
  email: string;
  mailbox_email: string;
  mailbox_login: string;
  telegram_id: string;
  auth_source: string;
  assigned_database: string;
  role: string;
  is_active: boolean;
  use_custom_permissions: boolean;
  custom_permissions: string[];
};

const USERS_PAGE_SIZE = 50;
const USER_SEARCH_DEBOUNCE_MS = 250;

function mergeUsers(current: userAdminApi.AdminUser[], next: userAdminApi.AdminUser[]) {
  const merged = new Map(current.map((item) => [item.id, item]));
  next.forEach((item) => merged.set(item.id, item));
  return Array.from(merged.values());
}

function emptyDraft(): UserDraft {
  return {
    id: null,
    username: '',
    password: '',
    full_name: '',
    department: '',
    job_title: '',
    email: '',
    mailbox_email: '',
    mailbox_login: '',
    telegram_id: '',
    auth_source: 'local',
    assigned_database: '',
    role: 'viewer',
    is_active: true,
    use_custom_permissions: false,
    custom_permissions: [],
  };
}

function draftFromUser(item: userAdminApi.AdminUser): UserDraft {
  return {
    id: item.id,
    username: item.username || '',
    password: '',
    full_name: item.full_name || '',
    department: item.department || '',
    job_title: item.job_title || '',
    email: item.email || '',
    mailbox_email: item.mailbox_email || '',
    mailbox_login: item.mailbox_login || '',
    telegram_id: item.telegram_id == null ? '' : String(item.telegram_id),
    auth_source: item.auth_source || 'local',
    assigned_database: item.assigned_database || '',
    role: item.role || 'viewer',
    is_active: item.is_active !== false,
    use_custom_permissions: Boolean(item.use_custom_permissions),
    custom_permissions: normalizePermissions(item.custom_permissions),
  };
}

export function NativeAdminUsersScreen() {
  const { user, hasPermission } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const allowed = canAccessAdminSection('users', { user, hasPermission });
  const [users, setUsers] = useState<userAdminApi.AdminUser[]>([]);
  const [usersTotal, setUsersTotal] = useState(0);
  const [usersHasMore, setUsersHasMore] = useState(false);
  const [dbOptions, setDbOptions] = useState<DatabaseOption[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [roleFilter, setRoleFilter] = useState('all');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<UserDraft | null>(null);
  const [expandedGroup, setExpandedGroup] = useState('');
  const [status, setStatus] = useState({ error: '', message: '' });
  const [delegateLinks, setDelegateLinks] = useState<userAdminApi.TaskDelegateLink[]>([]);
  const [delegatesLoading, setDelegatesLoading] = useState(false);
  const [delegateSearch, setDelegateSearch] = useState('');
  const [delegateCandidates, setDelegateCandidates] = useState<userAdminApi.AdminUser[]>([]);
  const [delegateSearchResults, setDelegateSearchResults] = useState<userAdminApi.AdminUser[]>([]);
  const [delegateSearching, setDelegateSearching] = useState(false);
  const usersRequestRef = useRef(0);
  const delegatesRequestRef = useRef(0);

  const loadUsers = useCallback(async (offset = 0) => {
    const requestId = usersRequestRef.current + 1;
    usersRequestRef.current = requestId;
    setLoading(true);
    try {
      const result = await userAdminApi.searchUsers({
        q: search,
        limit: USERS_PAGE_SIZE,
        offset,
        status: statusFilter,
        role: roleFilter as 'all' | 'admin' | 'operator' | 'viewer',
      });
      if (requestId !== usersRequestRef.current) return;
      setUsers((current) => offset > 0 ? mergeUsers(current, result.items) : result.items);
      setUsersTotal(result.total);
      setUsersHasMore(result.has_more);
    } catch (error) {
      if (requestId !== usersRequestRef.current) return;
      setStatus({ error: formatApiError(error, 'Не удалось загрузить пользователей.'), message: '' });
    } finally {
      if (requestId === usersRequestRef.current) setLoading(false);
    }
  }, [roleFilter, search, statusFilter]);

  useEffect(() => {
    if (!allowed) return undefined;
    usersRequestRef.current += 1;
    const timeoutId = setTimeout(() => { void loadUsers(0); }, USER_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeoutId);
  }, [allowed, loadUsers]);

  useEffect(() => {
    if (!allowed) return undefined;
    let active = true;
    void listAvailableDatabases()
      .then((items) => { if (active) setDbOptions(items); })
      .catch(() => { if (active) setDbOptions([]); });
    return () => { active = false; };
  }, [allowed]);

  useEffect(() => {
    const query = delegateSearch.trim();
    if (!draft?.id || query.length < 2) {
      delegatesRequestRef.current += 1;
      setDelegateSearchResults([]);
      setDelegateSearching(false);
      return undefined;
    }
    delegatesRequestRef.current += 1;
    const timeoutId = setTimeout(() => {
      const requestId = delegatesRequestRef.current + 1;
      delegatesRequestRef.current = requestId;
      setDelegateSearching(true);
      void userAdminApi.searchUsers({
        q: query,
        limit: 30,
        offset: 0,
        status: 'active',
        role: 'all',
        excludeUserId: draft.id || undefined,
      }).then((result) => {
        if (requestId === delegatesRequestRef.current) setDelegateSearchResults(result.items);
      }).catch((error) => {
        if (requestId === delegatesRequestRef.current) {
          setDelegateSearchResults([]);
          setStatus({ error: formatApiError(error, 'Не удалось выполнить поиск сотрудника.'), message: '' });
        }
      }).finally(() => {
        if (requestId === delegatesRequestRef.current) setDelegateSearching(false);
      });
    }, USER_SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timeoutId);
  }, [delegateSearch, draft?.id]);

  const selectedDelegateCandidates = useMemo(() => delegateLinks.map((link) => ({
    link,
    candidate: delegateCandidates.find((candidate) => candidate.id === link.delegate_user_id) || null,
  })), [delegateCandidates, delegateLinks]);

  const visibleDelegateSearchResults = useMemo(() => {
    const selectedIds = new Set(delegateLinks.map((link) => link.delegate_user_id));
    return delegateSearchResults.filter((candidate) => !selectedIds.has(candidate.id));
  }, [delegateLinks, delegateSearchResults]);

  const saveDraft = useCallback(async () => {
    if (!draft) return;
    const username = draft.username.trim();
    if (username.length < 3) {
      setStatus({ error: 'Логин должен быть не короче 3 символов.', message: '' });
      return;
    }
    if (!draft.id && draft.auth_source === 'local' && draft.password.length < 6) {
      setStatus({ error: 'Для локальной учётки нужен пароль не короче 6 символов.', message: '' });
      return;
    }
    const telegram = draft.telegram_id.trim();
    if (telegram && !Number.isInteger(Number(telegram))) {
      setStatus({ error: 'Telegram ID должен быть числом.', message: '' });
      return;
    }
    const payload: userAdminApi.AdminUserWritePayload = {
      full_name: draft.full_name.trim(),
      department: draft.department.trim(),
      job_title: draft.job_title.trim(),
      email: draft.email.trim(),
      mailbox_email: draft.mailbox_email.trim(),
      mailbox_login: draft.mailbox_login.trim(),
      telegram_id: telegram ? Number(telegram) : null,
      auth_source: draft.auth_source,
      assigned_database: draft.assigned_database || null,
      role: draft.role,
      is_active: draft.is_active,
      use_custom_permissions: draft.use_custom_permissions,
      custom_permissions: normalizePermissions(draft.custom_permissions),
    };
    if (draft.password) payload.password = draft.password;
    setSaving(true);
    let profileSaved = false;
    try {
      if (draft.id) {
        await userAdminApi.updateUser(draft.id, payload);
        profileSaved = true;
        await userAdminApi.updateTaskDelegates(draft.id, delegateLinks.map((item) => ({
          delegate_user_id: item.delegate_user_id,
          role_type: item.role_type,
          is_active: item.is_active !== false,
        })));
        setStatus({ error: '', message: 'Пользователь сохранён.' });
      } else {
        await userAdminApi.createUser({ ...payload, username });
        setStatus({ error: '', message: 'Пользователь создан.' });
      }
      setDraft(null);
      await loadUsers(0);
    } catch (error) {
      const formattedError = formatApiError(
        error,
        profileSaved
          ? 'Назначения помощников и заместителей обновить не удалось.'
          : 'Не удалось сохранить пользователя.',
      );
      setStatus({
        error: profileSaved
          ? `Профиль сохранён, но назначения помощников и заместителей обновить не удалось. ${formattedError}`
          : formattedError,
        message: '',
      });
    } finally {
      setSaving(false);
    }
  }, [delegateLinks, draft, loadUsers]);

  const openUser = useCallback(async (item: userAdminApi.AdminUser) => {
    setDraft(draftFromUser(item));
    setDelegateLinks([]);
    setDelegateSearch('');
    setDelegateCandidates([]);
    setDelegateSearchResults([]);
    setDelegatesLoading(true);
    try {
      const links = await userAdminApi.getTaskDelegates(item.id);
      setDelegateLinks(links);
      const delegateIds = links.map((link) => link.delegate_user_id);
      if (delegateIds.length > 0) {
        const result = await userAdminApi.searchUsers({
          ids: delegateIds,
          limit: Math.min(200, delegateIds.length),
          offset: 0,
          status: 'all',
          role: 'all',
        });
        setDelegateCandidates(result.items);
      }
    } catch (error) {
      setStatus({ error: formatApiError(error, 'Не удалось загрузить помощников и заместителей.'), message: '' });
    } finally {
      setDelegatesLoading(false);
    }
  }, []);

  const setDelegateRole = useCallback((delegate: userAdminApi.AdminUser, role: 'assistant' | 'deputy' | null) => {
    if (role) {
      setDelegateCandidates((current) => current.some((item) => item.id === delegate.id)
        ? current
        : [...current, delegate]);
    }
    setDelegateLinks((current) => {
      const without = current.filter((item) => item.delegate_user_id !== delegate.id);
      if (!role) return without;
      return [...without, {
        owner_user_id: draft?.id || 0,
        delegate_user_id: delegate.id,
        role_type: role,
        is_active: true,
        delegate_username: delegate.username,
        delegate_full_name: delegate.full_name,
      }];
    });
  }, [draft?.id]);

  const setActive = useCallback((item: userAdminApi.AdminUser, isActive: boolean) => {
    Alert.alert(
      isActive ? 'Включить пользователя?' : 'Отключить пользователя?',
      item.full_name || item.username,
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: isActive ? 'Включить' : 'Отключить',
          style: isActive ? 'default' : 'destructive',
          onPress: () => {
            void (async () => {
              try {
                await userAdminApi.updateUser(item.id, { is_active: isActive });
                setStatus({ error: '', message: isActive ? 'Пользователь включён.' : 'Пользователь отключён.' });
                await loadUsers(0);
              } catch (error) {
                setStatus({ error: formatApiError(error, 'Не удалось изменить активность.'), message: '' });
              }
            })();
          },
        },
      ],
    );
  }, [loadUsers]);

  if (!allowed) {
    return (
      <AccountScreenScaffold title="Пользователи" tokens={tokens} onBack={() => goBackOrReplace('/(shell)/menu/admin')}>
        <AccountSectionCard tokens={tokens} title="Нет доступа" description="Нужно право settings.users.manage.">
          {null}
        </AccountSectionCard>
      </AccountScreenScaffold>
    );
  }

  if (draft) {
    return (
      <AccountScreenScaffold
        title={draft.id ? 'Пользователь' : 'Новый пользователь'}
        tokens={tokens}
        onBack={() => {
          setDelegateSearch('');
          setDelegateCandidates([]);
          setDelegateSearchResults([]);
          setDraft(null);
        }}
      >
        <AccountStatusText tokens={tokens} error={status.error} message={status.message} />
        <AccountSectionCard tokens={tokens} title="Профиль">
          <HubTextField
            label="Логин"
            autoCapitalize="none"
            editable={!draft.id}
            value={draft.username}
            onChangeText={(value) => setDraft({ ...draft, username: value })}
          />
          {draft.id ? (
            <Text style={{ color: tokens.textSecondary, fontSize: 12, marginTop: 6 }}>
              Логин существующей учётной записи изменить нельзя.
            </Text>
          ) : null}
          <View style={styles.gap} />
          <HubTextField label={draft.id ? 'Новый пароль (необязательно)' : 'Пароль'} secureTextEntry autoCapitalize="none" value={draft.password} onChangeText={(value) => setDraft({ ...draft, password: value })} />
          <View style={styles.gap} />
          <HubTextField label="ФИО" value={draft.full_name} onChangeText={(value) => setDraft({ ...draft, full_name: value })} />
          <View style={styles.gap} />
          <HubTextField label="Должность" value={draft.job_title} onChangeText={(value) => setDraft({ ...draft, job_title: value })} />
          <View style={styles.gap} />
          <HubTextField label="Отдел" value={draft.department} onChangeText={(value) => setDraft({ ...draft, department: value })} />
          <View style={styles.gap} />
          <HubTextField label="Email" autoCapitalize="none" keyboardType="email-address" value={draft.email} onChangeText={(value) => setDraft({ ...draft, email: value })} />
          <View style={styles.gap} />
          <HubTextField label="Почта Exchange" autoCapitalize="none" keyboardType="email-address" value={draft.mailbox_email} onChangeText={(value) => setDraft({ ...draft, mailbox_email: value })} />
          <View style={styles.gap} />
          <HubTextField label="Логин Exchange" autoCapitalize="none" value={draft.mailbox_login} onChangeText={(value) => setDraft({ ...draft, mailbox_login: value })} />
          <View style={styles.gap} />
          <HubTextField label="Telegram ID" keyboardType="number-pad" value={draft.telegram_id} onChangeText={(value) => setDraft({ ...draft, telegram_id: value })} />
        </AccountSectionCard>
        <AccountSectionCard
          tokens={tokens}
          title="Роль и права доступа"
          description="Сначала задайте роль и персональный набор Web permission, затем настройте делегирование задач."
        >
          <Text style={[styles.accessSummary, { color: tokens.textSecondary, backgroundColor: tokens.actionBg }]}>
            {draft.use_custom_permissions
              ? `Персональный набор · ${normalizePermissions(draft.custom_permissions).length} прав`
              : `Права роли · ${roleLabel(draft.role)}`}
          </Text>
          {ROLE_OPTIONS.map((option) => (
            <Choice
              key={option.value}
              tokens={tokens}
              selected={draft.role === option.value}
              label={option.label}
              onPress={() => setDraft({ ...draft, role: option.value })}
            />
          ))}
          <Choice tokens={tokens} selected={draft.auth_source === 'local'} label="Локальный вход" onPress={() => setDraft({ ...draft, auth_source: 'local' })} />
          <Choice tokens={tokens} selected={draft.auth_source === 'ldap'} label="AD / LDAP" onPress={() => setDraft({ ...draft, auth_source: 'ldap' })} />
          <Choice tokens={tokens} selected={!draft.assigned_database} label="БД не ограничивать" onPress={() => setDraft({ ...draft, assigned_database: '' })} />
          {dbOptions.map((item) => (
            <Choice
              key={item.id}
              tokens={tokens}
              selected={draft.assigned_database === item.id}
              label={item.name}
              onPress={() => setDraft({ ...draft, assigned_database: item.id })}
            />
          ))}
          <View style={styles.switchRow}>
            <Text style={{ color: tokens.textPrimary, fontWeight: '700', flex: 1 }}>Активен</Text>
            <Switch value={draft.is_active} onValueChange={(value) => setDraft({ ...draft, is_active: value })} />
          </View>
          <View style={styles.switchRow}>
            <View style={styles.switchCopy}>
              <Text style={{ color: tokens.textPrimary, fontWeight: '700' }}>Персональный набор прав</Text>
              <Text style={{ color: tokens.textSecondary, fontSize: 11 }}>Заменяет стандартный набор выбранной роли.</Text>
            </View>
            <Switch value={draft.use_custom_permissions} onValueChange={(value) => setDraft({ ...draft, use_custom_permissions: value })} />
          </View>
          {draft.use_custom_permissions ? SETTINGS_PERMISSION_GROUPS.map((group) => (
            <View key={group.group}>
              <Pressable onPress={() => setExpandedGroup((current) => current === group.group ? '' : group.group)} style={styles.groupHeader}>
                <Text style={{ color: tokens.textPrimary, fontWeight: '800' }}>{group.group}</Text>
              </Pressable>
              {expandedGroup === group.group ? group.permissions.map((permission) => {
                const checked = permission.alwaysGranted || draft.custom_permissions.includes(permission.value);
                return (
                  <View key={permission.value} style={styles.switchRow}>
                    <Text style={{ color: tokens.textPrimary, flex: 1, fontSize: 13 }}>{permission.label}</Text>
                    <Switch
                      value={checked}
                      disabled={permission.alwaysGranted}
                      onValueChange={(value) => {
                        const current = normalizePermissions(draft.custom_permissions);
                        setDraft({
                          ...draft,
                          custom_permissions: value
                            ? [...current, permission.value]
                            : current.filter((item) => item !== permission.value),
                        });
                      }}
                    />
                  </View>
                );
              }) : null}
            </View>
          )) : null}
        </AccountSectionCard>
        <AccountSectionCard tokens={tokens} title="Помощники и заместители" description="Получают уведомления по задачам и доступ на чтение карточек исполнителя.">
          {!draft.id ? (
            <Text style={{ color: tokens.textSecondary, fontSize: 12 }}>Сначала создайте пользователя.</Text>
          ) : delegatesLoading ? <AccountLoading tokens={tokens} /> : (
            <>
              {selectedDelegateCandidates.length > 0 ? (
                <Text style={[styles.delegateSectionLabel, { color: tokens.textSecondary }]}>Назначены</Text>
              ) : (
                <Text style={[styles.delegateHint, { color: tokens.textSecondary }]}>Назначенных сотрудников пока нет.</Text>
              )}
              {selectedDelegateCandidates.map(({ link, candidate }) => candidate ? (
                <DelegateAssignmentRow
                  key={candidate.id}
                  candidate={candidate}
                  selected={link.role_type}
                  tokens={tokens}
                  onRoleChange={(role) => setDelegateRole(candidate, role)}
                />
              ) : (
                <View key={link.delegate_user_id} style={[styles.delegateRow, { borderBottomColor: tokens.borderSoft }]}>
                  <View style={styles.delegateBody}>
                    <Text style={{ color: tokens.textPrimary, fontWeight: '800' }}>
                      {link.delegate_full_name || link.delegate_username || `ID ${link.delegate_user_id}`}
                    </Text>
                    <Text style={{ color: tokens.textSecondary, fontSize: 11 }}>Сотрудник недоступен в текущем списке</Text>
                  </View>
                  <View style={styles.delegateRoles}>
                    <Choice
                      tokens={tokens}
                      selected={false}
                      label="Снять"
                      onPress={() => setDelegateLinks((current) => current.filter((item) => item.delegate_user_id !== link.delegate_user_id))}
                    />
                  </View>
                </View>
              ))}
              <View style={styles.delegateSearch}>
                <HubTextField
                  testID="native-admin-delegate-search"
                  label="Найти сотрудника"
                  value={delegateSearch}
                  onChangeText={setDelegateSearch}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
              </View>
              {delegateSearch.trim().length < 2 ? (
                <Text style={[styles.delegateHint, { color: tokens.textSecondary }]}>Введите не менее двух букв ФИО, отдела, должности или логина.</Text>
              ) : delegateSearching ? (
                <AccountLoading tokens={tokens} />
              ) : visibleDelegateSearchResults.length === 0 ? (
                <Text style={[styles.delegateHint, { color: tokens.textSecondary }]}>Подходящих сотрудников не найдено.</Text>
              ) : visibleDelegateSearchResults.map((candidate) => (
                <DelegateAssignmentRow
                  key={candidate.id}
                  candidate={candidate}
                  selected={null}
                  tokens={tokens}
                  onRoleChange={(role) => setDelegateRole(candidate, role)}
                />
              ))}
            </>
          )}
        </AccountSectionCard>
        <AccountPrimaryButton
          tokens={tokens}
          disabled={saving}
          label={saving ? 'Сохранение…' : 'Сохранить'}
          onPress={() => { void saveDraft(); }}
        />
      </AccountScreenScaffold>
    );
  }

  return (
    <AccountScreenScaffold
      title="Пользователи"
      tokens={tokens}
      onBack={() => goBackOrReplace('/(shell)/menu/admin')}
      onRefresh={() => { void loadUsers(0); }}
      refreshing={loading}
    >
      <AccountStatusText tokens={tokens} error={status.error} message={status.message} />
      <HubTextField label="Поиск" value={search} onChangeText={setSearch} />
      <View style={styles.filters}>
        {(['all', 'active', 'inactive'] as const).map((value) => (
          <Choice
            key={value}
            tokens={tokens}
            selected={statusFilter === value}
            label={value === 'all' ? 'Все' : value === 'active' ? 'Активны' : 'Отключены'}
            onPress={() => setStatusFilter(value)}
          />
        ))}
        <Choice tokens={tokens} selected={roleFilter === 'all'} label="Все роли" onPress={() => setRoleFilter('all')} />
        {ROLE_OPTIONS.map((option) => (
          <Choice
            key={option.value}
            tokens={tokens}
            selected={roleFilter === option.value}
            label={option.label}
            onPress={() => setRoleFilter(option.value)}
          />
        ))}
      </View>
      <AccountPrimaryButton tokens={tokens} label="Новый пользователь" onPress={() => {
        setDelegateLinks([]);
        setDelegateSearch('');
        setDelegateCandidates([]);
        setDelegateSearchResults([]);
        setDraft(emptyDraft());
      }} />
      <Text style={[styles.resultMeta, { color: tokens.textSecondary }]}>Показано: {users.length} из {usersTotal}</Text>
      {loading && users.length === 0 ? <AccountLoading tokens={tokens} /> : users.map((item) => (
        <Pressable
          key={item.id}
          onPress={() => { void openUser(item); }}
          style={[styles.userRow, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}
        >
          <Text style={{ color: tokens.textPrimary, fontWeight: '800' }}>{item.full_name || item.username}</Text>
          <Text style={{ color: tokens.textSecondary, fontSize: 12 }}>
            @{item.username} · {roleLabel(item.role)} · {summarizePermissions(item)}
          </Text>
          <Text style={{ color: tokens.textSecondary, fontSize: 12 }}>
            {item.is_active === false ? 'Отключён' : 'Активен'} · {getDbName(dbOptions, item.assigned_database)}
          </Text>
          <View style={styles.rowActions}>
            {item.is_active === false ? (
              <AccountSecondaryButton tokens={tokens} label="Включить" onPress={() => setActive(item, true)} />
            ) : (
              <AccountSecondaryButton
                tokens={tokens}
                danger
                label="Отключить"
                onPress={() => setActive(item, false)}
              />
            )}
          </View>
        </Pressable>
      ))}
      {!loading && users.length === 0 ? (
        <Text style={[styles.delegateHint, { color: tokens.textSecondary }]}>Пользователи не найдены.</Text>
      ) : null}
      {usersHasMore ? (
        <AccountSecondaryButton
          tokens={tokens}
          label={loading ? 'Загрузка…' : 'Показать ещё'}
          disabled={loading}
          onPress={() => { void loadUsers(users.length); }}
        />
      ) : null}
    </AccountScreenScaffold>
  );
}

function DelegateAssignmentRow({
  candidate,
  selected,
  tokens,
  onRoleChange,
}: {
  candidate: userAdminApi.AdminUser;
  selected: 'assistant' | 'deputy' | null;
  tokens: ReturnType<typeof useFluentTokens>;
  onRoleChange: (role: 'assistant' | 'deputy' | null) => void;
}) {
  const metadata = [candidate.job_title, candidate.department, candidate.username ? `@${candidate.username}` : '']
    .filter(Boolean)
    .join(' · ');
  return (
    <View style={[styles.delegateRow, { borderBottomColor: tokens.borderSoft }]}>
      <View style={styles.delegateBody}>
        <Text style={{ color: tokens.textPrimary, fontWeight: '800' }}>{candidate.full_name || candidate.username}</Text>
        {metadata ? <Text style={{ color: tokens.textSecondary, fontSize: 11 }}>{metadata}</Text> : null}
      </View>
      <View style={styles.delegateRoles}>
        <Choice tokens={tokens} selected={selected === 'assistant'} label="Помощник" onPress={() => onRoleChange('assistant')} />
        <Choice tokens={tokens} selected={selected === 'deputy'} label="Заместитель" onPress={() => onRoleChange('deputy')} />
        {selected ? <Choice tokens={tokens} selected={false} label="Снять" onPress={() => onRoleChange(null)} /> : null}
      </View>
    </View>
  );
}

function Choice({
  tokens,
  selected,
  label,
  onPress,
}: {
  tokens: ReturnType<typeof useFluentTokens>;
  selected: boolean;
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[
        styles.choice,
        {
          borderColor: selected ? tokens.selectedBorder : tokens.borderSoft,
          backgroundColor: selected ? tokens.selected : tokens.actionBg,
        },
      ]}
    >
      <Text style={{ color: tokens.textPrimary, fontWeight: '700', fontSize: 13 }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  gap: { height: 10 },
  filters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginVertical: 8 },
  choice: {
    minHeight: 44,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    justifyContent: 'center',
    marginBottom: 6,
  },
  userRow: { borderWidth: 1, borderRadius: 14, padding: 12, marginTop: 8 },
  rowActions: { marginTop: 8 },
  switchRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
  switchCopy: { flex: 1, minWidth: 0, gap: 2 },
  groupHeader: { minHeight: 40, justifyContent: 'center' },
  delegateRow: { minHeight: 64, borderBottomWidth: 1, paddingVertical: 10, gap: 8 },
  delegateBody: { flex: 1, minWidth: 0 },
  delegateRoles: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  delegateSearch: { marginTop: 12 },
  delegateSectionLabel: { marginTop: 2, marginBottom: 4, fontSize: 12, fontWeight: '800', textTransform: 'uppercase' },
  delegateHint: { fontSize: 12, lineHeight: 17, marginVertical: 6 },
  accessSummary: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, marginBottom: 10, fontSize: 12, fontWeight: '700' },
  resultMeta: { marginTop: 10, fontSize: 12 },
});
