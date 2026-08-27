import { Stack } from 'expo-router';
import { usePreferences } from '../../../src/preferences/PreferencesContext';
import { useFluentTokens } from '../../../src/theme/fluentTokens';

export default function ShellAddressBookLayout() {
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: 'fade',
        contentStyle: { backgroundColor: tokens.pageBg },
        freezeOnBlur: true,
      }}
    />
  );
}
