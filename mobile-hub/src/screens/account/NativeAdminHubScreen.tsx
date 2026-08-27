import { router } from 'expo-router';
import { canAccessAdminArea, getAvailableAdminSections } from '../../account/accountNavigation';
import { useAuth } from '../../auth/AuthContext';
import { usePreferences } from '../../preferences/PreferencesContext';
import { useFluentTokens } from '../../theme/fluentTokens';
import { AccountActionRow, AccountScreenScaffold, AccountSectionCard } from './AccountChrome';
import { goBackOrReplace } from './accountBack';

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
        <AccountSectionCard tokens={tokens} description="В APK показаны только нативные разделы администрирования.">
          {sections.map((section) => (
            <AccountActionRow
              key={section.key}
              tokens={tokens}
              icon={section.icon}
              label={section.label}
              subtitle={section.description}
              testID={`native-admin-section-${section.key}`}
              onPress={() => router.push(section.nativeHref as never)}
            />
          ))}
        </AccountSectionCard>
      )}
    </AccountScreenScaffold>
  );
}
