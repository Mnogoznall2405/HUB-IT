import { router } from 'expo-router';
import { useAuth } from '../../auth/AuthContext';
import { canAccessAdminArea } from '../../account/accountNavigation';
import { accountNavTone, PERSONAL_SETTINGS_SECTIONS } from '../../account/accountNavigation';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens } from '../../theme/fluentTokens';
import { AccountNavGroup, AccountNavRow, AccountScreenScaffold } from './AccountChrome';
import { goBackOrReplace } from './accountBack';

const SECTION_GROUPS: Array<{ title: string; keys: string[] }> = [
  { title: 'Персональные', keys: ['appearance', 'notifications', 'security'] },
  { title: 'Приложение', keys: ['app', 'about'] },
];

export function NativeSettingsHubScreen() {
  const access = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);

  return (
    <AccountScreenScaffold
      title="Настройки"
      tokens={tokens}
      onBack={() => goBackOrReplace('/(shell)/menu')}
    >
      {SECTION_GROUPS.map((group) => {
        const sections = PERSONAL_SETTINGS_SECTIONS.filter((section) => group.keys.includes(section.key));
        if (!sections.length) return null;
        return (
          <AccountNavGroup key={group.title} title={group.title} tokens={tokens}>
            {sections.map((section) => {
              const tone = accountNavTone(section.key);
              return (
                <AccountNavRow
                  key={section.key}
                  tokens={tokens}
                  icon={section.icon}
                  iconColor={tone.foreground}
                  iconBackground={tone.background}
                  label={section.label}
                  subtitle={section.description}
                  testID={`native-settings-section-${section.key}`}
                  onPress={() => router.push(section.nativeHref as never)}
                />
              );
            })}
          </AccountNavGroup>
        );
      })}
      {canAccessAdminArea(access) ? (
        <AccountNavGroup title="Управление" tokens={tokens}>
          <AccountNavRow
            tokens={tokens}
            icon="shield-account-outline"
            iconColor={accountNavTone('admin').foreground}
            iconBackground={accountNavTone('admin').background}
            label="Администрирование"
            subtitle="Пользователи, права, отделы и системные настройки"
            testID="native-settings-section-admin"
            onPress={() => router.push('/(shell)/menu/admin' as never)}
          />
        </AccountNavGroup>
      ) : null}
    </AccountScreenScaffold>
  );
}
