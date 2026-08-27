import { useCallback, useEffect, useMemo, useState } from 'react';
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
  matchesUserSearch,
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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextUsers, nextDb] = await Promise.all([
        userAdminApi.listUsers(),
        listAvailableDatabases().catch(() => []),
      ]);
      setUsers(nextUsers);
      setDbOptions(nextDb);
    } catch (error) {
      setStatus({ error: formatApiError(error, 'Не удалось загрузить пользователей.'), message: '' });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) void load();
  }, [allowed, load]);

  const filtered = useMemo(() => users.filter((item) => {
    if (!matchesUserSearch(item as Record<string, unknown>, search)) return false;
    if (statusFilter === 'active' && item.is_active === false) return false;
    if (statusFilter === 'inactive' && item.is_active !== false) return false;
    if (roleFilter !== 'all' && item.role !== roleFilter) return false;
    return true;
  }), [roleFilter, search, statusFilter, users]);

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
    try {
      if (draft.id) {
        await userAdminApi.updateUser(draft.id, payload);
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
      await load();
    } catch (error) {
      setStatus({ error: formatApiError(error, 'Не удалось сохранить пользователя.'), message: '' });
    } finally {
      setSaving(false);
    }
  }, [delegateLinks, draft, load]);

  const openUser = useCallback(async (item: userAdminApi.AdminUser) => {
    setDraft(draftFromUser(item));
    setDelegateLinks([]);
    setDelegatesLoading(true);
    try {
      setDelegateLinks(await userAdminApi.getTaskDelegates(item.id));
    } catch (error) {
      setStatus({ error: formatApiError(error, 'Не удалось загрузить помощников и заместителей.'), message: '' });
    } finally {
      setDelegatesLoading(false);
    }
  }, []);

  const setDelegateRole = useCallback((delegate: userAdminApi.AdminUser, role: 'assistant' | 'deputy' | null) => {
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
                await load();
              } catch (error) {
                setStatus({ error: formatApiError(error, 'Не удалось изменить активность.'), message: '' });
              }
            })();
          },
        },
      ],
    );
  }, [load]);

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
        onBack={() => setDraft(null)}
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
        <AccountSectionCard tokens={tokens} title="Помощники и заместители" description="Получают уведомления по задачам и доступ на чтение карточек исполнителя.">
          {!draft.id ? (
            <Text style={{ color: tokens.textSecondary, fontSize: 12 }}>Сначала создайте пользователя.</Text>
          ) : delegatesLoading ? <AccountLoading tokens={tokens} /> : users
            .filter((candidate) => candidate.id !== draft.id && candidate.is_active !== false)
            .map((candidate) => {
              const selected = delegateLinks.find((item) => item.delegate_user_id === candidate.id)?.role_type || null;
              return (
                <View key={candidate.id} style={[styles.delegateRow, { borderBottomColor: tokens.borderSoft }]}> 
                  <View style={styles.delegateBody}>
                    <Text style={{ color: tokens.textPrimary, fontWeight: '800' }}>{candidate.full_name || candidate.username}</Text>
                    <Text style={{ color: tokens.textSecondary, fontSize: 11 }}>@{candidate.username}</Text>
                  </View>
                  <Choice tokens={tokens} selected={selected === 'assistant'} label="Помощник" onPress={() => setDelegateRole(candidate, selected === 'assistant' ? null : 'assistant')} />
                  <Choice tokens={tokens} selected={selected === 'deputy'} label="Зам" onPress={() => setDelegateRole(candidate, selected === 'deputy' ? null : 'deputy')} />
                </View>
              );
            })}
        </AccountSectionCard>
        <AccountSectionCard tokens={tokens} title="Роль и доступ">
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
            <Text style={{ color: tokens.textPrimary, fontWeight: '700', flex: 1 }}>Свои права</Text>
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
      onRefresh={() => { void load(); }}
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
      <AccountPrimaryButton tokens={tokens} label="Новый пользователь" onPress={() => { setDelegateLinks([]); setDraft(emptyDraft()); }} />
      {loading && users.length === 0 ? <AccountLoading tokens={tokens} /> : filtered.map((item) => (
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
    </AccountScreenScaffold>
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
    minHeight: 36,
    borderRadius: 10,
    borderWidth: 1,
    paddingHorizontal: 10,
    justifyContent: 'center',
    marginBottom: 6,
  },
  userRow: { borderWidth: 1, borderRadius: 14, padding: 12, marginTop: 8 },
  rowActions: { marginTop: 8 },
  switchRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
  groupHeader: { minHeight: 40, justifyContent: 'center' },
  delegateRow: { minHeight: 64, borderBottomWidth: 1, paddingVertical: 8, flexDirection: 'row', alignItems: 'center', gap: 6 },
  delegateBody: { flex: 1, minWidth: 0 },
});
