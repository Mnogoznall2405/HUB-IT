import { Stack } from 'expo-router';
import { usePreferences } from '../../../src/preferences/PreferencesContext';
import { useFluentTokens } from '../../../src/theme/fluentTokens';

export default function ShellFeedLayout() {
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'slide_from_right',
        contentStyle: { backgroundColor: tokens.pageBg },
        freezeOnBlur: true,
      }}
    />
  );
}
