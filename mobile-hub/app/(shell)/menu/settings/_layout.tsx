import { useReducedMotion } from '../../../../src/accessibility/useReducedMotion';
import { Stack } from 'expo-router';
import { usePreferences } from '../../../../src/preferences/PreferencesContext';
import { useFluentTokens } from '../../../../src/theme/fluentTokens';

export default function ShellMenuSettingsLayout() {
  const reduceMotion = useReducedMotion();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: reduceMotion ? 'none' : 'slide_from_right',
        contentStyle: { backgroundColor: tokens.pageBg },
        freezeOnBlur: true,
      }}
    />
  );
}
