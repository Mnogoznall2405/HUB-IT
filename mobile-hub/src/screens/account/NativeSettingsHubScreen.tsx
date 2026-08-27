import { router } from 'expo-router';
import { PERSONAL_SETTINGS_SECTIONS } from '../../account/accountNavigation';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens } from '../../theme/fluentTokens';
import { AccountActionRow, AccountScreenScaffold, AccountSectionCard } from './AccountChrome';
import { goBackOrReplace } from './accountBack';

export function NativeSettingsHubScreen() {
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);

  return (
    <AccountScreenScaffold
      title="Настройки"
      tokens={tokens}
      onBack={() => goBackOrReplace('/(shell)/menu')}
    >
      <AccountSectionCard tokens={tokens} description="Личные настройки этого устройства и учётной записи.">
        {PERSONAL_SETTINGS_SECTIONS.map((section) => (
          <AccountActionRow
            key={section.key}
            tokens={tokens}
            icon={section.icon}
            label={section.label}
            subtitle={section.description}
            testID={`native-settings-section-${section.key}`}
            onPress={() => router.push(section.nativeHref as never)}
          />
        ))}
      </AccountSectionCard>
    </AccountScreenScaffold>
  );
}
