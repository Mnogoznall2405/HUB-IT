import { Redirect } from 'expo-router';
import { useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { BrandedLoader } from '../src/components/ui/BrandedLoader';
import { HubButton } from '../src/components/ui/HubButton';
import { useAuth } from '../src/auth/AuthContext';
import { formatApiError } from '../src/api/formatError';
import { filterNavItems, firstNavRoute } from '../src/navigation/navItems';
import { postAuthDestination } from '../src/navigation/postAuthDestination';
import { needsNativeAboutOnboarding } from '../src/auth/nativeAuthGuard';
import { useAppFluentTokens } from '../src/theme/fluentTokens';

export default function Index() {
  const {
    user, loading, loginChallengeId, hasPermission, biometricEnabled, unlockWithBiometrics,
  } = useAuth();
  const tokens = useAppFluentTokens();
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState('');

  const onBiometricUnlock = async () => {
    if (unlocking) return;
    setUnlocking(true);
    setUnlockError('');
    try {
      // On success `user` is set and this screen redirects below — including a
      // pending deep link — without waiting for the network session check.
      await unlockWithBiometrics();
    } catch (cause: unknown) {
      setUnlockError(formatApiError(cause, 'Не удалось войти по отпечатку'));
    } finally {
      setUnlocking(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.screen}>
        <BrandedLoader />
        {biometricEnabled ? (
          <View style={styles.biometricDock}>
            <HubButton
              mode="outlined"
              icon="fingerprint"
              onPress={() => { void onBiometricUnlock(); }}
              loading={unlocking}
              disabled={unlocking}
              accessibilityLabel="Войти по отпечатку пальца"
            >
              Войти по отпечатку
            </HubButton>
            {unlockError ? (
              <Text accessibilityRole="alert" style={[styles.unlockError, { color: tokens.error }]}>
                {unlockError}
              </Text>
            ) : null}
          </View>
        ) : null}
      </View>
    );
  }
  if (loginChallengeId === 'setup') return <Redirect href="/(auth)/setup-required" />;
  if (loginChallengeId) return <Redirect href="/(auth)/two-factor" />;
  if (!user) return <Redirect href="/(auth)/login" />;
  if (needsNativeAboutOnboarding(user)) return <Redirect href="/(auth)/about-onboarding" />;

  const home = firstNavRoute(filterNavItems(hasPermission, user.role));
  return <Redirect href={postAuthDestination(Platform.OS, home) as never} />;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  biometricDock: {
    position: 'absolute',
    left: 24,
    right: 24,
    bottom: 48,
  },
  unlockError: {
    marginTop: 10,
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
  },
});
