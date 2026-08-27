import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Modal,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { NativeMailHtmlBody } from '../../components/mail/NativeMailHtmlBody';
import { formatApiError } from '../../api/formatError';
import {
  getMyMailConfig,
  getNativeMailPreferences,
  saveMyMailCredentials,
  testMyMailConnection,
  updateNativeMailPreferences,
  updateMyMailSignature,
  DEFAULT_NATIVE_MAIL_PREFERENCES,
  type NativeMailConfig,
  type NativeMailPreferences,
} from '../../api/mailConfigApi';
import { listMailboxes, type MailMailbox } from '../../api/mailMailboxesApi';
import { useAuth } from '../../auth/AuthContext';
import { sanitizeMailSignatureHtml } from '../../mail/nativeMailSignature';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens } from '../../theme/fluentTokens';
import { AccountScreenScaffold, AccountSectionCard } from '../account/AccountChrome';
import { goBackOrReplace } from '../account/accountBack';

function first(value: string | string[] | undefined): string {
  return String(Array.isArray(value) ? value[0] : value || '').trim();
}

export function NativeMailSettingsScreen() {
  const params = useLocalSearchParams<{ mailboxId?: string | string[] }>();
  const { hasPermission, offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const allowed = hasPermission('mail.access');
  const [mailboxId, setMailboxId] = useState(first(params.mailboxId));
  const [mailboxes, setMailboxes] = useState<MailMailbox[]>([]);
  const [config, setConfig] = useState<NativeMailConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [testing, setTesting] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [credentialsOpen, setCredentialsOpen] = useState(false);
  const [credentialsSaving, setCredentialsSaving] = useState(false);
  const [credentialsLogin, setCredentialsLogin] = useState('');
  const [credentialsEmail, setCredentialsEmail] = useState('');
  const [credentialsPassword, setCredentialsPassword] = useState('');
  const [credentialsError, setCredentialsError] = useState('');
  const [signatureOpen, setSignatureOpen] = useState(false);
  const [signatureSaving, setSignatureSaving] = useState(false);
  const [signatureHtml, setSignatureHtml] = useState('');
  const [signatureError, setSignatureError] = useState('');
  const [mailViewPreferences, setMailViewPreferences] = useState<NativeMailPreferences>(DEFAULT_NATIVE_MAIL_PREFERENCES);
  const [viewPreferencesLoaded, setViewPreferencesLoaded] = useState(false);
  const [viewSettingsOpen, setViewSettingsOpen] = useState(false);
  const [viewSettingsSaving, setViewSettingsSaving] = useState(false);
  const [viewSettingsDraft, setViewSettingsDraft] = useState<NativeMailPreferences>(DEFAULT_NATIVE_MAIL_PREFERENCES);
  const [viewSettingsError, setViewSettingsError] = useState('');
  const credentialsUsePrimaryAccount = String(config?.auth_mode || '').trim().toLowerCase() === 'primary_credentials';
  const credentialsEditable = Boolean(config) && !credentialsUsePrimaryAccount && !offlineMode;

  const load = useCallback(async () => {
    if (!allowed) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const [items, selectedConfig, viewPreferencesResult] = await Promise.all([
        listMailboxes(false),
        getMyMailConfig(mailboxId),
        getNativeMailPreferences()
          .then((value) => ({ value, cause: null }))
          .catch((cause: unknown) => ({ value: null, cause })),
      ]);
      const active = items.filter((item) => item.is_active !== false);
      setMailboxes(active);
      setConfig(selectedConfig);
      if (viewPreferencesResult.value) {
        setMailViewPreferences(viewPreferencesResult.value);
        setViewPreferencesLoaded(true);
        setViewSettingsError('');
      } else {
        setViewPreferencesLoaded(false);
        setViewSettingsError(formatApiError(viewPreferencesResult.cause, 'Не удалось загрузить настройки вида.'));
      }
      if (!mailboxId) {
        const selected = String(selectedConfig.mailbox_id || active.find((item) => item.is_primary)?.id || active[0]?.id || '');
        if (selected) setMailboxId(selected);
      }
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось загрузить настройки почты.'));
    } finally {
      setLoading(false);
    }
  }, [allowed, mailboxId]);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') setCredentialsPassword('');
    });
    return () => subscription.remove();
  }, []);

  const closeCredentials = useCallback(() => {
    if (credentialsSaving) return;
    setCredentialsOpen(false);
    setCredentialsPassword('');
    setCredentialsError('');
  }, [credentialsSaving]);

  const openCredentials = useCallback(() => {
    if (!config || String(config.auth_mode || '').trim().toLowerCase() === 'primary_credentials') return;
    setCredentialsLogin(String(config.mailbox_login || config.effective_mailbox_login || '').trim());
    setCredentialsEmail(String(config.mailbox_email || '').trim());
    setCredentialsPassword('');
    setCredentialsError('');
    setCredentialsOpen(true);
  }, [config]);

  const persistCredentials = useCallback(async () => {
    if (credentialsSaving || offlineMode) return;
    if (!credentialsPassword.trim()) {
      setCredentialsError('Введите пароль от корпоративного компьютера.');
      return;
    }
    setCredentialsSaving(true);
    setCredentialsError('');
    try {
      const nextConfig = await saveMyMailCredentials({
        mailboxId,
        mailboxLogin: credentialsLogin,
        mailboxPassword: credentialsPassword,
        mailboxEmail: credentialsEmail,
      });
      setConfig(nextConfig);
      setMailboxes((current) => current.map((item) => String(item.id) === mailboxId
        ? { ...item, mailbox_email: nextConfig.mailbox_email, mailbox_login: nextConfig.mailbox_login }
        : item));
      setStatus('Адрес и пароль проверены и сохранены.');
      setCredentialsOpen(false);
    } catch (cause) {
      setCredentialsError(formatApiError(cause, 'Не удалось проверить и сохранить учётные данные.'));
    } finally {
      setCredentialsPassword('');
      setCredentialsSaving(false);
    }
  }, [credentialsEmail, credentialsLogin, credentialsPassword, credentialsSaving, mailboxId, offlineMode]);

  const openSignature = useCallback(() => {
    setSignatureHtml(String(config?.mail_signature_html || ''));
    setSignatureError('');
    setSignatureOpen(true);
  }, [config?.mail_signature_html]);

  const closeSignature = useCallback(() => {
    if (signatureSaving) return;
    setSignatureOpen(false);
    setSignatureError('');
  }, [signatureSaving]);

  const persistSignature = useCallback(async () => {
    if (signatureSaving || offlineMode) return;
    setSignatureSaving(true);
    setSignatureError('');
    try {
      const safeHtml = sanitizeMailSignatureHtml(signatureHtml);
      const nextConfig = await updateMyMailSignature(mailboxId, safeHtml);
      setConfig(nextConfig);
      setSignatureHtml(String(nextConfig.mail_signature_html || ''));
      setStatus('Подпись сохранена и будет добавляться к исходящим письмам.');
      setSignatureOpen(false);
    } catch (cause) {
      setSignatureError(formatApiError(cause, 'Не удалось сохранить подпись.'));
    } finally {
      setSignatureSaving(false);
    }
  }, [mailboxId, offlineMode, signatureHtml, signatureSaving]);

  const testConnection = useCallback(async () => {
    if (testing || offlineMode) return;
    setTesting(true);
    setError('');
    setStatus('');
    try {
      await testMyMailConnection(mailboxId);
      setStatus('Соединение с почтовым ящиком работает.');
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось подключиться к почтовому ящику.'));
    } finally {
      setTesting(false);
    }
  }, [mailboxId, offlineMode, testing]);

  const openViewSettings = useCallback(() => {
    if (!viewPreferencesLoaded) return;
    setViewSettingsDraft(mailViewPreferences);
    setViewSettingsError('');
    setViewSettingsOpen(true);
  }, [mailViewPreferences, viewPreferencesLoaded]);

  const closeViewSettings = useCallback(() => {
    if (viewSettingsSaving) return;
    setViewSettingsOpen(false);
    setViewSettingsError('');
  }, [viewSettingsSaving]);

  const persistViewSettings = useCallback(async () => {
    if (viewSettingsSaving || offlineMode) return;
    setViewSettingsSaving(true);
    setViewSettingsError('');
    try {
      const nextPreferences = await updateNativeMailPreferences({
        density: viewSettingsDraft.density,
        mark_read_on_select: viewSettingsDraft.mark_read_on_select,
        show_preview_snippets: viewSettingsDraft.show_preview_snippets,
        show_favorites_first: viewSettingsDraft.show_favorites_first,
      });
      setMailViewPreferences(nextPreferences);
      setStatus('Настройки списка почты сохранены.');
      setViewSettingsOpen(false);
    } catch (cause) {
      setViewSettingsError(formatApiError(cause, 'Не удалось сохранить настройки вида.'));
    } finally {
      setViewSettingsSaving(false);
    }
  }, [offlineMode, viewSettingsDraft, viewSettingsSaving]);

  if (!allowed) {
    return <AccountScreenScaffold title="Настройки почты" tokens={tokens} onBack={() => goBackOrReplace('/(shell)/mail')}><AccountSectionCard tokens={tokens} title="Нет доступа" description="Для почты нужно право mail.access.">{null}</AccountSectionCard></AccountScreenScaffold>;
  }

  return (
    <AccountScreenScaffold title="Настройки почты" tokens={tokens} onBack={() => goBackOrReplace('/(shell)/mail')} refreshing={loading} onRefresh={() => { void load(); }}>
      {mailboxes.length > 1 ? (
        <View style={styles.mailboxes}>
          {mailboxes.map((mailbox) => (
            <Pressable
              key={mailbox.id}
              testID={`native-mail-settings-mailbox-${mailbox.id}`}
              accessibilityRole="button"
              accessibilityState={{ selected: mailboxId === String(mailbox.id) }}
              onPress={() => { setConfig(null); setMailboxId(String(mailbox.id)); setStatus(''); }}
              style={({ pressed }) => [styles.mailboxChip, {
                backgroundColor: mailboxId === String(mailbox.id) ? tokens.selected : tokens.panelSolid,
                borderColor: mailboxId === String(mailbox.id) ? tokens.selectedBorder : tokens.borderSoft,
                opacity: pressed ? 0.75 : 1,
              }]}
            >
              <Text style={[styles.mailboxChipText, { color: mailboxId === String(mailbox.id) ? tokens.primary : tokens.textSecondary }]}>{mailbox.label || mailbox.mailbox_email || 'Ящик'}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {loading && !config ? <View style={styles.loading}><ActivityIndicator color={tokens.primary} /></View> : null}
      {error ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{error}</Text> : null}
      {status ? <Text accessibilityLiveRegion="polite" style={[styles.success, { color: tokens.success }]}>{status}</Text> : null}
      {config ? (
        <AccountSectionCard tokens={tokens} title={config.label || config.mailbox_email || 'Почтовый ящик'} description={config.mail_is_configured ? 'Ящик настроен' : 'Требуется настройка'}>
          <View style={styles.rows}>
            <ConfigRow label="Адрес" value={config.mailbox_email || 'Не указан'} tokens={tokens} />
            <ConfigRow label="Логин" value={config.effective_mailbox_login || config.mailbox_login || 'Не указан'} tokens={tokens} />
            <ConfigRow label="Авторизация" value={config.mail_auth_mode || config.auth_mode || 'Не указана'} tokens={tokens} />
            <ConfigRow label="Подпись" value={config.mail_signature_html ? 'Настроена' : 'Не настроена'} tokens={tokens} />
            {config.mail_requires_password || config.mail_requires_relogin ? (
              <Text accessibilityRole="alert" style={[styles.warning, { color: tokens.warning }]}>Введите актуальный корпоративный пароль, чтобы восстановить подключение к Exchange.</Text>
            ) : null}
          </View>
        </AccountSectionCard>
      ) : null}
      <Pressable
        testID="native-mail-test-connection"
        accessibilityRole="button"
        accessibilityLabel="Проверить подключение к почте"
        accessibilityState={{ disabled: testing || offlineMode, busy: testing }}
        disabled={testing || offlineMode}
        onPress={() => { void testConnection(); }}
        style={[styles.primaryAction, { backgroundColor: tokens.primary, opacity: testing || offlineMode ? 0.5 : 1 }]}
      >
        {testing ? <ActivityIndicator color="#fff" /> : <MaterialCommunityIcons name="connection" size={21} color="#fff" />}
        <Text style={styles.primaryActionText}>{testing ? 'Проверяем…' : 'Проверить подключение'}</Text>
      </Pressable>
      <Pressable
        testID="native-mail-edit-credentials"
        accessibilityRole="button"
        accessibilityLabel="Изменить адрес, логин и корпоративный пароль"
        accessibilityState={{ disabled: !credentialsEditable }}
        disabled={!credentialsEditable}
        onPress={openCredentials}
        style={[styles.secondaryAction, { borderColor: tokens.borderSoft, backgroundColor: tokens.panelSolid, opacity: credentialsEditable ? 1 : 0.5 }]}
      >
        <MaterialCommunityIcons name="account-key-outline" size={21} color={tokens.primary} />
        <View style={styles.secondaryText}>
          <Text style={[styles.secondaryTitle, { color: tokens.textPrimary }]}>Адрес и пароль</Text>
          <Text style={[styles.secondaryHint, { color: tokens.textSecondary }]}>{credentialsUsePrimaryAccount ? 'Этот ящик использует основную AD-учётную запись. Обновите её повторным входом в HUB.' : 'Exchange проверит новые данные до сохранения. Пароль не остаётся в форме.'}</Text>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={19} color={tokens.iconMuted} />
      </Pressable>
      <Pressable
        testID="native-mail-edit-signature"
        accessibilityRole="button"
        accessibilityLabel="Изменить HTML подпись почты"
        accessibilityState={{ disabled: !config || offlineMode }}
        disabled={!config || offlineMode}
        onPress={openSignature}
        style={[styles.secondaryAction, { borderColor: tokens.borderSoft, backgroundColor: tokens.panelSolid, opacity: !config || offlineMode ? 0.5 : 1 }]}
      >
        <MaterialCommunityIcons name="draw-pen" size={21} color={tokens.primary} />
        <View style={styles.secondaryText}>
          <Text style={[styles.secondaryTitle, { color: tokens.textPrimary }]}>HTML-подпись</Text>
          <Text style={[styles.secondaryHint, { color: tokens.textSecondary }]}>Безопасный HTML и предпросмотр. Подпись добавляется сервером при отправке.</Text>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={19} color={tokens.iconMuted} />
      </Pressable>
      <Pressable
        testID="native-mail-manage-folders"
        accessibilityRole="button"
        accessibilityLabel="Управление папками почты"
        onPress={() => router.push({ pathname: '/(shell)/mail/folders', params: { mailboxId } } as never)}
        style={[styles.secondaryAction, { borderColor: tokens.borderSoft, backgroundColor: tokens.panelSolid }]}
      >
        <MaterialCommunityIcons name="folder-cog-outline" size={21} color={tokens.primary} />
        <View style={styles.secondaryText}>
          <Text style={[styles.secondaryTitle, { color: tokens.textPrimary }]}>Папки</Text>
          <Text style={[styles.secondaryHint, { color: tokens.textSecondary }]}>Создание, переименование, избранное и удаление пользовательских папок.</Text>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={19} color={tokens.iconMuted} />
      </Pressable>
      <Pressable
        testID="native-mail-view-settings"
        accessibilityRole="button"
        accessibilityLabel="Настройки списка писем"
        accessibilityState={{ disabled: !viewPreferencesLoaded || offlineMode }}
        disabled={!viewPreferencesLoaded || offlineMode}
        onPress={openViewSettings}
        style={[styles.secondaryAction, { borderColor: tokens.borderSoft, backgroundColor: tokens.panelSolid, opacity: !viewPreferencesLoaded || offlineMode ? 0.5 : 1 }]}
      >
        <MaterialCommunityIcons name="view-list-outline" size={21} color={tokens.primary} />
        <View style={styles.secondaryText}>
          <Text style={[styles.secondaryTitle, { color: tokens.textPrimary }]}>Вид списка</Text>
          <Text style={[styles.secondaryHint, { color: tokens.textSecondary }]}>Плотность, сниппеты, избранные папки и автоматическое прочтение.</Text>
          {viewSettingsError && !viewSettingsOpen ? <Text accessibilityRole="alert" style={[styles.inlineError, { color: tokens.error }]}>{viewSettingsError}</Text> : null}
        </View>
        <MaterialCommunityIcons name="chevron-right" size={19} color={tokens.iconMuted} />
      </Pressable>
      <Pressable
        testID="native-mail-manage-mailboxes"
        accessibilityRole="button"
        accessibilityLabel="Управление подключёнными почтовыми ящиками"
        onPress={() => router.push('/(shell)/menu/profile' as never)}
        style={[styles.secondaryAction, { borderColor: tokens.borderSoft, backgroundColor: tokens.panelSolid }]}
      >
        <MaterialCommunityIcons name="email-multiple-outline" size={21} color={tokens.primary} />
        <View style={styles.secondaryText}>
          <Text style={[styles.secondaryTitle, { color: tokens.textPrimary }]}>Подключённые ящики</Text>
          <Text style={[styles.secondaryHint, { color: tokens.textSecondary }]}>Добавление, основной ящик, включение, отключение и удаление доступны в нативном профиле.</Text>
        </View>
        <MaterialCommunityIcons name="chevron-right" size={19} color={tokens.iconMuted} />
      </Pressable>
      <Modal visible={credentialsOpen} animationType="slide" onRequestClose={closeCredentials}>
        <AccountScreenScaffold title="Адрес и пароль" tokens={tokens} onBack={closeCredentials}>
          <Text style={[styles.modalHelp, { color: tokens.textSecondary }]}>Введите пароль от корпоративного компьютера. Exchange проверит адрес, логин и пароль до сохранения.</Text>
          <SettingsField label="Почта Exchange" value={credentialsEmail} tokens={tokens} testID="native-mail-credentials-email" keyboardType="email-address" onChangeText={setCredentialsEmail} />
          <SettingsField label="Логин Exchange" value={credentialsLogin} tokens={tokens} testID="native-mail-credentials-login" onChangeText={setCredentialsLogin} />
          <View style={styles.fieldBlock}>
            <Text style={[styles.fieldLabel, { color: tokens.textSecondary }]}>Пароль от корпоративного компьютера</Text>
            <TextInput
              testID="native-mail-credentials-password"
              value={credentialsPassword}
              onChangeText={setCredentialsPassword}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="Пароль от корпоративного компьютера"
              style={[styles.input, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft, color: tokens.textPrimary }]}
            />
          </View>
          {credentialsError ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{credentialsError}</Text> : null}
          {offlineMode ? <Text accessibilityRole="alert" style={[styles.warning, { color: tokens.warning }]}>Автономный режим: сохранение недоступно.</Text> : null}
          <Pressable
            testID="native-mail-save-credentials"
            accessibilityRole="button"
            accessibilityLabel="Проверить и сохранить учётные данные"
            accessibilityState={{ disabled: credentialsSaving || offlineMode, busy: credentialsSaving }}
            disabled={credentialsSaving || offlineMode}
            onPress={() => { void persistCredentials(); }}
            style={[styles.primaryAction, { backgroundColor: tokens.primary, opacity: credentialsSaving || offlineMode ? 0.5 : 1 }]}
          >
            {credentialsSaving ? <ActivityIndicator color="#fff" /> : <MaterialCommunityIcons name="content-save-check-outline" size={21} color="#fff" />}
            <Text style={styles.primaryActionText}>{credentialsSaving ? 'Проверяем…' : 'Проверить и сохранить'}</Text>
          </Pressable>
        </AccountScreenScaffold>
      </Modal>
      <Modal visible={signatureOpen} animationType="slide" onRequestClose={closeSignature}>
        <AccountScreenScaffold title="HTML-подпись" tokens={tokens} onBack={closeSignature}>
          <Text style={[styles.modalHelp, { color: tokens.textSecondary }]}>Разрешены абзацы, переносы, жирный, курсив, подчёркивание, зачёркивание, списки и цитаты. Скрипты, изображения, ссылки и стили удаляются перед сохранением.</Text>
          <View style={styles.fieldBlock}>
            <Text style={[styles.fieldLabel, { color: tokens.textSecondary }]}>HTML подписи</Text>
            <TextInput
              testID="native-mail-signature-html"
              value={signatureHtml}
              onChangeText={setSignatureHtml}
              multiline
              textAlignVertical="top"
              autoCapitalize="none"
              autoCorrect={false}
              accessibilityLabel="HTML подписи"
              placeholder="<p><strong>Имя Фамилия</strong><br>Должность</p>"
              placeholderTextColor={tokens.textTertiary}
              style={[styles.signatureInput, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft, color: tokens.textPrimary }]}
            />
          </View>
          <Text style={[styles.previewLabel, { color: tokens.textSecondary }]}>Предпросмотр безопасной версии</Text>
          {sanitizeMailSignatureHtml(signatureHtml) ? (
            <NativeMailHtmlBody bodyHtml={sanitizeMailSignatureHtml(signatureHtml)} plainText="Предпросмотр подписи" compact tokens={tokens} />
          ) : <Text style={[styles.emptySignature, { color: tokens.textTertiary }]}>Подпись пустая.</Text>}
          {signatureError ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{signatureError}</Text> : null}
          <View style={styles.signatureActions}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Очистить подпись"
              disabled={signatureSaving || offlineMode}
              onPress={() => setSignatureHtml('')}
              style={[styles.clearAction, { borderColor: tokens.borderSoft, opacity: signatureSaving || offlineMode ? 0.5 : 1 }]}
            >
              <Text style={[styles.clearActionText, { color: tokens.error }]}>Очистить</Text>
            </Pressable>
            <Pressable
              testID="native-mail-save-signature"
              accessibilityRole="button"
              accessibilityLabel="Сохранить HTML подпись"
              accessibilityState={{ disabled: signatureSaving || offlineMode, busy: signatureSaving }}
              disabled={signatureSaving || offlineMode}
              onPress={() => { void persistSignature(); }}
              style={[styles.saveSignature, { backgroundColor: tokens.primary, opacity: signatureSaving || offlineMode ? 0.5 : 1 }]}
            >
              {signatureSaving ? <ActivityIndicator color="#fff" /> : null}
              <Text style={styles.primaryActionText}>{signatureSaving ? 'Сохраняем…' : 'Сохранить'}</Text>
            </Pressable>
          </View>
        </AccountScreenScaffold>
      </Modal>
      <Modal visible={viewSettingsOpen} animationType="slide" onRequestClose={closeViewSettings}>
        <AccountScreenScaffold title="Вид списка" tokens={tokens} onBack={closeViewSettings}>
          <Text style={[styles.modalHelp, { color: tokens.textSecondary }]}>На телефоне почта всегда одноколоночная. Настройки размеров desktop-панелей здесь не применяются.</Text>
          <Text style={[styles.fieldLabel, { color: tokens.textSecondary }]}>Плотность списка</Text>
          <View style={styles.densityRow}>
            {(['comfortable', 'compact'] as const).map((density) => {
              const selected = viewSettingsDraft.density === density;
              const label = density === 'comfortable' ? 'Комфортная' : 'Компактная';
              return (
                <Pressable
                  key={density}
                  testID={`native-mail-density-${density}`}
                  accessibilityRole="button"
                  accessibilityLabel={`${label} плотность списка`}
                  accessibilityState={{ selected, disabled: viewSettingsSaving || offlineMode }}
                  disabled={viewSettingsSaving || offlineMode}
                  onPress={() => setViewSettingsDraft((current) => ({ ...current, density }))}
                  style={[styles.densityAction, {
                    backgroundColor: selected ? tokens.selected : tokens.panelSolid,
                    borderColor: selected ? tokens.selectedBorder : tokens.borderSoft,
                    opacity: viewSettingsSaving || offlineMode ? 0.5 : 1,
                  }]}
                >
                  <Text style={[styles.densityActionText, { color: selected ? tokens.primary : tokens.textSecondary }]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
          <View style={[styles.preferenceRows, { borderColor: tokens.borderSoft, backgroundColor: tokens.panelSolid }]}>
            <PreferenceSwitch
              label="Показывать фрагмент текста"
              hint="Добавляет до двух строк содержимого в список писем."
              value={viewSettingsDraft.show_preview_snippets}
              disabled={viewSettingsSaving || offlineMode}
              tokens={tokens}
              testID="native-mail-pref-preview"
              onValueChange={(value) => setViewSettingsDraft((current) => ({ ...current, show_preview_snippets: value }))}
            />
            <PreferenceSwitch
              label="Избранные папки выше"
              hint="Поднимает избранные пользовательские папки над остальными."
              value={viewSettingsDraft.show_favorites_first}
              disabled={viewSettingsSaving || offlineMode}
              tokens={tokens}
              testID="native-mail-pref-favorites"
              onValueChange={(value) => setViewSettingsDraft((current) => ({ ...current, show_favorites_first: value }))}
            />
            <PreferenceSwitch
              label="Прочитывать при открытии"
              hint="Если выключено, статус меняется только явным действием."
              value={viewSettingsDraft.mark_read_on_select}
              disabled={viewSettingsSaving || offlineMode}
              tokens={tokens}
              testID="native-mail-pref-auto-read"
              onValueChange={(value) => setViewSettingsDraft((current) => ({ ...current, mark_read_on_select: value }))}
            />
          </View>
          {viewSettingsError ? <Text accessibilityRole="alert" style={[styles.error, { color: tokens.error }]}>{viewSettingsError}</Text> : null}
          {offlineMode ? <Text accessibilityRole="alert" style={[styles.warning, { color: tokens.warning }]}>Автономный режим: сохранение недоступно.</Text> : null}
          <Pressable
            testID="native-mail-save-view-settings"
            accessibilityRole="button"
            accessibilityLabel="Сохранить настройки списка писем"
            accessibilityState={{ disabled: viewSettingsSaving || offlineMode, busy: viewSettingsSaving }}
            disabled={viewSettingsSaving || offlineMode}
            onPress={() => { void persistViewSettings(); }}
            style={[styles.primaryAction, { backgroundColor: tokens.primary, opacity: viewSettingsSaving || offlineMode ? 0.5 : 1 }]}
          >
            {viewSettingsSaving ? <ActivityIndicator color="#fff" /> : <MaterialCommunityIcons name="content-save-outline" size={21} color="#fff" />}
            <Text style={styles.primaryActionText}>{viewSettingsSaving ? 'Сохраняем…' : 'Сохранить'}</Text>
          </Pressable>
        </AccountScreenScaffold>
      </Modal>
    </AccountScreenScaffold>
  );
}

function ConfigRow({ label, value, tokens }: { label: string; value: string; tokens: ReturnType<typeof useFluentTokens> }) {
  return <View style={styles.configRow}><Text style={[styles.configLabel, { color: tokens.textSecondary }]}>{label}</Text><Text selectable style={[styles.configValue, { color: tokens.textPrimary }]}>{value}</Text></View>;
}

function SettingsField({ label, value, tokens, testID, keyboardType, onChangeText }: {
  label: string;
  value: string;
  tokens: ReturnType<typeof useFluentTokens>;
  testID: string;
  keyboardType?: 'email-address';
  onChangeText: (value: string) => void;
}) {
  return <View style={styles.fieldBlock}><Text style={[styles.fieldLabel, { color: tokens.textSecondary }]}>{label}</Text><TextInput testID={testID} value={value} onChangeText={onChangeText} keyboardType={keyboardType} autoCapitalize="none" autoCorrect={false} accessibilityLabel={label} style={[styles.input, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft, color: tokens.textPrimary }]} /></View>;
}

function PreferenceSwitch({ label, hint, value, disabled, tokens, testID, onValueChange }: {
  label: string;
  hint: string;
  value: boolean;
  disabled: boolean;
  tokens: ReturnType<typeof useFluentTokens>;
  testID: string;
  onValueChange: (value: boolean) => void;
}) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled }}
      disabled={disabled}
      onPress={() => onValueChange(!value)}
      style={({ pressed }) => [styles.preferenceRow, { opacity: disabled ? 0.5 : pressed ? 0.75 : 1 }]}
    >
      <View style={styles.preferenceText}>
        <Text style={[styles.preferenceLabel, { color: tokens.textPrimary }]}>{label}</Text>
        <Text style={[styles.preferenceHint, { color: tokens.textSecondary }]}>{hint}</Text>
      </View>
      <Switch
        pointerEvents="none"
        accessible={false}
        disabled={disabled}
        value={value}
        trackColor={{ false: tokens.border, true: tokens.primary }}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  mailboxes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 },
  mailboxChip: { minHeight: 44, borderWidth: 1, borderRadius: 22, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center' },
  mailboxChipText: { fontSize: 12, fontWeight: '800' },
  loading: { minHeight: 180, alignItems: 'center', justifyContent: 'center' },
  error: { marginBottom: 9, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  success: { marginBottom: 9, fontSize: 13, lineHeight: 18, fontWeight: '800' },
  rows: { gap: 10 },
  configRow: { gap: 2 },
  configLabel: { fontSize: 11, fontWeight: '700' },
  configValue: { fontSize: 14, lineHeight: 20, fontWeight: '700' },
  warning: { fontSize: 12, lineHeight: 17, fontWeight: '700' },
  inlineError: { marginTop: 4, fontSize: 11, lineHeight: 15, fontWeight: '700' },
  primaryAction: { minHeight: 52, borderRadius: 14, marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  primaryActionText: { color: '#fff', fontSize: 14, fontWeight: '900' },
  secondaryAction: { minHeight: 70, borderWidth: 1, borderRadius: 14, marginTop: 9, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10 },
  secondaryText: { flex: 1, minWidth: 0 },
  secondaryTitle: { fontSize: 14, fontWeight: '900' },
  secondaryHint: { marginTop: 3, fontSize: 11, lineHeight: 16 },
  modalHelp: { marginBottom: 16, fontSize: 13, lineHeight: 19 },
  fieldBlock: { marginBottom: 13 },
  fieldLabel: { marginBottom: 5, fontSize: 12, lineHeight: 17, fontWeight: '800' },
  input: { minHeight: 48, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, fontSize: 15 },
  signatureInput: { minHeight: 180, borderWidth: 1, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 12, fontSize: 14, lineHeight: 20 },
  previewLabel: { marginTop: 2, fontSize: 12, lineHeight: 17, fontWeight: '800' },
  emptySignature: { minHeight: 80, paddingVertical: 24, textAlign: 'center', fontSize: 13 },
  signatureActions: { flexDirection: 'row', gap: 10, marginTop: 14 },
  clearAction: { flex: 1, minHeight: 50, borderWidth: 1, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  clearActionText: { fontSize: 13, fontWeight: '900' },
  saveSignature: { flex: 1, minHeight: 50, borderRadius: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  densityRow: { flexDirection: 'row', gap: 9, marginBottom: 14 },
  densityAction: { flex: 1, minHeight: 48, borderWidth: 1, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  densityActionText: { fontSize: 13, fontWeight: '900' },
  preferenceRows: { borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  preferenceRow: { minHeight: 70, paddingHorizontal: 12, paddingVertical: 9, flexDirection: 'row', alignItems: 'center', gap: 10 },
  preferenceText: { flex: 1, minWidth: 0 },
  preferenceLabel: { fontSize: 13, lineHeight: 18, fontWeight: '900' },
  preferenceHint: { marginTop: 2, fontSize: 11, lineHeight: 15 },
});
