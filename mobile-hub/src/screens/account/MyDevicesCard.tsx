import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import * as devicesApi from '../../api/authDevicesApi';
import { useAuth } from '../../auth/AuthContext';
import { formatDateTime } from '../../account/accountFormat';
import type { FluentTokens } from '../../theme/fluentTokens';
import { AccountSecondaryButton, AccountSectionCard, AccountStatusText } from './AccountChrome';

type Action = { kind: 'others' | 'device' | 'session'; id?: string; current?: boolean };

export function MyDevicesCard({ tokens }: { tokens: FluentTokens }) {
  const { user, logout } = useAuth();
  const [devices, setDevices] = useState<devicesApi.OwnDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState({ error: '', message: '' });
  const generation = useRef(0);
  const load = useCallback(async () => {
    const request = ++generation.current;
    setLoading(true);
    setStatus(previous => ({ ...previous, error: '' }));
    try {
      const items = await devicesApi.listOwnDevices();
      if (request === generation.current) setDevices(items);
    } catch {
      if (request === generation.current) setStatus({ error: 'Не удалось загрузить устройства. Повторите попытку.', message: '' });
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    setDevices([]);
    setStatus({ error: '', message: '' });
    void load();
    return () => { generation.current += 1; };
  }, [user?.id, load]);

  const run = async (action: Action, request: number) => {
    if (request !== generation.current || busy) return;
    setBusy(true);
    setStatus({ error: '', message: '' });
    try {
      const result = action.kind === 'others' ? await devicesApi.terminateOtherDevices()
        : action.kind === 'session' ? await devicesApi.terminateOwnSession(action.id!)
          : await devicesApi.removeOwnDevice(action.id!);
      if (request !== generation.current) return;
      if (result.current_session_closed) { await logout(); return; }
      const reloadGeneration = generation.current + 1;
      await load();
      if (generation.current !== reloadGeneration) return;
      setStatus(previous => ({ ...previous, message: action.kind === 'others' ? 'Остальные устройства отключены.'
        : action.kind === 'session' ? 'Сеанс завершён.' : 'Устройство удалено.' }));
    } catch {
      if (request === generation.current) setStatus({ error: 'Не удалось выполнить действие. Обновите список и повторите попытку.', message: '' });
    } finally { setBusy(false); }
  };
  const confirm = (action: Action) => {
    const request = generation.current;
    const title = action.kind === 'others' ? 'Завершить остальные входы?'
      : action.kind === 'session' ? 'Завершить сеанс?' : 'Удалить устройство?';
    const description = action.kind === 'session'
      ? 'Сеанс будет завершён. Сохранённая биометрия останется доступна. Для её отзыва удалите устройство.'
      : action.kind === 'others'
        ? 'Остальные устройства потеряют активные сеансы и биометрическое восстановление. Это устройство продолжит работу. Ключи passkey отзываются отдельно.'
        : 'Связанные сеансы и биометрическое восстановление будут отозваны. Потребуется новый вход. Ключи passkey отзываются отдельно.';
    Alert.alert(title, `${description}${action.current ? '\nВы выйдете из аккаунта на этом устройстве.' : ''}`, [
      { text: 'Отмена', style: 'cancel' },
      { text: 'Подтвердить', style: 'destructive', onPress: () => { void run(action, request); } },
    ]);
  };

  return (
    <AccountSectionCard tokens={tokens} title="Мои устройства" description="Входы в ваш аккаунт из браузеров и приложений.">
      <View style={{ gap: 12 }}>
        <AccountSecondaryButton tokens={tokens} label="Обновить устройства" disabled={loading || busy} onPress={() => { void load(); }} />
        <AccountStatusText tokens={tokens} {...status} />
        {loading ? <Text style={{ color: tokens.textSecondary }}>Загружаю устройства…</Text> : null}
        {!loading && !status.error && !devices.length ? <Text style={{ color: tokens.textSecondary }}>Активных устройств нет.</Text> : null}
        {!loading && devices.map(device => (
          <View key={device.id} style={{ gap: 8, paddingVertical: 12, borderTopWidth: 1, borderColor: tokens.borderSoft }}>
            <Text style={{ color: tokens.textPrimary, fontWeight: '700' }}>{device.label}{device.is_current ? ' · Это устройство' : ''}</Text>
            <Text style={{ color: tokens.textSecondary }}>Последняя активность: {formatDateTime(device.last_seen_at)}</Text>
            {device.biometric_enabled ? <Text style={{ color: tokens.textSecondary }}>Биометрия Android</Text> : null}
            {!device.sessions.length ? <Text style={{ color: tokens.textSecondary }}>Активного сеанса нет. Сохранён вход по биометрии.</Text> : null}
            {device.sessions.map(session => (
              <View key={session.session_id} style={{ gap: 8 }}>
                <Text style={{ color: tokens.textSecondary }}>IP: {session.ip_address || 'неизвестен'} · Вход: {formatDateTime(session.created_at)}</Text>
                <AccountSecondaryButton tokens={tokens} danger label="Завершить сеанс" disabled={busy || Boolean(status.error)}
                  onPress={() => confirm({ kind: 'session', id: session.session_id, current: session.is_current })} />
              </View>
            ))}
            <AccountSecondaryButton tokens={tokens} danger label="Удалить устройство" disabled={busy || Boolean(status.error)}
              onPress={() => confirm({ kind: 'device', id: device.id, current: device.is_current })} />
          </View>
        ))}
        <AccountSecondaryButton tokens={tokens} danger label="Завершить все остальные"
          disabled={loading || busy || Boolean(status.error) || !devices.some(device => !device.is_current)} onPress={() => confirm({ kind: 'others' })} />
      </View>
    </AccountSectionCard>
  );
}
