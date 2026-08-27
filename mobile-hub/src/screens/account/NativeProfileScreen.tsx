import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import * as authApi from '../../api/authApi';
import { listAvailableDatabases } from '../../api/databaseApi';
import { formatApiError } from '../../api/formatError';
import * as mailApi from '../../api/mailMailboxesApi';
import {
  authSourceLabel,
  createEmptyMailboxDraft,
  createMailboxDraftFromEntry,
  getDbName,
  MAILBOX_AUTH_LABELS,
  normalizeMailboxAuthMode,
  permissionSummaryForUser,
  resolveAvatarUrl,
  roleLabel,
  type DatabaseOption,
  type MailboxDraft,
} from '../../account/accountFormat';
import { useAuth } from '../../auth/AuthContext';
import {
  getAccountDisplayName,
  getAccountInitials,
  getAccountSubtitle,
} from '../../dashboard/dashboardFormat';
import { NativeFilePermissionError, pickNativeAttachment } from '../../files/nativeFilePicker';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens } from '../../theme/fluentTokens';
import { HubTextField } from '../../components/ui/HubTextField';
import {
  AccountField,
  AccountLoading,
  AccountPrimaryButton,
  AccountScreenScaffold,
  AccountSecondaryButton,
  AccountSectionCard,
  AccountStatusText,
} from './AccountChrome';
import { goBackOrReplace } from './accountBack';

export function NativeProfileScreen() {
  const { user, hasPermission, refreshUser } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const canAccessMail = hasPermission('mail.access');
  const avatarUrl = resolveAvatarUrl(user?.avatar_url);
  const [dbOptions, setDbOptions] = useState<DatabaseOption[]>([]);
  const [mailboxes, setMailboxes] = useState<mailApi.MailMailbox[]>([]);
  const [mailboxesLoading, setMailboxesLoading] = useState(canAccessMail);
  const [status, setStatus] = useState({ error: '', message: '' });
  const [avatarBusy, setAvatarBusy] = useState<'upload' | 'delete' | ''>('');
  const [password, setPassword] = useState({ old: '', next: '', confirm: '', busy: false });
  const [mailboxDraft, setMailboxDraft] = useState<MailboxDraft>(() => createEmptyMailboxDraft(user));
  const [mailboxMode, setMailboxMode] = useState<'create' | 'edit'>('create');
  const [mailboxOpen, setMailboxOpen] = useState(false);
  const [mailboxBusy, setMailboxBusy] = useState(false);

  const loadMailboxes = useCallback(async () => {
    if (!canAccessMail) {
      setMailboxes([]);
      setMailboxesLoading(false);
      return;
    }
    setMailboxesLoading(true);
    try {
      setMailboxes(await mailApi.listMailboxes(true));
    } catch (error) {
      setStatus({ error: formatApiError(error, 'Не удалось загрузить ящики Exchange.'), message: '' });
      setMailboxes([]);
    } finally {
      setMailboxesLoading(false);
    }
  }, [canAccessMail]);

  useEffect(() => {
    void loadMailboxes();
  }, [loadMailboxes]);

  useEffect(() => {
    void listAvailableDatabases()
      .then(setDbOptions)
      .catch(() => setDbOptions([]));
  }, []);

  const uploadAvatar = useCallback(async (source: 'gallery' | 'camera') => {
    setAvatarBusy('upload');
    setStatus({ error: '', message: '' });
    try {
      const file = await pickNativeAttachment(source);
      if (!file) return;
      const formData = new FormData();
      formData.append('file', {
        uri: file.uri,
        name: file.name,
        type: file.mimeType,
      } as unknown as Blob);
      await authApi.uploadAvatar(formData);
      await refreshUser();
      setStatus({ error: '', message: 'Фото профиля обновлено.' });
    } catch (error) {
      if (error instanceof NativeFilePermissionError) {
        setStatus({ error: error.message, message: '' });
        return;
      }
      setStatus({ error: formatApiError(error, 'Не удалось загрузить фото.'), message: '' });
    } finally {
      setAvatarBusy('');
    }
  }, [refreshUser]);

  const handlePickAvatar = useCallback(() => {
    Alert.alert('Фото профиля', 'Выберите источник', [
      { text: 'Галерея', onPress: () => { void uploadAvatar('gallery'); } },
      { text: 'Камера', onPress: () => { void uploadAvatar('camera'); } },
      { text: 'Отмена', style: 'cancel' },
    ]);
  }, [uploadAvatar]);

  const handleDeleteAvatar = useCallback(() => {
    Alert.alert('Удалить фото?', 'Фото профиля будет удалено.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Удалить',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setAvatarBusy('delete');
            try {
              await authApi.deleteAvatar();
              await refreshUser();
              setStatus({ error: '', message: 'Фото профиля удалено.' });
            } catch (error) {
              setStatus({ error: formatApiError(error, 'Не удалось удалить фото.'), message: '' });
            } finally {
              setAvatarBusy('');
            }
          })();
        },
      },
    ]);
  }, [refreshUser]);

  const handleChangePassword = useCallback(async () => {
    if (password.next.length < 6) {
      setStatus({ error: 'Новый пароль должен быть не короче 6 символов.', message: '' });
      return;
    }
    if (password.next !== password.confirm) {
      setStatus({ error: 'Подтверждение пароля не совпадает.', message: '' });
      return;
    }
    setPassword((prev) => ({ ...prev, busy: true }));
    try {
      await authApi.changePassword(password.old, password.next);
      setPassword({ old: '', next: '', confirm: '', busy: false });
      setStatus({ error: '', message: 'Пароль изменён.' });
    } catch (error) {
      setPassword((prev) => ({ ...prev, busy: false }));
      setStatus({ error: formatApiError(error, 'Не удалось сменить пароль.'), message: '' });
    }
  }, [password.confirm, password.next, password.old]);

  const openCreateMailbox = useCallback(() => {
    setMailboxMode('create');
    setMailboxDraft(createEmptyMailboxDraft(user));
    setMailboxOpen(true);
  }, [user]);

  const openEditMailbox = useCallback((entry: mailApi.MailMailbox) => {
    setMailboxMode('edit');
    setMailboxDraft(createMailboxDraftFromEntry(entry as Record<string, unknown>, user));
    setMailboxOpen(true);
  }, [user]);

  const handleMailboxSave = useCallback(async () => {
    const authMode = normalizeMailboxAuthMode(mailboxDraft.auth_mode);
    const payload = {
      label: String(mailboxDraft.label || '').trim() || undefined,
      mailbox_email: String(mailboxDraft.mailbox_email || '').trim(),
      mailbox_login: authMode === 'stored_credentials' ? String(mailboxDraft.mailbox_login || '').trim() || undefined : undefined,
      mailbox_password: authMode === 'stored_credentials' ? String(mailboxDraft.mailbox_password || '') : undefined,
      auth_mode: authMode,
      is_primary: authMode === 'primary_credentials' ? false : Boolean(mailboxDraft.is_primary),
      is_active: Boolean(mailboxDraft.is_active),
    };
    if (!payload.mailbox_email) {
      setStatus({ error: 'Укажите адрес ящика.', message: '' });
      return;
    }
    if (authMode === 'stored_credentials' && mailboxMode === 'create' && !payload.mailbox_password) {
      setStatus({ error: 'Для личного входа нужен пароль ящика.', message: '' });
      return;
    }
    setMailboxBusy(true);
    try {
      if (mailboxMode === 'edit' && mailboxDraft.id) {
        const patch = { ...payload };
        if (!patch.mailbox_password) delete patch.mailbox_password;
        await mailApi.updateMailbox(mailboxDraft.id, patch);
        setStatus({ error: '', message: 'Ящик обновлён.' });
      } else {
        await mailApi.createMailbox(payload);
        setStatus({ error: '', message: 'Ящик подключён.' });
      }
      setMailboxOpen(false);
      await loadMailboxes();
    } catch (error) {
      setStatus({ error: formatApiError(error, 'Не удалось сохранить ящик.'), message: '' });
    } finally {
      setMailboxBusy(false);
    }
  }, [loadMailboxes, mailboxDraft, mailboxMode]);

  const handleMailboxAction = useCallback((action: string, entry: mailApi.MailMailbox) => {
    if (action === 'edit') {
      openEditMailbox(entry);
      return;
    }
    const run = async () => {
      try {
        if (action === 'primary') {
          await mailApi.updateMailbox(String(entry.id), { is_primary: true });
          setStatus({ error: '', message: 'Основной ящик обновлён.' });
        } else if (action === 'toggle') {
          await mailApi.updateMailbox(String(entry.id), { is_active: !Boolean(entry.is_active) });
          setStatus({ error: '', message: entry.is_active ? 'Ящик отключён.' : 'Ящик включён.' });
        } else if (action === 'delete') {
          await mailApi.deleteMailbox(String(entry.id));
          setStatus({ error: '', message: 'Ящик удалён.' });
        }
        await loadMailboxes();
      } catch (error) {
        setStatus({ error: formatApiError(error, 'Не удалось изменить ящик.'), message: '' });
      }
    };
    if (action === 'delete') {
      Alert.alert('Отключить ящик?', entry.label || entry.mailbox_email || 'без названия', [
        { text: 'Отмена', style: 'cancel' },
        { text: 'Удалить', style: 'destructive', onPress: () => { void run(); } },
      ]);
      return;
    }
    void run();
  }, [loadMailboxes, openEditMailbox]);

  return (
    <AccountScreenScaffold
      title="Профиль"
      tokens={tokens}
      onBack={() => goBackOrReplace('/(shell)/menu')}
    >
      <AccountStatusText tokens={tokens} error={status.error} message={status.message} />
      <View style={[styles.hero, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
        <View>
          {avatarUrl ? (
            <Image source={{ uri: avatarUrl }} style={styles.avatarImage} />
          ) : (
            <View style={[styles.avatar, { backgroundColor: tokens.primary }]}>
              <Text style={styles.avatarText}>{getAccountInitials(user)}</Text>
            </View>
          )}
          {Boolean(avatarBusy) ? (
            <View style={styles.avatarBusy}><Text style={styles.avatarBusyText}>…</Text></View>
          ) : null}
        </View>
        <View style={styles.heroText}>
          <Text style={[styles.heroName, { color: tokens.textPrimary }]}>{getAccountDisplayName(user)}</Text>
          <Text style={[styles.heroSub, { color: tokens.textSecondary }]}>{getAccountSubtitle(user)}</Text>
          <View style={styles.heroActions}>
            <AccountSecondaryButton tokens={tokens} label="Изменить фото" onPress={handlePickAvatar} disabled={Boolean(avatarBusy)} loading={avatarBusy === 'upload'} />
            {user?.avatar_url ? (
              <AccountSecondaryButton tokens={tokens} label="Удалить" danger onPress={handleDeleteAvatar} disabled={Boolean(avatarBusy)} loading={avatarBusy === 'delete'} />
            ) : null}
          </View>
        </View>
      </View>

      <AccountSectionCard tokens={tokens} title="Служебные данные" description="Поля только для чтения.">
        <AccountField tokens={tokens} label="Логин" value={user?.username || '—'} />
        <AccountField tokens={tokens} label="Роль" value={roleLabel(user?.role)} />
        <AccountField tokens={tokens} label="Источник входа" value={authSourceLabel(user?.auth_source)} />
        <AccountField tokens={tokens} label="Назначенная БД" value={getDbName(dbOptions, user?.assigned_database)} />
        <AccountField tokens={tokens} label="Telegram ID" value={user?.telegram_id ? String(user.telegram_id) : 'Не указан'} />
        <AccountField tokens={tokens} label="Права" value={permissionSummaryForUser(user)} />
      </AccountSectionCard>

      <AccountSectionCard tokens={tokens} title="Смена пароля">
        <HubTextField
          label="Текущий пароль"
          value={password.old}
          onChangeText={(value) => setPassword((prev) => ({ ...prev, old: value }))}
          secureTextEntry
          autoCapitalize="none"
        />
        <View style={styles.fieldGap} />
        <HubTextField
          label="Новый пароль"
          value={password.next}
          onChangeText={(value) => setPassword((prev) => ({ ...prev, next: value }))}
          secureTextEntry
          autoCapitalize="none"
        />
        <View style={styles.fieldGap} />
        <HubTextField
          label="Подтверждение"
          value={password.confirm}
          onChangeText={(value) => setPassword((prev) => ({ ...prev, confirm: value }))}
          secureTextEntry
          autoCapitalize="none"
        />
        <View style={styles.fieldGap} />
        <AccountPrimaryButton
          tokens={tokens}
          label="Сменить пароль"
          onPress={() => { void handleChangePassword(); }}
          disabled={!password.old || !password.next}
          loading={password.busy}
        />
      </AccountSectionCard>

      {canAccessMail ? (
        <AccountSectionCard tokens={tokens} title="Ящики Exchange" description="Подключение и основной ящик для почты.">
          {mailboxesLoading ? <AccountLoading tokens={tokens} /> : mailboxes.length === 0 ? (
            <Text style={{ color: tokens.textSecondary }}>Подключённых ящиков пока нет.</Text>
          ) : mailboxes.map((item) => (
            <View key={item.id} style={[styles.mailboxRow, { borderColor: tokens.borderSoft }]}>
              <Text style={[styles.mailboxTitle, { color: tokens.textPrimary }]}>
                {item.label || item.mailbox_email || 'Ящик'}
              </Text>
              <Text style={{ color: tokens.textSecondary, fontSize: 12 }}>
                {item.mailbox_email}
                {item.is_primary ? ' · основной' : ''}
                {item.is_active === false ? ' · отключён' : ''}
              </Text>
              <View style={styles.mailboxActions}>
                <AccountSecondaryButton tokens={tokens} label="Изменить" onPress={() => handleMailboxAction('edit', item)} />
                {item.is_primary ? null : (
                  <AccountSecondaryButton tokens={tokens} label="Основной" onPress={() => handleMailboxAction('primary', item)} />
                )}
                <AccountSecondaryButton
                  tokens={tokens}
                  label={item.is_active === false ? 'Включить' : 'Отключить'}
                  onPress={() => handleMailboxAction('toggle', item)}
                />
                <AccountSecondaryButton tokens={tokens} label="Удалить" danger onPress={() => handleMailboxAction('delete', item)} />
              </View>
            </View>
          ))}
          <View style={styles.fieldGap} />
          <AccountPrimaryButton tokens={tokens} label="Подключить ящик" onPress={openCreateMailbox} />
        </AccountSectionCard>
      ) : null}

      <Modal visible={mailboxOpen} animationType="slide" onRequestClose={() => setMailboxOpen(false)}>
        <AccountScreenScaffold
          title={mailboxMode === 'edit' ? 'Ящик Exchange' : 'Новый ящик'}
          tokens={tokens}
          onBack={() => setMailboxOpen(false)}
        >
          <HubTextField label="Название" value={mailboxDraft.label} onChangeText={(value) => setMailboxDraft((prev) => ({ ...prev, label: value }))} />
          <View style={styles.fieldGap} />
          <HubTextField
            label="Email ящика"
            value={mailboxDraft.mailbox_email}
            autoCapitalize="none"
            keyboardType="email-address"
            onChangeText={(value) => setMailboxDraft((prev) => ({ ...prev, mailbox_email: value }))}
          />
          <View style={styles.fieldGap} />
          {(Object.keys(MAILBOX_AUTH_LABELS) as Array<keyof typeof MAILBOX_AUTH_LABELS>).map((mode) => (
            <Pressable
              key={mode}
              onPress={() => setMailboxDraft((prev) => ({
                ...prev,
                auth_mode: mode,
                mailbox_login: mode === 'stored_credentials' ? prev.mailbox_login : '',
                mailbox_password: mode === 'stored_credentials' ? prev.mailbox_password : '',
                is_primary: mode === 'primary_credentials' ? false : prev.is_primary,
              }))}
              style={[
                styles.choice,
                {
                  borderColor: mailboxDraft.auth_mode === mode ? tokens.selectedBorder : tokens.borderSoft,
                  backgroundColor: mailboxDraft.auth_mode === mode ? tokens.selected : tokens.panelSolid,
                },
              ]}
            >
              <Text style={{ color: tokens.textPrimary, fontWeight: '700' }}>{MAILBOX_AUTH_LABELS[mode]}</Text>
            </Pressable>
          ))}
          {mailboxDraft.auth_mode === 'stored_credentials' ? (
            <>
              <View style={styles.fieldGap} />
              <HubTextField
                label="Логин ящика"
                autoCapitalize="none"
                value={mailboxDraft.mailbox_login}
                onChangeText={(value) => setMailboxDraft((prev) => ({ ...prev, mailbox_login: value }))}
              />
              <View style={styles.fieldGap} />
              <HubTextField
                label={mailboxMode === 'edit' ? 'Пароль (если меняете)' : 'Пароль ящика'}
                secureTextEntry
                autoCapitalize="none"
                value={mailboxDraft.mailbox_password}
                onChangeText={(value) => setMailboxDraft((prev) => ({ ...prev, mailbox_password: value }))}
              />
              <View style={styles.switchRow}>
                <Text style={{ color: tokens.textPrimary, fontWeight: '700', flex: 1 }}>Основной ящик</Text>
                <Switch
                  value={mailboxDraft.is_primary}
                  onValueChange={(value) => setMailboxDraft((prev) => ({ ...prev, is_primary: value }))}
                />
              </View>
            </>
          ) : null}
          <View style={styles.switchRow}>
            <Text style={{ color: tokens.textPrimary, fontWeight: '700', flex: 1 }}>Ящик включён</Text>
            <Switch
              value={mailboxDraft.is_active}
              onValueChange={(value) => setMailboxDraft((prev) => ({ ...prev, is_active: value }))}
            />
          </View>
          <AccountPrimaryButton
            tokens={tokens}
            label="Сохранить"
            loading={mailboxBusy}
            onPress={() => { void handleMailboxSave(); }}
          />
        </AccountScreenScaffold>
      </Modal>
    </AccountScreenScaffold>
  );
}

const styles = StyleSheet.create({
  hero: {
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
    flexDirection: 'row',
    gap: 12,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: { width: 72, height: 72, borderRadius: 36 },
  avatarText: { color: '#fff', fontWeight: '900', fontSize: 22 },
  avatarBusy: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.35)',
    borderRadius: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarBusyText: { color: '#fff', fontWeight: '800' },
  heroText: { flex: 1, minWidth: 0 },
  heroName: { fontWeight: '800', fontSize: 18 },
  heroSub: { marginTop: 4, fontSize: 13 },
  heroActions: { marginTop: 10, gap: 8 },
  fieldGap: { height: 10 },
  mailboxRow: { borderTopWidth: 1, paddingVertical: 10 },
  mailboxTitle: { fontWeight: '800', fontSize: 15 },
  mailboxActions: { marginTop: 8, gap: 8 },
  choice: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    justifyContent: 'center',
    marginBottom: 8,
  },
  switchRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 8,
  },
});
