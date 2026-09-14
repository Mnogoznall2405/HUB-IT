import { useCallback, useEffect, useRef, useState } from 'react';
import { useFocusEffect } from 'expo-router';
import { Alert, AppState, Text, View } from 'react-native';
import * as ScreenCapture from 'expo-screen-capture';
import { unlockBiometricAppLock } from '../../auth/biometricAuth';
import { useAuth } from '../../auth/AuthContext';
import { getAdminEnvSettings, saveAdminEnvSettings } from '../../api/adminSettingsApi';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens } from '../../theme/fluentTokens';
import { HubTextField } from '../../components/ui/HubTextField';
import { AccountPrimaryButton, AccountSectionCard } from './AccountChrome';
import { useNativeAdminData } from './useNativeAdminData';

const CAPTURE_KEY = 'hubit-admin-env';
export function NativeAdminEnvEditor() {
  const { biometricEnabled, offlineMode } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const [unlocked, setUnlocked] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const epoch = useRef(0);
  const state = useNativeAdminData('system', getAdminEnvSettings, unlocked);
  const clear = useCallback(() => { epoch.current += 1; setUnlocked(false); setDraft({}); }, []);
  useFocusEffect(useCallback(() => () => { clear(); void ScreenCapture.allowScreenCaptureAsync(CAPTURE_KEY).catch(() => undefined); }, [clear]));
  useEffect(() => {
    const listener = AppState.addEventListener('change', value => { if (value !== 'active') clear(); });
    return () => { epoch.current += 1; listener.remove(); };
  }, [clear]);
  useEffect(() => { if (!state.data) setDraft({}); }, [state.data]);
  const unlock = async () => {
    if (!biometricEnabled || offlineMode || unlocking || !state.allowed) return;
    const lease = epoch.current;
    setUnlocking(true); setError('');
    try {
      await ScreenCapture.preventScreenCaptureAsync(CAPTURE_KEY);
      if (lease !== epoch.current) { await ScreenCapture.allowScreenCaptureAsync(CAPTURE_KEY); return; }
      await unlockBiometricAppLock();
      if (lease === epoch.current && AppState.currentState === 'active') setUnlocked(true);
    } catch { if (lease === epoch.current) setError('Не удалось подтвердить отпечаток или включить защиту экрана.'); }
    finally { setUnlocking(false); }
  };
  const changes = Object.entries(draft).filter(([key, value]) => state.data?.items.find(item => item.key === key)?.value !== value).map(([key, value]) => ({ key, value }));
  const save = () => {
    const lease = epoch.current;
    Alert.alert('Серверные переменные', `Сохранить изменения (${changes.length})? Для применения отдельных параметров может потребоваться отдельная сборка или перезапуск служб.`, [
      { text: 'Отмена', style: 'cancel' }, { text: 'Сохранить', onPress: () => {
        if (lease === epoch.current) void state.run(() => saveAdminEnvSettings(changes));
      } },
    ]);
  };
  return <View style={{ gap: 12 }}>
    {!state.allowed ? <Text style={{ color: tokens.error }}>Нет доступа.</Text> : !biometricEnabled
      ? <Text style={{ color: tokens.textPrimary }}>Включите вход по отпечатку в настройках безопасности для работы с серверными переменными.</Text>
      : !unlocked ? <AccountPrimaryButton tokens={tokens} label="Открыть по отпечатку" onPress={() => { void unlock(); }} disabled={offlineMode || unlocking} /> : null}
    {error || state.error ? <Text accessibilityRole="alert" style={{ color: tokens.error }}>{error || state.error}</Text> : null}
    {state.ready && state.data ? <>
      <HubTextField label="Поиск переменных" value={search} onChangeText={setSearch} />
      {state.data.items.filter(item => `${item.key} ${item.description || ''}`.toLowerCase().includes(search.toLowerCase())).map(item => <AccountSectionCard key={item.key} tokens={tokens} title={item.key} description={item.description}>
        <HubTextField label={item.is_sensitive ? 'Защищённое значение' : 'Значение'} value={draft[item.key] ?? item.value ?? ''} secureTextEntry={Boolean(item.is_sensitive)} autoCapitalize="none" autoCorrect={false} onChangeText={value => setDraft(previous => ({ ...previous, [item.key]: value }))} />
        <Text style={{ color: tokens.textSecondary }}>{item.apply_target_labels?.join(', ')}</Text>
      </AccountSectionCard>)}
      <AccountPrimaryButton tokens={tokens} label={`Сохранить изменения (${changes.length})`} onPress={save} disabled={!changes.length || state.busy} />
    </> : null}
  </View>;
}
