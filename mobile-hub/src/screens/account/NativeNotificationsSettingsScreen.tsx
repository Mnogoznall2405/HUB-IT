import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import {
  ANDROID_PUSH_CHANNELS,
  CHAT_NOTIFICATION_CHANNEL_LABELS,
  NOTIFICATION_CHANNEL_LABELS,
} from '../../account/accountConstants';
import { normalizeNotificationChannels, type NotificationChannels } from '../../account/accountFormat';
import { formatApiError } from '../../api/formatError';
import * as notificationApi from '../../api/notificationApi';
import { useNativeCommands } from '../../native/useNativeCommands';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens } from '../../theme/fluentTokens';
import {
  AccountPrimaryButton,
  AccountScreenScaffold,
  AccountSecondaryButton,
  AccountSectionCard,
  AccountStatusText,
} from './AccountChrome';
import { goBackOrReplace } from './accountBack';

const PUSH_STATUS_LABELS: Record<string, string> = {
  unsupported: 'Не поддерживаются',
  disabled: 'Не настроены на сервере',
  denied: 'Запрещены в Android',
  registered: 'Включены',
  error: 'Ошибка',
};

export function NativeNotificationsSettingsScreen() {
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const { execute } = useNativeCommands();
  const [channels, setChannels] = useState<NotificationChannels>(() => normalizeNotificationChannels());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [pushState, setPushState] = useState<{ status?: string; message?: string } | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [status, setStatus] = useState({ error: '', message: '' });

  const loadChannels = useCallback(async () => {
    setLoading(true);
    try {
      const data = await notificationApi.getNotificationPreferences();
      setChannels(normalizeNotificationChannels(data?.channels));
    } catch (error) {
      setStatus({ error: formatApiError(error, 'Не удалось загрузить каналы уведомлений.'), message: '' });
    } finally {
      setLoading(false);
    }
  }, []);

  const loadPush = useCallback(async (command: 'notifications.getState' | 'notifications.requestPermission' = 'notifications.getState') => {
    setPushBusy(true);
    try {
      const next = await execute(command) as { status?: string; message?: string };
      setPushState(next);
    } catch (error) {
      setStatus({ error: formatApiError(error, 'Не удалось получить состояние Android push.'), message: '' });
    } finally {
      setPushBusy(false);
    }
  }, [execute]);

  useEffect(() => {
    void loadChannels();
    void loadPush();
  }, [loadChannels, loadPush]);

  const toggleChannel = useCallback(async (key: string, enabled: boolean) => {
    const optimistic = key === 'chat'
      ? { chat: enabled, chat_direct: enabled, chat_group: enabled, chat_task: enabled }
      : { [key]: enabled };
    setChannels((prev) => ({ ...prev, ...optimistic }));
    setSaving(true);
    try {
      const data = await notificationApi.updateNotificationPreferences({ [key]: enabled });
      setChannels(normalizeNotificationChannels(data?.channels));
    } catch (error) {
      setStatus({ error: formatApiError(error, 'Не удалось сохранить канал.'), message: '' });
      await loadChannels();
    } finally {
      setSaving(false);
    }
  }, [loadChannels]);

  const chatEnabled = CHAT_NOTIFICATION_CHANNEL_LABELS.some(([key]) => Boolean(channels[key as keyof NotificationChannels]));

  return (
    <AccountScreenScaffold
      title="Уведомления"
      tokens={tokens}
      onBack={() => goBackOrReplace('/(shell)/menu/settings')}
    >
      <AccountStatusText tokens={tokens} error={status.error} message={status.message} />
      <AccountSectionCard tokens={tokens} title="Каналы" description="Одинаково действуют в браузере, Desktop и APK.">
        {loading ? <Text style={{ color: tokens.textSecondary }}>Загрузка…</Text> : (
          <>
            <ToggleRow
              tokens={tokens}
              label="Получать уведомления о чатах"
              value={chatEnabled}
              disabled={saving}
              onValueChange={(value) => { void toggleChannel('chat', value); }}
            />
            {CHAT_NOTIFICATION_CHANNEL_LABELS.map(([key, label]) => (
              <ToggleRow
                key={key}
                tokens={tokens}
                label={label}
                indent
                value={Boolean(channels[key as keyof NotificationChannels])}
                disabled={saving}
                onValueChange={(value) => { void toggleChannel(key, value); }}
              />
            ))}
            {NOTIFICATION_CHANNEL_LABELS.map(([key, label]) => (
              <ToggleRow
                key={key}
                tokens={tokens}
                label={label}
                value={Boolean(channels[key as keyof NotificationChannels])}
                disabled={saving}
                onValueChange={(value) => { void toggleChannel(key, value); }}
              />
            ))}
          </>
        )}
      </AccountSectionCard>
      <AccountSectionCard tokens={tokens} title="Android push" description="Работают, даже когда HUB-IT закрыт.">
        <Text style={{ color: tokens.textPrimary, fontWeight: '800' }}>
          {PUSH_STATUS_LABELS[String(pushState?.status || '')] || (pushBusy ? 'Проверяем…' : 'Не проверено')}
        </Text>
        <Text style={{ color: tokens.textSecondary, marginTop: 4, marginBottom: 10 }}>
          {pushState?.message || 'Проверяем разрешение и регистрацию устройства…'}
        </Text>
        <View style={styles.actions}>
          <AccountPrimaryButton
            tokens={tokens}
            loading={pushBusy}
            label={pushState?.status === 'registered' ? 'Проверить регистрацию' : 'Разрешить уведомления'}
            onPress={() => { void loadPush('notifications.requestPermission'); }}
          />
          <AccountSecondaryButton
            tokens={tokens}
            disabled={pushBusy}
            label="Настройки Android"
            onPress={() => { void execute('notifications.openSettings'); }}
          />
        </View>
        <Text style={{ color: tokens.textSecondary, marginTop: 10, marginBottom: 8, fontSize: 12 }}>
          Звук и вибрация настраиваются отдельно для каждого типа.
        </Text>
        <View style={styles.actions}>
          {ANDROID_PUSH_CHANNELS.map(([channelId, label]) => (
            <AccountSecondaryButton
              key={channelId}
              tokens={tokens}
              disabled={pushBusy}
              label={label}
              onPress={() => { void execute('notifications.openChannelSettings', { channelId }); }}
            />
          ))}
        </View>
      </AccountSectionCard>
    </AccountScreenScaffold>
  );
}

function ToggleRow({
  tokens,
  label,
  value,
  onValueChange,
  disabled,
  indent,
}: {
  tokens: ReturnType<typeof useFluentTokens>;
  label: string;
  value: boolean;
  onValueChange: (value: boolean) => void;
  disabled?: boolean;
  indent?: boolean;
}) {
  return (
    <View style={[styles.toggle, indent ? styles.toggleIndent : null]}>
      <Text style={{ color: tokens.textPrimary, fontWeight: '700', flex: 1 }}>{label}</Text>
      <Switch value={value} onValueChange={onValueChange} disabled={disabled} />
    </View>
  );
}

const styles = StyleSheet.create({
  toggle: { minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8 },
  toggleIndent: { paddingLeft: 12 },
  actions: { gap: 8 },
});
