import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { APP_LOCK_TIMEOUT_LABELS } from '../../account/accountConstants';
import {
  formatDateTime,
  twoFaPolicyLabel,
} from '../../account/accountFormat';
import * as authSecurityApi from '../../api/authSecurityApi';
import { formatApiError } from '../../api/formatError';
import { APP_LOCK_TIMEOUT_OPTIONS } from '../../auth/biometricAuth';
import { useAuth } from '../../auth/AuthContext';
import { useNativeCommands } from '../../native/useNativeCommands';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens } from '../../theme/fluentTokens';
import {
  AccountField,
  AccountPrimaryButton,
  AccountScreenScaffold,
  AccountSecondaryButton,
  AccountSectionCard,
  AccountStatusText,
} from './AccountChrome';
import { goBackOrReplace } from './accountBack';

type LockState = {
  enabled?: boolean;
  timeoutSeconds?: number;
  biometricEnabled?: boolean;
};

export function NativeSecuritySettingsScreen() {
  const { biometricEnrollmentAvailable, user, refreshUser } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const { execute } = useNativeCommands();
  const [devices, setDevices] = useState<authSecurityApi.TrustedDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [lockState, setLockState] = useState<LockState | null>(null);
  const [busy, setBusy] = useState('');
  const [status, setStatus] = useState({ error: '', message: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [nextDevices, nextLock] = await Promise.all([
        authSecurityApi.listTrustedDevices(),
        execute('appLock.getState') as Promise<LockState>,
      ]);
      setDevices(nextDevices);
      setLockState(nextLock);
    } catch (error) {
      setStatus({ error: formatApiError(error, 'Не удалось загрузить безопасность.'), message: '' });
    } finally {
      setLoading(false);
    }
  }, [execute]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRegenerateCodes = useCallback(() => {
    Alert.alert('Новые резервные коды', 'Текущие коды перестанут работать.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Сгенерировать',
        onPress: () => {
          void (async () => {
            setBusy('codes');
            try {
              const codes = await authSecurityApi.regenerateBackupCodes();
              setBackupCodes(codes);
              setStatus({ error: '', message: 'Новые резервные коды готовы. Сохраните их в надёжном месте.' });
            } catch (error) {
              setStatus({ error: formatApiError(error, 'Не удалось сгенерировать резервные коды.'), message: '' });
            } finally {
              setBusy('');
            }
          })();
        },
      },
    ]);
  }, []);

  const handleReset2fa = useCallback(() => {
    Alert.alert('Сбросить 2FA?', 'Будут отозваны резервные коды и доверенные устройства.', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Сбросить',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            setBusy('reset');
            try {
              await authSecurityApi.resetOwnTwoFactor();
              setBackupCodes([]);
              await refreshUser();
              await load();
              setStatus({ error: '', message: '2FA сброшен. Настройте его заново при следующем входе.' });
            } catch (error) {
              setStatus({ error: formatApiError(error, 'Не удалось сбросить 2FA.'), message: '' });
            } finally {
              setBusy('');
            }
          })();
        },
      },
    ]);
  }, [load, refreshUser]);

  const handleRevoke = useCallback((device: authSecurityApi.TrustedDevice) => {
    Alert.alert('Отозвать устройство?', device.label || 'Доверенное устройство', [
      { text: 'Отмена', style: 'cancel' },
      {
        text: 'Отозвать',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            try {
              await authSecurityApi.revokeTrustedDevice(device.id);
              await load();
              setStatus({ error: '', message: 'Устройство отозвано.' });
            } catch (error) {
              setStatus({ error: formatApiError(error, 'Не удалось отозвать устройство.'), message: '' });
            }
          })();
        },
      },
    ]);
  }, [load]);

  const copyCodes = useCallback(async () => {
    await Clipboard.setStringAsync(backupCodes.join('\n'));
    setStatus({ error: '', message: 'Коды скопированы.' });
  }, [backupCodes]);

  const timeoutSeconds = Number(lockState?.timeoutSeconds ?? 60);
  const lockEnabled = Boolean(lockState?.enabled);
  const biometricEnabled = Boolean(lockState?.biometricEnabled);
  const canReauthenticateForBiometrics = Boolean(user?.is_2fa_enabled);

  const handleBiometricAction = useCallback(async () => {
    if (!biometricEnabled && !biometricEnrollmentAvailable) {
      router.push('/(auth)/login' as never);
      return;
    }

    setBusy('bio');
    try {
      const next = await execute(biometricEnabled ? 'biometrics.disable' : 'biometrics.enable') as LockState;
      setLockState(next);
      setStatus({
        error: '',
        message: biometricEnabled ? 'Вход по отпечатку отключён.' : 'Вход по отпечатку включён.',
      });
    } catch (error) {
      setStatus({ error: formatApiError(error, 'Не удалось изменить вход по отпечатку.'), message: '' });
    } finally {
      setBusy('');
    }
  }, [biometricEnabled, biometricEnrollmentAvailable, execute]);

  return (
    <AccountScreenScaffold
      title="Безопасность"
      tokens={tokens}
      onBack={() => goBackOrReplace('/(shell)/menu/settings')}
    >
      <AccountStatusText tokens={tokens} error={status.error} message={status.message} />
      <AccountSectionCard tokens={tokens} title="2FA" description="Состояние двухфакторной защиты текущей учётной записи.">
        <AccountField tokens={tokens} label="2FA" value={user?.is_2fa_enabled ? 'Включён' : 'Не включён'} />
        <AccountField tokens={tokens} label="Политика 2FA" value={twoFaPolicyLabel(user?.twofa_policy)} />
        <AccountField tokens={tokens} label="Текущий вход" value={user?.network_zone === 'internal' ? 'Внутренняя сеть' : 'Внешняя сеть'} />
        <AccountField tokens={tokens} label="2FA нужен сейчас" value={user?.twofa_required_for_current_request ? 'Да' : 'Нет'} />
        <View style={styles.actions}>
          <AccountPrimaryButton
            tokens={tokens}
            disabled={Boolean(busy)}
            loading={busy === 'codes'}
            label="Новые резервные коды"
            onPress={handleRegenerateCodes}
          />
          <AccountSecondaryButton
            tokens={tokens}
            danger
            disabled={Boolean(busy)}
            loading={busy === 'reset'}
            label="Сбросить свой 2FA"
            onPress={handleReset2fa}
          />
        </View>
        {backupCodes.length ? (
          <View style={[styles.codes, { borderColor: tokens.borderSoft, backgroundColor: tokens.panelMuted }]}>
            {backupCodes.map((code) => (
              <Text key={code} selectable style={{ color: tokens.textPrimary, fontWeight: '800' }}>{code}</Text>
            ))}
            <AccountSecondaryButton tokens={tokens} label="Скопировать" onPress={() => { void copyCodes(); }} />
          </View>
        ) : null}
      </AccountSectionCard>

      <AccountSectionCard tokens={tokens} title="Блокировка приложения" description="Вход по отпечатку включается только после подтверждения пароля и 2FA. Блокировка после сворачивания выключена по умолчанию.">
        <View style={styles.actions}>
          <AccountPrimaryButton
            tokens={tokens}
            disabled={Boolean(busy) || (!biometricEnabled && !biometricEnrollmentAvailable && !canReauthenticateForBiometrics)}
            loading={busy === 'bio'}
            label={biometricEnabled
              ? 'Отключить вход по отпечатку'
              : biometricEnrollmentAvailable
                ? 'Включить вход по отпечатку'
                : canReauthenticateForBiometrics
                  ? 'Подтвердить вход и 2FA'
                  : 'Сначала настройте 2FA'}
            onPress={() => { void handleBiometricAction(); }}
            testID="native-security-biometric-action"
          />
        </View>
        {!biometricEnabled && !biometricEnrollmentAvailable ? (
          <Text
            accessibilityLiveRegion="polite"
            style={[styles.biometricNotice, { color: tokens.textSecondary, backgroundColor: tokens.panelMuted }]}
          >
            {canReauthenticateForBiometrics
              ? 'Для включения повторно войдите по логину и паролю и подтвердите 2FA. До успешного подтверждения текущая сессия и настройки не изменятся.'
              : 'Вход по отпечатку недоступен без 2FA. Сначала настройте двухфакторную аутентификацию.'}
          </Text>
        ) : null}
        <View style={styles.switchRow}>
          <Text style={{ color: tokens.textPrimary, fontWeight: '700', flex: 1 }}>Блокировать после сворачивания</Text>
          <Switch
            value={lockEnabled}
            disabled={!biometricEnabled || Boolean(busy)}
            onValueChange={(value) => {
              void (async () => {
                try {
                  const nextTimeout = value
                    ? (timeoutSeconds > 0 ? timeoutSeconds : 900)
                    : timeoutSeconds;
                  const next = await execute('appLock.update', {
                    enabled: value,
                    timeoutSeconds: nextTimeout,
                  }) as LockState;
                  setLockState(next);
                } catch (error) {
                  setStatus({ error: formatApiError(error, 'Не удалось изменить блокировку.'), message: '' });
                }
              })();
            }}
          />
        </View>
        {APP_LOCK_TIMEOUT_OPTIONS.map((value) => (
          <Pressable
            key={value}
            disabled={!biometricEnabled || !lockEnabled}
            onPress={() => {
              void (async () => {
                try {
                  const next = await execute('appLock.update', { enabled: true, timeoutSeconds: value }) as LockState;
                  setLockState(next);
                } catch (error) {
                  setStatus({ error: formatApiError(error, 'Не удалось изменить таймаут.'), message: '' });
                }
              })();
            }}
            style={[
              styles.choice,
              {
                opacity: !biometricEnabled || !lockEnabled ? 0.45 : 1,
                borderColor: timeoutSeconds === value ? tokens.selectedBorder : tokens.borderSoft,
                backgroundColor: timeoutSeconds === value ? tokens.selected : tokens.actionBg,
              },
            ]}
          >
            <Text style={{ color: tokens.textPrimary, fontWeight: '700' }}>{APP_LOCK_TIMEOUT_LABELS[value]}</Text>
          </Pressable>
        ))}
      </AccountSectionCard>

      <AccountSectionCard tokens={tokens} title="Доверенные устройства" description="Регистрация passkey доступна только в браузере.">
        {loading ? <Text style={{ color: tokens.textSecondary }}>Загрузка…</Text> : devices.length === 0 ? (
          <Text style={{ color: tokens.textSecondary }}>Доверенные устройства пока не зарегистрированы.</Text>
        ) : devices.map((device) => (
          <View key={device.id} style={[styles.device, { borderColor: tokens.borderSoft }]}>
            <Text style={{ color: tokens.textPrimary, fontWeight: '800' }}>
              {device.label || 'Доверенное устройство'}
              {device.is_current_device ? ' · текущее' : ''}
              {device.is_active === false ? ' · отозвано' : ''}
            </Text>
            <Text style={{ color: tokens.textSecondary, fontSize: 12 }}>Создано: {formatDateTime(device.created_at)}</Text>
            <Text style={{ color: tokens.textSecondary, fontSize: 12 }}>Последнее использование: {formatDateTime(device.last_used_at)}</Text>
            {device.is_active === false ? null : (
              <View style={{ marginTop: 8 }}>
                <AccountSecondaryButton tokens={tokens} danger label="Отозвать" onPress={() => handleRevoke(device)} />
              </View>
            )}
          </View>
        ))}
      </AccountSectionCard>
    </AccountScreenScaffold>
  );
}

const styles = StyleSheet.create({
  actions: { gap: 8, marginBottom: 8 },
  codes: { marginTop: 10, borderWidth: 1, borderRadius: 12, padding: 12, gap: 6 },
  biometricNotice: {
    borderRadius: 10,
    fontSize: 13,
    lineHeight: 19,
    marginBottom: 12,
    padding: 10,
  },
  switchRow: { minHeight: 44, flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  choice: {
    minHeight: 44,
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: 'center',
    paddingHorizontal: 12,
    marginBottom: 8,
  },
  device: { borderTopWidth: 1, paddingVertical: 10 },
});
