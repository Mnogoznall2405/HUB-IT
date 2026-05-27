import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useAuth } from '../../src/auth/AuthContext';
import { formatApiError } from '../../src/api/formatError';
import { filterNavItems, firstNavRoute } from '../../src/navigation/navItems';
import { HubButton } from '../../src/components/ui/HubButton';
import { HubCard } from '../../src/components/ui/HubCard';
import { HubTextField } from '../../src/components/ui/HubTextField';
import { HubScreen } from '../../src/components/ui/HubScreen';
import { hubTheme } from '../../src/theme/hubTheme';

export default function TwoFactorScreen() {
  const { verifyTwoFactor, loginChallengeId, hasPermission, user } = useAuth();
  const [code, setCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  if (!loginChallengeId) {
    router.replace('/(auth)/login');
  }

  const onSubmit = async () => {
    setError('');
    setSubmitting(true);
    try {
      await verifyTwoFactor(code.trim(), useBackup);
      const home = firstNavRoute(filterNavItems(hasPermission, user?.role));
      router.replace(home as never);
    } catch (e: unknown) {
      setError(formatApiError(e, 'Неверный код'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <HubScreen>
      <HubCard>
        <Text style={styles.title}>Двухфакторная аутентификация</Text>
        <HubTextField
          label={useBackup ? 'Резервный код' : 'Код из приложения'}
          value={code}
          onChangeText={setCode}
          style={styles.field}
        />
        <HubButton mode="text" onPress={() => setUseBackup((v) => !v)}>
          {useBackup ? 'Использовать TOTP' : 'Использовать резервный код'}
        </HubButton>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <HubButton mode="contained" onPress={onSubmit} loading={submitting}>
          Подтвердить
        </HubButton>
      </HubCard>
    </HubScreen>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 20, fontWeight: '600', marginBottom: 12, color: hubTheme.textPrimary },
  field: { marginBottom: 12 },
  error: { color: hubTheme.error, marginBottom: 8 },
});
