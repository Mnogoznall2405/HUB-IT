import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, StyleSheet, Text, View } from 'react-native';
import { getComputerDetail, type ComputerRecord, type ComputerScope } from '../../api/computersApi';
import { formatApiError } from '../../api/formatError';
import { useAuth } from '../../auth/AuthContext';
import {
  computerDiskWarningCount,
  computerStatusLabel,
  computerStatusTone,
  formatComputerAge,
  formatComputerBytes,
  formatComputerTimestamp,
  formatComputerUptime,
} from '../../computers/nativeComputersModel';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens } from '../../theme/fluentTokens';
import { AccountField, AccountScreenScaffold, AccountSectionCard } from '../account/AccountChrome';

function firstParam(value: string | string[] | undefined): string {
  return String(Array.isArray(value) ? value[0] : value || '').trim();
}

function statusColor(status: ComputerRecord['status'], tokens: ReturnType<typeof useFluentTokens>): string {
  const tone = computerStatusTone(status);
  if (tone === 'success') return tokens.success;
  if (tone === 'warning') return tokens.warning;
  if (tone === 'error') return tokens.error;
  return tokens.textTertiary;
}

export function NativeComputerDetailScreen() {
  const params = useLocalSearchParams<{ macAddress?: string | string[]; scope?: string | string[]; q?: string | string[] }>();
  const macAddress = firstParam(params.macAddress);
  const scope: ComputerScope = firstParam(params.scope) === 'all' ? 'all' : 'selected';
  const { hasPermission, offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const canRead = hasPermission('computers.read');
  const canReadAll = hasPermission('computers.read_all');
  const effectiveScope: ComputerScope = scope === 'all' && canReadAll ? 'all' : 'selected';
  const [computer, setComputer] = useState<ComputerRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const mountedRef = useRef(true);
  const requestRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const focusedRef = useRef(false);

  const load = useCallback(async ({ refresh = false } = {}) => {
    if (!canRead || !macAddress || offlineMode) {
      if (mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
      return;
    }
    const requestId = ++requestRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (refresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const result = await getComputerDetail(macAddress, { scope: effectiveScope, signal: controller.signal });
      if (requestId !== requestRef.current || controller.signal.aborted || !mountedRef.current) return;
      setComputer(result);
    } catch (cause) {
      if (requestId === requestRef.current && !controller.signal.aborted && mountedRef.current) {
        setError(formatApiError(cause, 'Не удалось загрузить карточку компьютера.'));
      }
    } finally {
      if (requestId === requestRef.current && mountedRef.current) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [canRead, effectiveScope, macAddress, offlineMode]);

  useEffect(() => {
    mountedRef.current = true;
    void load();
    return () => {
      mountedRef.current = false;
      requestRef.current += 1;
      abortRef.current?.abort();
    };
  }, [load]);

  useFocusEffect(useCallback(() => {
    focusedRef.current = true;
    return () => { focusedRef.current = false; };
  }, []));

  useEffect(() => {
    let active = AppState.currentState === 'active';
    const subscription = AppState.addEventListener('change', (nextState) => {
      const wasActive = active;
      active = nextState === 'active';
      if (!wasActive && active && focusedRef.current && !offlineMode) void load({ refresh: true });
    });
    return () => subscription.remove();
  }, [load, offlineMode]);

  if (!canRead) {
    return (
      <AccountScreenScaffold title="Компьютер" onBack={() => router.back()} tokens={tokens}>
        <AccountSectionCard tokens={tokens} title="Нет доступа" description="Для карточки нужно право computers.read.">{null}</AccountSectionCard>
      </AccountScreenScaffold>
    );
  }

  const disks = computer ? [...computer.logical_disks, ...computer.storage] : [];
  const user = computer?.user_full_name || computer?.user_login || computer?.current_user || '';
  const diskWarnings = computer ? computerDiskWarningCount(computer) : 0;

  return (
    <AccountScreenScaffold
      title={computer?.hostname || 'Компьютер'}
      onBack={() => router.back()}
      tokens={tokens}
      refreshing={refreshing}
      onRefresh={offlineMode ? undefined : () => { void load({ refresh: true }); }}
    >
      {offlineMode ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.warning }]}>Автономный режим: доступны только уже загруженные данные.</Text> : null}
      {error ? <Text accessibilityRole="alert" style={[styles.notice, { color: tokens.error }]}>{error}</Text> : null}
      {loading && !computer ? <View style={styles.loading}><ActivityIndicator color={tokens.primary} /><Text style={[styles.muted, { color: tokens.textSecondary }]}>Загружаем карточку…</Text></View> : null}
      {!loading && !computer ? (
        <AccountSectionCard tokens={tokens} title="Карточка недоступна" description={macAddress ? 'Повторите запрос.' : 'Не указан MAC-адрес компьютера.'}>
          <Pressable testID="native-computer-detail-retry" onPress={() => { void load(); }} disabled={offlineMode || !macAddress} accessibilityRole="button" style={[styles.retry, { backgroundColor: tokens.primary, opacity: offlineMode || !macAddress ? 0.5 : 1 }]}>
            <Text style={styles.retryText}>Повторить</Text>
          </Pressable>
        </AccountSectionCard>
      ) : null}
      {computer ? (
        <>
          <View style={[styles.hero, { backgroundColor: tokens.panelSolid, borderColor: tokens.borderSoft }]}>
            <View style={[styles.heroIcon, { backgroundColor: tokens.panelInset }]}><MaterialCommunityIcons name="desktop-tower-monitor" size={30} color={tokens.primary} /></View>
            <View style={styles.flex}>
              <Text style={[styles.heroTitle, { color: tokens.textPrimary }]}>{computer.hostname}</Text>
              <Text style={[styles.heroStatus, { color: statusColor(computer.status, tokens) }]}>{computerStatusLabel(computer.status)} · {formatComputerAge(computer.age_seconds)}</Text>
              <Text selectable style={[styles.heroMeta, { color: tokens.textSecondary }]}>{computer.ip_primary || 'IP не указан'} · {computer.mac_address}</Text>
            </View>
          </View>

          <AccountSectionCard tokens={tokens} title="Привязка и пользователь">
            <AccountField tokens={tokens} label="Пользователь" value={user} />
            <AccountField tokens={tokens} label="Филиал" value={computer.branch_name} />
            <AccountField tokens={tokens} label="Расположение" value={computer.location_name} />
            <AccountField tokens={tokens} label="База" value={computer.database_name} />
            <AccountField tokens={tokens} label="Инвентарный номер" value={computer.inventory_inv_no} />
            <AccountField tokens={tokens} label="Модель по учёту" value={computer.inventory_model_name} />
          </AccountSectionCard>

          <AccountSectionCard tokens={tokens} title="Система">
            <AccountField tokens={tokens} label="Процессор" value={computer.cpu_model} />
            <AccountField tokens={tokens} label="Оперативная память" value={computer.ram_gb === null ? '' : `${computer.ram_gb} ГБ`} />
            <AccountField tokens={tokens} label="Загрузка CPU" value={computer.cpu_load_percent === null ? '' : `${computer.cpu_load_percent}%`} />
            <AccountField tokens={tokens} label="Использование RAM" value={computer.ram_used_percent === null ? '' : `${computer.ram_used_percent}%`} />
            <AccountField tokens={tokens} label="Время работы" value={formatComputerUptime(computer.uptime_seconds)} />
            <AccountField tokens={tokens} label="Последняя перезагрузка" value={formatComputerTimestamp(computer.last_reboot_at)} />
            <AccountField tokens={tokens} label="Последний отчёт" value={formatComputerTimestamp(computer.last_seen_at)} />
            <AccountField tokens={tokens} label="Серийный номер" value={computer.system_serial} />
          </AccountSectionCard>

          <AccountSectionCard tokens={tokens} title="Сеть" description={computer.ip_list.length ? `IP-адресов: ${computer.ip_list.length}` : undefined}>
            <AccountField tokens={tokens} label="Основной IP" value={computer.ip_primary} />
            <AccountField tokens={tokens} label="Все IP" value={computer.ip_list.join(', ')} />
            <AccountField tokens={tokens} label="MAC" value={computer.mac_address} />
            {computer.network_devices.slice(0, 8).map((device, index) => (
              <View key={`${device.mac_address}:${device.name}:${index}`} style={[styles.subCard, { backgroundColor: tokens.panelInset }]}>
                <Text style={[styles.subTitle, { color: tokens.textPrimary }]}>{device.name}</Text>
                <Text style={[styles.muted, { color: tokens.textSecondary }]}>{[device.link_speed, device.ipv4.join(', '), device.connection_status].filter(Boolean).join(' · ') || 'Нет данных'}</Text>
              </View>
            ))}
          </AccountSectionCard>

          <AccountSectionCard tokens={tokens} title="Диски" description={diskWarnings ? `Требуют внимания: ${diskWarnings}` : undefined}>
            {disks.length ? disks.slice(0, 12).map((disk, index) => (
              <View key={`${disk.serial_number}:${disk.mountpoint}:${index}`} style={[styles.subCard, { backgroundColor: tokens.panelInset }]}>
                <Text style={[styles.subTitle, { color: tokens.textPrimary }]}>{disk.name || disk.mountpoint || `Диск ${index + 1}`}</Text>
                <Text style={[styles.muted, { color: tokens.textSecondary }]}>{[
                  disk.total_gb !== null ? `${disk.free_gb ?? 0} из ${disk.total_gb} ГБ свободно` : disk.size_gb !== null ? `${disk.size_gb} ГБ` : '',
                  disk.health_status,
                  disk.media_type,
                ].filter(Boolean).join(' · ')}</Text>
              </View>
            )) : <Text style={[styles.muted, { color: tokens.textSecondary }]}>Данные о дисках не получены.</Text>}
          </AccountSectionCard>

          <AccountSectionCard tokens={tokens} title="Outlook и изменения">
            <AccountField tokens={tokens} label="Состояние Outlook" value={computer.outlook_status} />
            <AccountField tokens={tokens} label="Размер файлов Outlook" value={formatComputerBytes(computer.outlook_total_size_bytes)} />
            <AccountField tokens={tokens} label="Архивов" value={String(computer.outlook_archives_count)} />
            <AccountField tokens={tokens} label="Изменений за 30 дней" value={String(computer.changes_count_30d)} />
            <Text style={[styles.privacyNote, { color: tokens.textSecondary }]}>Пути профилей, история и действия скрытия пока не доступны в мобильном приложении.</Text>
          </AccountSectionCard>
        </>
      ) : null}
    </AccountScreenScaffold>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  notice: { marginBottom: 8, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  loading: { minHeight: 160, alignItems: 'center', justifyContent: 'center', gap: 10 },
  hero: { borderWidth: 1, borderRadius: 16, padding: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  heroIcon: { width: 54, height: 54, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  heroTitle: { fontSize: 19, lineHeight: 24, fontWeight: '900' },
  heroStatus: { marginTop: 2, fontSize: 12, lineHeight: 17, fontWeight: '800' },
  heroMeta: { marginTop: 3, fontSize: 12, lineHeight: 17 },
  retry: { alignSelf: 'flex-start', minHeight: 42, borderRadius: 12, marginTop: 10, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  retryText: { color: '#fff', fontSize: 13, fontWeight: '800' },
  subCard: { borderRadius: 12, padding: 11, marginBottom: 7 },
  subTitle: { fontSize: 13, lineHeight: 18, fontWeight: '800' },
  muted: { marginTop: 2, fontSize: 12, lineHeight: 17 },
  privacyNote: { marginTop: 8, fontSize: 12, lineHeight: 18 },
});
