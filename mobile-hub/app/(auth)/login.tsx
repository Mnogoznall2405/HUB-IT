import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../src/auth/AuthContext';
import { formatApiError } from '../../src/api/formatError';
import { filterNavItems, firstNavRoute } from '../../src/navigation/navItems';
import { HubButton } from '../../src/components/ui/HubButton';
import { HubCard } from '../../src/components/ui/HubCard';
import { HubScreen } from '../../src/components/ui/HubScreen';
import { HubTextField } from '../../src/components/ui/HubTextField';
import { hubTheme } from '../../src/theme/hubTheme';
import { officeTokens } from '../../src/theme/officeTokens';

export default function LoginScreen() {
  const { login, hasPermission, user } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async () => {
    setError('');
    setSubmitting(true);
    try {
      const result = await login(username.trim(), password);
      if (result.status === '2fa_setup_required') {
        router.replace('/(auth)/setup-required');
        return;
      }
      if (result.status === '2fa_required') {
        router.replace('/(auth)/two-factor');
        return;
      }
      const role = result.user?.role ?? user?.role;
      const home = firstNavRoute(
        filterNavItems(
          (p) => result.user?.permissions?.includes(p) ?? hasPermission(p),
          role,
        ),
      );
      router.replace(home as never);
    } catch (e: unknown) {
      setError(formatApiError(e, 'Не удалось войти'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <HubScreen backgroundColor={officeTokens.pageBg}>
      <View style={styles.hero}>
        <View style={styles.logoBadge}>
          <Text style={styles.logoText}>H</Text>
        </View>
        <Text style={styles.title}>HUB-IT</Text>
        <Text style={styles.subtitle}>Внутренний портал · hubit.zsgp.ru</Text>
      </View>
      <HubCard style={styles.card}>
        <HubTextField
          label="Логин"
          value={username}
          onChangeText={setUsername}
          autoCapitalize="none"
          style={styles.field}
        />
        <HubTextField
          label="Пароль"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          style={styles.field}
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <HubButton mode="contained" onPress={onSubmit} loading={submitting} style={styles.button}>
          Войти
        </HubButton>
      </HubCard>
    </HubScreen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', marginBottom: 24, marginTop: 16 },
  logoBadge: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: hubTheme.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  logoText: { color: '#fff', fontSize: 32, fontWeight: '800' },
  title: { fontSize: 30, fontWeight: '800', color: officeTokens.textPrimary },
  subtitle: { fontSize: 14, color: officeTokens.textSecondary, marginTop: 4 },
  card: { borderColor: officeTokens.borderSoft, borderWidth: 1 },
  field: { marginBottom: 12 },
  button: { marginTop: 8 },
  error: { color: hubTheme.error, marginBottom: 8 },
});
