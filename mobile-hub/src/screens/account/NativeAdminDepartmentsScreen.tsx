import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { canAccessAdminSection } from '../../account/accountNavigation';
import * as departmentsApi from '../../api/departmentsApi';
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

export function NativeAdminDepartmentsScreen() {
  const { user, hasPermission } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const allowed = canAccessAdminSection('departments', { user, hasPermission });
  const [departments, setDepartments] = useState<departmentsApi.DepartmentRecord[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [memberships, setMemberships] = useState<departmentsApi.DepartmentMember[]>([]);
  const [draftManagerIds, setDraftManagerIds] = useState<number[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [membersLoading, setMembersLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState<'users' | 'ad' | ''>('');
  const [status, setStatus] = useState({ error: '', message: '' });

  const loadDepartments = useCallback(async () => {
    setLoading(true);
    try {
      const items = await departmentsApi.listDepartments();
      setDepartments(items);
    } catch (error) {
      setStatus({ error: formatApiError(error, 'Не удалось загрузить отделы.'), message: '' });
    } finally {
      setLoading(false);
    }
  }, []);

  const filteredDepartments = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ru');
    if (!query) return departments;
    return departments.filter((item) => String(item.name || '').toLocaleLowerCase('ru').includes(query));
  }, [departments, search]);

  useEffect(() => {
    setSelectedId((current) => (
      filteredDepartments.some((item) => String(item.id) === String(current))
        ? current
        : String(filteredDepartments[0]?.id || '')
    ));
  }, [filteredDepartments]);

  const loadMembers = useCallback(async (departmentId: string) => {
    if (!departmentId) {
      setMemberships([]);
      setDraftManagerIds([]);
      return;
    }
    setMembersLoading(true);
    try {
      const items = await departmentsApi.getDepartmentMembers(departmentId);
      setMemberships(items);
      setDraftManagerIds(items
        .filter((item) => String(item.role || '') === 'manager' && item.is_active !== false)
        .map((item) => Number(item.user_id))
        .filter((item) => Number.isInteger(item) && item > 0));
    } catch (error) {
      setStatus({ error: formatApiError(error, 'Не удалось загрузить состав отдела.'), message: '' });
    } finally {
      setMembersLoading(false);
    }
  }, []);

  useEffect(() => {
    if (allowed) void loadDepartments();
  }, [allowed, loadDepartments]);

  useEffect(() => {
    if (allowed) void loadMembers(selectedId);
  }, [allowed, loadMembers, selectedId]);

  const members = useMemo(() => {
    const byId = new Map<number, { user_id: number; user: departmentsApi.DepartmentMember['user']; roles: string[] }>();
    memberships.forEach((membership) => {
      const userId = Number(membership.user_id || 0);
      if (!Number.isInteger(userId) || userId <= 0) return;
      const current = byId.get(userId) || { user_id: userId, user: membership.user || null, roles: [] };
      if (membership.user && !current.user) current.user = membership.user;
      if (membership.is_active !== false) current.roles.push(String(membership.role || 'member'));
      byId.set(userId, current);
    });
    return Array.from(byId.values()).sort((left, right) => (
      String(left.user?.full_name || left.user?.username || '').localeCompare(
        String(right.user?.full_name || right.user?.username || ''),
        'ru',
      )
    ));
  }, [memberships]);

  const saveManagers = useCallback(async () => {
    if (!selectedId) return;
    setSaving(true);
    try {
      await departmentsApi.setDepartmentManagers(selectedId, draftManagerIds);
      setStatus({ error: '', message: 'Руководители сохранены.' });
      await loadMembers(selectedId);
    } catch (error) {
      setStatus({ error: formatApiError(error, 'Не удалось сохранить руководителей.'), message: '' });
    } finally {
      setSaving(false);
    }
  }, [draftManagerIds, loadMembers, selectedId]);

  const confirmSync = useCallback((source: 'users' | 'ad') => {
    if (syncing) return;
    const fromAd = source === 'ad';
    Alert.alert(
      fromAd ? 'Синхронизировать отделы из AD?' : 'Синхронизировать отделы из пользователей?',
      'Состав справочника отделов будет обновлён. Назначения руководителей сохранятся.',
      [
        { text: 'Отмена', style: 'cancel' },
        {
          text: 'Синхронизировать',
          onPress: () => {
            setSyncing(source);
            setStatus({ error: '', message: '' });
            void (fromAd
              ? departmentsApi.syncDepartmentsFromAd()
              : departmentsApi.syncDepartmentsFromUsers())
              .then(async () => {
                setStatus({
                  error: '',
                  message: fromAd
                    ? 'Отделы синхронизированы из AD.'
                    : 'Отделы синхронизированы из пользователей.',
                });
                await loadDepartments();
              })
              .catch((error) => {
                setStatus({
                  error: formatApiError(
                    error,
                    fromAd ? 'Не удалось синхронизировать из AD.' : 'Не удалось синхронизировать отделы.',
                  ),
                  message: '',
                });
              })
              .finally(() => setSyncing(''));
          },
        },
      ],
    );
  }, [loadDepartments, syncing]);

  if (!allowed) {
    return (
      <AccountScreenScaffold title="Отделы" tokens={tokens} onBack={() => goBackOrReplace('/(shell)/menu/admin')}>
        <AccountSectionCard tokens={tokens} title="Нет доступа" description="Нужно право departments.manage.">
          {null}
        </AccountSectionCard>
      </AccountScreenScaffold>
    );
  }

  return (
    <AccountScreenScaffold
      title="Отделы"
      tokens={tokens}
      onBack={() => goBackOrReplace('/(shell)/menu/admin')}
      onRefresh={() => { void loadDepartments(); }}
      refreshing={loading}
    >
      <AccountStatusText tokens={tokens} error={status.error} message={status.message} />
      <View style={styles.actions}>
        <AccountSecondaryButton
          tokens={tokens}
          disabled={Boolean(syncing)}
          loading={syncing === 'users'}
          label="Синхронизация из пользователей"
          onPress={() => confirmSync('users')}
        />
        <AccountSecondaryButton
          tokens={tokens}
          disabled={Boolean(syncing)}
          loading={syncing === 'ad'}
          label="Синхронизация из AD"
          onPress={() => confirmSync('ad')}
        />
      </View>
      <HubTextField label="Поиск отдела" value={search} onChangeText={setSearch} />
      {loading && departments.length === 0 ? <AccountLoading tokens={tokens} /> : filteredDepartments.length === 0 ? (
        <Text style={{ color: tokens.textSecondary, marginTop: 12 }}>Отделы не найдены.</Text>
      ) : filteredDepartments.map((item) => {
        const selected = String(item.id) === selectedId;
        return (
          <Pressable
            key={String(item.id)}
            onPress={() => setSelectedId(String(item.id))}
            style={[
              styles.row,
              {
                borderColor: selected ? tokens.selectedBorder : tokens.borderSoft,
                backgroundColor: selected ? tokens.selected : tokens.panelSolid,
              },
            ]}
          >
            <Text style={{ color: tokens.textPrimary, fontWeight: '800' }}>{item.name || 'Отдел'}</Text>
            <Text style={{ color: tokens.textSecondary, fontSize: 12 }}>
              Сотрудников: {item.members_count ?? '—'} · руководителей: {item.managers_count ?? '—'}
            </Text>
          </Pressable>
        );
      })}
      <AccountSectionCard tokens={tokens} title="Состав" description="Отметьте руководителей и сохраните.">
        {membersLoading ? <AccountLoading tokens={tokens} /> : members.length === 0 ? (
          <Text style={{ color: tokens.textSecondary }}>Нет сотрудников в отделе.</Text>
        ) : members.map((item) => {
          const checked = draftManagerIds.includes(item.user_id);
          return (
            <View key={item.user_id} style={styles.member}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: tokens.textPrimary, fontWeight: '700' }}>
                  {item.user?.full_name || item.user?.username || item.user_id}
                </Text>
                <Text style={{ color: tokens.textSecondary, fontSize: 12 }}>
                  {item.user?.job_title || item.roles.join(', ') || 'сотрудник'}
                </Text>
              </View>
              <Switch
                value={checked}
                onValueChange={(value) => setDraftManagerIds((current) => (
                  value ? [...current, item.user_id] : current.filter((id) => id !== item.user_id)
                ))}
              />
            </View>
          );
        })}
        <AccountPrimaryButton
          tokens={tokens}
          disabled={!selectedId}
          loading={saving}
          label="Сохранить руководителей"
          onPress={() => { void saveManagers(); }}
        />
      </AccountSectionCard>
    </AccountScreenScaffold>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 8, marginBottom: 8 },
  row: { borderWidth: 1, borderRadius: 14, padding: 12, marginTop: 8 },
  member: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8 },
});
