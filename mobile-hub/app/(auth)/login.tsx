import { router } from 'expo-router';
import { useMemo, useRef, useState, type ComponentRef } from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';
import { useAuth } from '../../src/auth/AuthContext';
import { formatApiError } from '../../src/api/formatError';
import { filterNavItems, firstNavRoute } from '../../src/navigation/navItems';
import { postAuthDestination } from '../../src/navigation/postAuthDestination';
import { HubButton } from '../../src/components/ui/HubButton';
import { HubCard } from '../../src/components/ui/HubCard';
import { HubScreen } from '../../src/components/ui/HubScreen';
import { HubTextField } from '../../src/components/ui/HubTextField';
import { type FluentTokens, useAppFluentTokens } from '../../src/theme/fluentTokens';

export default function LoginScreen() {
  const tokens = useAppFluentTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const {
    biometricEnabled,
    login,
    hasPermission,
    unlockWithBiometrics,
    user,
  } = useAuth();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [biometricSubmitting, setBiometricSubmitting] = useState(false);
  const [invalidField, setInvalidField] = useState<'username' | 'password' | ''>('');
  const usernameRef = useRef<ComponentRef<typeof HubTextField>>(null);
  const passwordRef = useRef<ComponentRef<typeof HubTextField>>(null);

  const onBiometricLogin = async () => {
    setError('');
    setBiometricSubmitting(true);
    try {
      const result = await unlockWithBiometrics();
      const home = firstNavRoute(
        filterNavItems(
          (permission) => result.user.permissions.includes(permission),
          result.user.role,
        ),
      );
      router.replace(postAuthDestination(Platform.OS, home) as never);
    } catch (e: unknown) {
      setError(formatApiError(e, 'Не удалось войти по отпечатку'));
    } finally {
      setBiometricSubmitting(false);
    }
  };

  const onSubmit = async () => {
    if (!username.trim()) {
      setInvalidField('username');
      setError('Введите логин');
      usernameRef.current?.focus();
      return;
    }
    if (!password) {
      setInvalidField('password');
      setError('Введите пароль');
      passwordRef.current?.focus();
      return;
    }
    setInvalidField('');
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
      router.replace(postAuthDestination(Platform.OS, home) as never);
    } catch (e: unknown) {
      setError(formatApiError(e, 'Не удалось войти'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <HubScreen backgroundColor={tokens.pageBg} scroll keyboardAvoiding>
      <View style={styles.hero}>
        <Image
          source={require('../../assets/icon.png')}
          style={styles.logoBadge}
          accessible={false}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        <Text style={styles.title} accessibilityRole="header">HUB-IT</Text>
        <Text style={styles.subtitle}>Внутренний портал · hubit.zsgp.ru</Text>
      </View>
      <HubCard style={styles.card}>
        <HubTextField
          ref={usernameRef}
          label="Логин"
          value={username}
          onChangeText={(value) => {
            setUsername(value);
            if (invalidField === 'username') setInvalidField('');
          }}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="username"
          textContentType="username"
          returnKeyType="next"
          blurOnSubmit={false}
          onSubmitEditing={() => passwordRef.current?.focus()}
          error={invalidField === 'username'}
          accessibilityHint={invalidField === 'username' ? 'Поле обязательно для входа' : undefined}
          style={styles.field}
        />
        <HubTextField
          ref={passwordRef}
          label="Пароль"
          value={password}
          onChangeText={(value) => {
            setPassword(value);
            if (invalidField === 'password') setInvalidField('');
          }}
          secureTextEntry
          autoComplete="current-password"
          textContentType="password"
          returnKeyType="done"
          onSubmitEditing={() => void onSubmit()}
          error={invalidField === 'password'}
          accessibilityHint={invalidField === 'password' ? 'Поле обязательно для входа' : undefined}
          style={styles.field}
        />
        {error ? (
          <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            {error}
          </Text>
        ) : null}
        <HubButton
          mode="contained"
          onPress={onSubmit}
          loading={submitting}
          disabled={submitting}
          style={styles.button}
        >
          Войти
        </HubButton>
        {biometricEnabled ? (
          <>
            <View style={styles.dividerRow} accessibilityElementsHidden>
              <View style={styles.divider} />
              <Text style={styles.dividerText}>или</Text>
              <View style={styles.divider} />
            </View>
            <HubButton
              mode="outlined"
              icon="fingerprint"
              onPress={onBiometricLogin}
              loading={biometricSubmitting}
              disabled={submitting || biometricSubmitting}
              style={styles.button}
              accessibilityLabel="Войти по отпечатку пальца"
            >
              Войти по отпечатку
            </HubButton>
            <Text style={styles.biometricHint}>
              Без интернета откроются только ранее загруженные данные в режиме чтения.
            </Text>
          </>
        ) : null}
      </HubCard>
    </HubScreen>
  );
}

const createStyles = (tokens: FluentTokens) => StyleSheet.create({
  hero: { alignItems: 'center', marginBottom: 24, marginTop: 16 },
  logoBadge: {
    width: 64,
    height: 64,
    borderRadius: 16,
    marginBottom: 12,
  },
  title: { fontSize: 30, fontWeight: '800', color: tokens.textPrimary },
  subtitle: { fontSize: 14, color: tokens.textSecondary, marginTop: 4 },
  card: { borderColor: tokens.borderSoft, borderWidth: 1 },
  field: { marginBottom: 12 },
  button: { marginTop: 8 },
  dividerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 16 },
  divider: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: tokens.borderSoft },
  dividerText: { color: tokens.textSecondary, fontSize: 13 },
  biometricHint: {
    color: tokens.textSecondary,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 8,
    textAlign: 'center',
  },
  error: { color: tokens.error, marginBottom: 8 },
});
