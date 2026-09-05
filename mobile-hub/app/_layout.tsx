import '../src/notifications/notificationBackgroundTask';
import '../src/lifecycle/mobileBackgroundSync';
import { Stack } from 'expo-router';
import { useMemo } from 'react';
import { StatusBar } from 'expo-status-bar';
import { PaperProvider } from 'react-native-paper';
import { AuthProvider } from '../src/auth/AuthContext';
import { PreferencesProvider, usePreferences } from '../src/preferences/PreferencesContext';
import { AppLifecycle } from '../src/lifecycle/AppLifecycle';
import { AppLockGate } from '../src/auth/AppLockGate';
import { createPaperTheme } from '../src/theme/paperTheme';
import { FluentThemeContext, useFluentTokens } from '../src/theme/fluentTokens';
import { MobileUpdateGate } from '../src/updates/MobileUpdateGate';
import { MobileUpdateProvider } from '../src/updates/useMobileUpdater';
import { DiagnosticsErrorBoundary } from '../src/diagnostics/DiagnosticsErrorBoundary';
import { ReleaseHealthTracker } from '../src/diagnostics/ReleaseHealthTracker';
import { IncomingShareGate } from '../src/share/IncomingShareGate';
import { AppPrivacyShield } from '../src/privacy/AppPrivacyShield';
import { AndroidSystemUi } from '../src/lifecycle/AndroidSystemUi';

export default function RootLayout() {
  return (
    <AuthProvider>
      <PreferencesProvider>
        <MobileUpdateProvider>
          <ThemedRoot />
        </MobileUpdateProvider>
      </PreferencesProvider>
    </AuthProvider>
  );
}

function ThemedRoot() {
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const dark = tokens.scheme === 'dark';
  const theme = useMemo(() => createPaperTheme(tokens.scheme), [tokens.scheme]);

  return (
    <FluentThemeContext.Provider value={tokens}>
      <PaperProvider theme={theme}>
        <StatusBar style={dark ? 'light' : 'dark'} />
        <AndroidSystemUi navigationBarStyle={dark ? 'light' : 'dark'} />
        <ReleaseHealthTracker />
        <DiagnosticsErrorBoundary>
          <AppLifecycle />
          <AppPrivacyShield />
          <Stack
            screenOptions={{
              headerShown: false,
              contentStyle: { backgroundColor: tokens.pageBg },
            }}
          />
        </DiagnosticsErrorBoundary>
        <AppLockGate />
        <MobileUpdateGate />
        <IncomingShareGate />
      </PaperProvider>
    </FluentThemeContext.Provider>
  );
}
