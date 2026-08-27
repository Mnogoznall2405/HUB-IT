import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useAuth } from '../../src/auth/AuthContext';
import { formatApiError } from '../../src/api/formatError';
import { HubButton } from '../../src/components/ui/HubButton';
import { HubCard } from '../../src/components/ui/HubCard';
import { HubTextField } from '../../src/components/ui/HubTextField';
import { HubScreen } from '../../src/components/ui/HubScreen';
import { type FluentTokens, useAppFluentTokens } from '../../src/theme/fluentTokens';

export default function TwoFactorScreen() {
  const tokens = useAppFluentTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const { verifyTwoFactor, loginChallengeId } = useAuth();
  const [code, setCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const verificationInProgressRef = useRef(false);

  useEffect(() => {
    if (!loginChallengeId && !verificationInProgressRef.current) {
      router.replace('/(auth)/login');
    }
  }, [loginChallengeId]);

  const onSubmit = async () => {
    if (!code.trim()) {
      setError(useBackup ? 'Введите резервный код' : 'Введите код из приложения');
      return;
    }
    setError('');
    setSubmitting(true);
    verificationInProgressRef.current = true;
    try {
      await verifyTwoFactor(code.trim(), useBackup);
      router.replace('/(auth)/biometric-opt-in');
    } catch (e: unknown) {
      verificationInProgressRef.current = false;
      setError(formatApiError(e, 'Неверный код'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <HubScreen scroll keyboardAvoiding>
      <HubCard>
        <Text style={styles.title} accessibilityRole="header">Двухфакторная аутентификация</Text>
        <HubTextField
          label={useBackup ? 'Резервный код' : 'Код из приложения'}
          value={code}
          onChangeText={setCode}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType={useBackup ? 'default' : 'number-pad'}
          textContentType={useBackup ? 'none' : 'oneTimeCode'}
          autoComplete={useBackup ? 'off' : 'one-time-code'}
          returnKeyType="done"
          onSubmitEditing={() => void onSubmit()}
          style={styles.field}
        />
        <HubButton
          mode="text"
          onPress={() => setUseBackup((v) => !v)}
          accessibilityHint="Меняет способ подтверждения, введённый код не отправляется"
        >
          {useBackup ? 'Использовать TOTP' : 'Использовать резервный код'}
        </HubButton>
        {error ? (
          <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            {error}
          </Text>
        ) : null}
        <HubButton mode="contained" onPress={onSubmit} loading={submitting} disabled={submitting}>
          Подтвердить
        </HubButton>
      </HubCard>
    </HubScreen>
  );
}

const createStyles = (tokens: FluentTokens) => StyleSheet.create({
  title: { fontSize: 20, fontWeight: '600', marginBottom: 12, color: tokens.textPrimary },
  field: { marginBottom: 12 },
  error: { color: tokens.error, marginBottom: 8 },
});
