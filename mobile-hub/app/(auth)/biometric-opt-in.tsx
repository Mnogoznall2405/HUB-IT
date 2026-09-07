import { router } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useAuth } from '../../src/auth/AuthContext';
import {
  getBiometricCapability,
  type BiometricCapability,
} from '../../src/auth/biometricAuth';
import { formatApiError } from '../../src/api/formatError';
import { filterNavItems, firstNavRoute } from '../../src/navigation/navItems';
import { postAuthDestination } from '../../src/navigation/postAuthDestination';
import { HubButton } from '../../src/components/ui/HubButton';
import { HubCard } from '../../src/components/ui/HubCard';
import { HubScreen } from '../../src/components/ui/HubScreen';
import { type FluentTokens, useAppFluentTokens } from '../../src/theme/fluentTokens';

export default function BiometricOptInScreen() {
  const tokens = useAppFluentTokens();
  const styles = useMemo(() => createStyles(tokens), [tokens]);
  const { enableBiometrics, hasPermission, skipBiometrics, user } = useAuth();
  const [capability, setCapability] = useState<BiometricCapability | null>(null);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const actionInProgressRef = useRef(false);

  useEffect(() => {
    if (!user) {
      router.replace('/(auth)/login');
      return;
    }
    void getBiometricCapability()
      .then(setCapability)
      .catch(() => setCapability({ available: false, enrolled: false, fingerprint: false }));
  }, [user]);

  const continueToPortal = () => {
    const home = firstNavRoute(filterNavItems(hasPermission, user?.role));
    router.replace(postAuthDestination(Platform.OS, home) as never);
  };

  const onEnable = async () => {
    if (actionInProgressRef.current) return;
    actionInProgressRef.current = true;
    setError('');
    setSubmitting(true);
    try {
      await enableBiometrics();
      continueToPortal();
    } catch (cause: unknown) {
      setError(formatApiError(cause, 'Не удалось включить вход по отпечатку'));
    } finally {
      actionInProgressRef.current = false;
      setSubmitting(false);
    }
  };

  const onSkip = async () => {
    if (actionInProgressRef.current) return;
    actionInProgressRef.current = true;
    setError('');
    setSubmitting(true);
    try {
      await skipBiometrics();
      continueToPortal();
    } catch {
      setError('Не удалось сохранить выбор. Попробуйте ещё раз.');
    } finally {
      actionInProgressRef.current = false;
      setSubmitting(false);
    }
  };

  const supported = Boolean(
    capability?.available && capability.enrolled && capability.fingerprint,
  );

  return (
    <HubScreen scroll>
      <HubCard style={styles.card}>
        <MaterialCommunityIcons
          name="fingerprint"
          size={48}
          color={tokens.primary}
          style={styles.icon}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
        <Text style={styles.title} accessibilityRole="header">Вход по отпечатку</Text>
        <Text style={styles.body}>
          Входите по отпечатку на этом телефоне. Его можно отключить в настройках приложения.
          Иногда потребуется снова подтвердить вход паролем и кодом.
        </Text>
        <Text style={styles.body}>
          Без интернета доступны только ранее загруженные данные в режиме чтения.
          «Не сейчас» оставляет обычный вход по логину и паролю.
        </Text>
        {capability && !supported ? (
          <Text style={styles.notice} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            На телефоне не найден настроенный отпечаток. Добавьте его в настройках Android,
            затем войдите снова.
          </Text>
        ) : null}
        {error ? (
          <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">
            {error}
          </Text>
        ) : null}
        <HubButton
          mode="contained"
          icon="fingerprint"
          onPress={onEnable}
          loading={submitting && supported}
          disabled={!supported || submitting}
          accessibilityLabel="Включить вход по отпечатку пальца"
        >
          Включить вход по отпечатку
        </HubButton>
        <HubButton mode="text" onPress={onSkip} disabled={submitting}>
          Не сейчас
        </HubButton>
      </HubCard>
    </HubScreen>
  );
}

const createStyles = (tokens: FluentTokens) => StyleSheet.create({
  card: { width: '100%', maxWidth: 520, alignSelf: 'center', gap: 12 },
  icon: { alignSelf: 'center' },
  title: {
    color: tokens.textPrimary,
    fontSize: 22,
    fontWeight: '800',
    lineHeight: 28,
    textAlign: 'center',
  },
  body: { color: tokens.textSecondary, fontSize: 14, lineHeight: 21 },
  notice: {
    color: tokens.warning,
    backgroundColor: tokens.scheme === 'dark' ? 'rgba(255, 185, 0, 0.12)' : '#fff7e6',
    borderRadius: 8,
    padding: 12,
    fontSize: 13,
    lineHeight: 19,
  },
  error: { color: tokens.error, fontSize: 13, lineHeight: 19 },
});
