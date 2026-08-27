import * as Application from 'expo-application';
import { Text } from 'react-native';
import { MOBILE_UPDATE_PACKAGE_NAME } from '../../updates/mobileUpdate';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens } from '../../theme/fluentTokens';
import { AccountField, AccountScreenScaffold, AccountSectionCard } from './AccountChrome';
import { goBackOrReplace } from './accountBack';

export function NativeAboutSettingsScreen() {
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const version = String(Application.nativeApplicationVersion || '—');
  const build = String(Application.nativeBuildVersion || '—');
  const packageName = String(Application.applicationId || MOBILE_UPDATE_PACKAGE_NAME);

  return (
    <AccountScreenScaffold
      title="О HUB-IT"
      tokens={tokens}
      onBack={() => goBackOrReplace('/(shell)/menu/settings')}
    >
      <AccountSectionCard tokens={tokens} title="Мобильное приложение" description="Канал preview для внутренней установки APK.">
        <AccountField tokens={tokens} label="Версия" value={version} />
        <AccountField tokens={tokens} label="Сборка" value={build} />
        <AccountField tokens={tokens} label="Package" value={packageName} />
        <AccountField tokens={tokens} label="Канал" value="preview" />
        <Text style={{ color: tokens.textSecondary, marginTop: 4, lineHeight: 18 }}>
          Нативное приложение HUB-IT для Android. Доступные разделы работают без перехода в браузер.
        </Text>
      </AccountSectionCard>
    </AccountScreenScaffold>
  );
}
