import { router } from 'expo-router';
import {
  accountNavTone,
  canAccessAdminArea,
  getAvailableAdminSections,
} from '../../account/accountNavigation';
import { useAuth } from '../../auth/AuthContext';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens } from '../../theme/fluentTokens';
import {
  AccountNavGroup,
  AccountNavRow,
  AccountScreenScaffold,
  AccountSectionCard,
} from './AccountChrome';
import { goBackOrReplace } from './accountBack';

const SECTION_GROUPS: Array<{ title: string; keys: string[] }> = [
  { title: 'Пользователи и доступ', keys: ['users', 'departments', 'ad-users', 'sessions'] },
  { title: 'Система', keys: ['ai-bots', 'system'] },
];

export function NativeAdminHubScreen() {
  const { user, hasPermission } = useAuth();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const sections = getAvailableAdminSections({ user, hasPermission });
  const allowed = canAccessAdminArea({ user, hasPermission });

  return (
    <AccountScreenScaffold
      title="Администрирование"
      tokens={tokens}
      onBack={() => goBackOrReplace('/(shell)/menu')}
    >
      {!allowed ? (
        <AccountSectionCard tokens={tokens} title="Нет доступа" description="Этот раздел доступен администраторам и сотрудникам с правами управления.">
          {null}
        </AccountSectionCard>
      ) : (
        SECTION_GROUPS.map((group) => {
          const groupSections = sections.filter((section) => group.keys.includes(section.key));
          if (!groupSections.length) return null;
          return (
            <AccountNavGroup key={group.title} title={group.title} tokens={tokens}>
              {groupSections.map((section) => {
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
                    testID={`native-admin-section-${section.key}`}
                    onPress={() => router.push(section.nativeHref as never)}
                  />
                );
              })}
            </AccountNavGroup>
          );
        })
      )}
    </AccountScreenScaffold>
  );
}
