import * as Clipboard from 'expo-clipboard';
import { router } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../src/auth/AuthContext';
import type { TwoFactorSetupResponse } from '../../src/api/types';
import { formatApiError } from '../../src/api/formatError';
import { HubButton } from '../../src/components/ui/HubButton';
import { HubCard } from '../../src/components/ui/HubCard';
import { HubScreen } from '../../src/components/ui/HubScreen';
import { HubTextField } from '../../src/components/ui/HubTextField';
import { type FluentTokens, useAppFluentTokens } from '../../src/theme/fluentTokens';

export default function SetupRequiredScreen() {
  const tokens = useAppFluentTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const { loginChallengeId, startTwoFactorSetup, verifyTwoFactorSetup } = useAuth();
  const [setup, setSetup] = useState<TwoFactorSetupResponse | null>(null);
  const [code, setCode] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const copyGeneration = useRef(0);
  useEffect(() => () => { copyGeneration.current += 1; }, []);
  const completionInProgressRef = useRef(false);

  const loadSetup = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setSetup(await startTwoFactorSetup());
    } catch (cause) {
      setError(formatApiError(cause, 'Не удалось начать настройку 2FA. Войдите снова.'));
    } finally {
      setLoading(false);
    }
  }, [startTwoFactorSetup]);

  useEffect(() => {
    if (backupCodes.length || completionInProgressRef.current) return;
    if (loginChallengeId !== 'setup') {
      router.replace('/(auth)/login');
      return;
    }
    void loadSetup();
  }, [backupCodes.length, loadSetup, loginChallengeId]);

  const verify = useCallback(async () => {
    const normalizedCode = code.replace(/\D/g, '').slice(0, 6);
    if (normalizedCode.length !== 6 || submitting) {
      setError('Введите шестизначный код из приложения-аутентификатора.');
      return;
    }
    copyGeneration.current += 1;
    setCopyStatus('');
    setSubmitting(true);
    setError('');
    completionInProgressRef.current = true;
    try {
      setBackupCodes(await verifyTwoFactorSetup(normalizedCode));
      setSetup(null);
      setCode('');
    } catch (cause) {
      completionInProgressRef.current = false;
      setError(formatApiError(cause, 'Код не подошёл. Проверьте время на телефоне и повторите.'));
    } finally {
      setSubmitting(false);
    }
  }, [code, submitting, verifyTwoFactorSetup]);

  const copyValue = async (value: string) => {
    const generation = ++copyGeneration.current;
    setError('');
    setCopyStatus('');
    try {
      const copied = await Clipboard.setStringAsync(value);
      if (copied === false) throw new Error('Clipboard unavailable');
      if (generation === copyGeneration.current) setCopyStatus('Скопировано');
    } catch {
      if (generation !== copyGeneration.current) return;
      setError('Не удалось скопировать. Выделите текст и скопируйте его вручную.');
    }
  };

  const openAuthenticator = async () => {
    if (!setup) return;
    setError('');
    try {
      await Linking.openURL(setup.otpauth_uri);
    } catch {
      setError('Не удалось открыть аутентификатор. Откройте его самостоятельно и добавьте ключ вручную.');
    }
  };

  if (backupCodes.length) {
    return (
      <HubScreen scroll>
        <HubCard>
          <Text style={styles.title} accessibilityRole="header">Сохраните резервные коды</Text>
          <Text style={styles.body}>Каждый код работает один раз. Храните их отдельно от телефона и не отправляйте другим людям.</Text>
          <View testID="two-factor-backup-codes" style={[styles.codes, { borderColor: tokens.border, backgroundColor: tokens.panelInset }]}>
            {backupCodes.map((backupCode) => <Text key={backupCode} selectable style={[styles.code, { color: tokens.textPrimary }]}>{backupCode}</Text>)}
          </View>
          <HubButton mode="outlined" onPress={() => { void copyValue(backupCodes.join('\n')); }} style={styles.btn}>Скопировать все коды</HubButton>
          {copyStatus ? <Text accessibilityLiveRegion="polite" style={styles.body}>{copyStatus}</Text> : null}
          {error ? <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">{error}</Text> : null}
          <HubButton mode="contained" onPress={() => router.replace('/(auth)/biometric-opt-in')}>Продолжить</HubButton>
        </HubCard>
      </HubScreen>
    );
  }

  return (
    <HubScreen scroll keyboardAvoiding>
      <HubCard>
        <Text style={styles.title} accessibilityRole="header">Настройка 2FA</Text>
        <Text style={styles.body}>
          Добавьте HUB-IT в приложение-аутентификатор, затем подтвердите шестизначный код.
        </Text>
        {loading ? <Text accessibilityLiveRegion="polite" style={styles.body}>Готовим секретный ключ…</Text> : null}
        {setup ? (
          <>
            <View style={[styles.secretCard, { borderColor: tokens.border, backgroundColor: tokens.panelInset }]}>
              <Text style={[styles.secretLabel, { color: tokens.textSecondary }]}>Ключ для ручного ввода</Text>
              <Text testID="two-factor-manual-key" selectable style={[styles.secret, { color: tokens.textPrimary }]}>{setup.manual_entry_key}</Text>
              <Text style={[styles.account, { color: tokens.textSecondary }]}>{setup.issuer} · {setup.account_name}</Text>
            </View>
            <HubButton mode="outlined" onPress={() => { void copyValue(setup.manual_entry_key); }} style={styles.btn}>Скопировать ключ</HubButton>
            <HubButton mode="outlined" onPress={() => { void openAuthenticator(); }} style={styles.btn}>Открыть аутентификатор</HubButton>
            <HubTextField
              testID="two-factor-setup-code"
              label="Шестизначный код"
              value={code}
              onChangeText={(value) => setCode(value.replace(/\D/g, '').slice(0, 6))}
              keyboardType="number-pad"
              textContentType="oneTimeCode"
              autoComplete="one-time-code"
              returnKeyType="done"
              onSubmitEditing={() => { void verify(); }}
              style={styles.field}
            />
            <HubButton testID="two-factor-setup-confirm" mode="contained" onPress={verify} loading={submitting} disabled={submitting || code.length !== 6}>Подтвердить и включить 2FA</HubButton>
          </>
        ) : null}
        {copyStatus ? <Text accessibilityLiveRegion="polite" style={styles.body}>{copyStatus}</Text> : null}
        {error ? <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">{error}</Text> : null}
        {!loading && !setup ? <HubButton mode="outlined" onPress={() => { void loadSetup(); }} style={styles.btn}>Повторить</HubButton> : null}
        <HubButton mode="text" onPress={() => router.replace('/(auth)/login')}>
          Отменить и вернуться ко входу
        </HubButton>
      </HubCard>
    </HubScreen>
  );
}

const createStyles = (tokens: FluentTokens) => StyleSheet.create({
  title: { fontSize: 20, fontWeight: '600', marginBottom: 12, color: tokens.textPrimary },
  body: { fontSize: 15, lineHeight: 22, color: tokens.textSecondary, marginBottom: 16 },
  btn: { marginBottom: 8 },
  secretCard: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 10 },
  secretLabel: { fontSize: 12, fontWeight: '700' },
  secret: { marginTop: 6, fontSize: 18, lineHeight: 25, fontWeight: '800', letterSpacing: 1.2 },
  account: { marginTop: 6, fontSize: 12, lineHeight: 17 },
  field: { marginTop: 6, marginBottom: 12 },
  error: { color: tokens.error, marginTop: 10, marginBottom: 8, fontSize: 13, lineHeight: 18, fontWeight: '700' },
  codes: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12, gap: 5 },
  code: { fontFamily: 'monospace', fontSize: 16, lineHeight: 22, letterSpacing: 0.8 },
});
