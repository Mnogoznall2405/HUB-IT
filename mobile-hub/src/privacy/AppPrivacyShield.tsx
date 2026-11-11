import * as ScreenCapture from 'expo-screen-capture';
import { useEffect } from 'react';
import { AppState, type AppStateStatus } from 'react-native';
import { useAuth } from '../auth/AuthContext';

const PRIVACY_SHIELD_KEY = 'hubit-app-switcher-privacy';

function syncPrivacyShield(authenticated: boolean, state: AppStateStatus): void {
  const action = authenticated && state !== 'active'
    ? ScreenCapture.preventScreenCaptureAsync(PRIVACY_SHIELD_KEY)
    : ScreenCapture.allowScreenCaptureAsync(PRIVACY_SHIELD_KEY);
  void action.catch(() => undefined);
}

export function AppPrivacyShield() {
  const { user } = useAuth();
  const authenticated = Boolean(user);

  useEffect(() => {
    syncPrivacyShield(authenticated, AppState.currentState);
    const subscription = AppState.addEventListener('change', (state) => {
      syncPrivacyShield(authenticated, state);
    });
    return () => {
      subscription.remove();
      void ScreenCapture.allowScreenCaptureAsync(PRIVACY_SHIELD_KEY).catch(() => undefined);
    };
  }, [authenticated]);

  return null;
}
