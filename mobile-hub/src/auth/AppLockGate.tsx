import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import * as ScreenCapture from 'expo-screen-capture';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  Image,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  View,
  type AppStateStatus,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useReducedMotion } from '../accessibility/useReducedMotion';
import { HubButton } from '../components/ui/HubButton';
import { hubTheme } from '../theme/hubTheme';
import { officeTokens } from '../theme/officeTokens';
import { hapticError, hapticSuccess } from '../native/haptics';
import { useAuth } from './AuthContext';
import {
  getAppLockSettings,
  shouldLockAfterBackground,
  subscribeAppLockSettings,
  unlockBiometricAppLock,
  type AppLockSettings,
} from './biometricAuth';

const DEFAULT_SETTINGS: AppLockSettings = { enabled: false, timeoutSeconds: 60 };
const SCREEN_CAPTURE_KEY = 'hubit-app-lock';

export function AppLockGate() {
  const reduceMotion = useReducedMotion();
  const { biometricEnabled, logout, user } = useAuth();
  const [settings, setSettings] = useState<AppLockSettings>(DEFAULT_SETTINGS);
  const [locked, setLocked] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const [error, setError] = useState('');
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);
  const backgroundAtRef = useRef(0);
  const automaticAttemptRef = useRef(false);

  useEffect(() => {
    let active = true;
    void getAppLockSettings().then((value) => {
      if (active) setSettings(value);
    });
    const unsubscribe = subscribeAppLockSettings((value) => {
      if (active) setSettings(value);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [biometricEnabled, user]);

  useEffect(() => {
    if (!user || !biometricEnabled || !settings.enabled) {
      setLocked(false);
      backgroundAtRef.current = 0;
      void ScreenCapture.allowScreenCaptureAsync(SCREEN_CAPTURE_KEY).catch(() => undefined);
    }
  }, [biometricEnabled, settings.enabled, user]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      const previous = appStateRef.current;
      appStateRef.current = nextState;
      if (!user || !biometricEnabled || !settings.enabled) return;
      if (nextState === 'background' && previous !== 'background') {
        backgroundAtRef.current = Date.now();
        void ScreenCapture.preventScreenCaptureAsync(SCREEN_CAPTURE_KEY).catch(() => undefined);
        return;
      }
      if (nextState === 'active' && previous !== 'active' && backgroundAtRef.current > 0) {
        if (shouldLockAfterBackground(backgroundAtRef.current, Date.now(), settings)) {
          automaticAttemptRef.current = false;
          setError('');
          setLocked(true);
        } else {
          backgroundAtRef.current = 0;
          void ScreenCapture.allowScreenCaptureAsync(SCREEN_CAPTURE_KEY).catch(() => undefined);
        }
      }
    });
    return () => {
      subscription.remove();
      void ScreenCapture.allowScreenCaptureAsync(SCREEN_CAPTURE_KEY).catch(() => undefined);
    };
  }, [biometricEnabled, settings.enabled, settings.timeoutSeconds, user]);

  const unlock = useCallback(async () => {
    if (unlocking) return;
    setUnlocking(true);
    setError('');
    try {
      await unlockBiometricAppLock();
      backgroundAtRef.current = 0;
      setLocked(false);
      await ScreenCapture.allowScreenCaptureAsync(SCREEN_CAPTURE_KEY).catch(() => undefined);
      void hapticSuccess();
    } catch (cause: unknown) {
      setError(cause instanceof Error ? cause.message : 'Не удалось подтвердить отпечаток');
      void hapticError();
    } finally {
      setUnlocking(false);
    }
  }, [unlocking]);

  useEffect(() => {
    if (!locked || automaticAttemptRef.current) return;
    automaticAttemptRef.current = true;
    void unlock();
  }, [locked, unlock]);

  return (
    <Modal
      visible={locked}
      animationType={reduceMotion ? 'none' : 'fade'}
      presentationStyle="fullScreen"
      onRequestClose={() => undefined}
      statusBarTranslucent={false}
    >
      <SafeAreaView style={styles.page} accessibilityViewIsModal>
        <ScrollView
          testID="app-lock-scroll"
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.card}>
            <Image
              source={require('../../assets/icon.png')}
              style={styles.logo}
              accessible={false}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
            <MaterialCommunityIcons
              name="fingerprint"
              size={54}
              color={hubTheme.primary}
              accessibilityElementsHidden
              importantForAccessibility="no"
            />
            <Text style={styles.title} accessibilityRole="header">HUB-IT заблокирован</Text>
            <Text style={styles.body}>Подтвердите отпечаток, чтобы вернуться к открытой странице.</Text>
            {error ? (
              <Text style={styles.error} accessibilityRole="alert" accessibilityLiveRegion="assertive">
                {error}
              </Text>
            ) : null}
            <HubButton
              mode="contained"
              icon="fingerprint"
              onPress={() => { void unlock(); }}
              loading={unlocking}
              disabled={unlocking}
              accessibilityLabel="Разблокировать HUB-IT отпечатком пальца"
            >
              Разблокировать
            </HubButton>
            {error.includes('Вход по отпечатку недоступен') ? (
              <HubButton mode="text" onPress={() => { void logout(); }}>
                Войти заново
              </HubButton>
            ) : null}
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: officeTokens.pageBg,
  },
  scroll: {
    flexGrow: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: { width: '100%', maxWidth: 420, alignItems: 'center', gap: 14 },
  logo: { width: 52, height: 52, borderRadius: 13, marginBottom: 10 },
  title: { color: officeTokens.textPrimary, fontSize: 22, lineHeight: 28, fontWeight: '900', textAlign: 'center' },
  body: { color: officeTokens.textSecondary, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  error: { color: hubTheme.error, fontSize: 13, lineHeight: 19, textAlign: 'center' },
});
