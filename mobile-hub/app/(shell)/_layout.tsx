import { Redirect, Tabs, usePathname } from 'expo-router';
import { View } from 'react-native';
import { useAuth } from '../../src/auth/AuthContext';
import { resolveNativeAuthRedirect } from '../../src/auth/nativeAuthGuard';
import { BrandedLoader } from '../../src/components/ui/BrandedLoader';
import { HubBottomNav } from '../../src/components/layout/HubBottomNav';
import { HubConnectionProvider } from '../../src/components/layout/HubConnectionHeader';
import { resolveShellTabPath } from '../../src/navigation/nativeAccountRoutes';
import { usePreferences } from '../../src/preferences/PreferencesContext';
import { useFluentTokens } from '../../src/theme/fluentTokens';

function ShellTabs() {
  const pathname = usePathname();
  const { preferences } = usePreferences();
  const tokens = useFluentTokens(preferences.theme_mode);
  const hideBottomNav = /^\/chat\/.+/.test(pathname)
    || /^\/feed\/.+/.test(pathname)
    || /^\/tasks\/.+/.test(pathname)
    || /^\/mail\/.+/.test(pathname)
    || /^\/database\/.+/.test(pathname)
    || /^\/docflow\/.+/.test(pathname)
    || /^\/computers\/.+/.test(pathname)
    || pathname === '/notifications';
  const activePath = resolveShellTabPath(pathname);

  return (
    <View style={[styles.shell, { backgroundColor: tokens.navBg }]}>
      <View style={styles.content}>
        <Tabs
            tabBar={() => <HubBottomNav currentPath={activePath} hidden={hideBottomNav} />}
            screenOptions={{
              headerShown: false,
              freezeOnBlur: true,
              sceneStyle: { backgroundColor: tokens.pageBg },
              tabBarStyle: { position: 'absolute', height: 0, elevation: 0 },
            }}
          >
            <Tabs.Screen name="dashboard" options={{ title: 'Главная' }} />
            <Tabs.Screen name="notifications" options={{ title: 'Уведомления', href: null }} />
            <Tabs.Screen name="menu" options={{ title: 'Меню' }} />
            <Tabs.Screen name="chat" options={{ title: 'Чат', href: null }} />
            <Tabs.Screen name="feed" options={{ title: 'Лента', href: null }} />
            <Tabs.Screen name="address-book" options={{ title: 'Адреса', href: null }} />
            <Tabs.Screen name="tasks" options={{ title: 'Задачи', href: null }} />
            <Tabs.Screen name="mail" options={{ title: 'Почта', href: null }} />
            <Tabs.Screen name="database" options={{ title: 'Инвентарь', href: null }} />
            <Tabs.Screen name="my-files" options={{ title: 'Мой диск', href: null }} />
            <Tabs.Screen name="company-structure" options={{ title: 'Структура', href: null }} />
            <Tabs.Screen name="docflow" options={{ title: '1С ДО', href: null }} />
            <Tabs.Screen name="scan-center" options={{ title: 'Scan Center', href: null }} />
            <Tabs.Screen name="computers" options={{ title: 'Компьютеры', href: null }} />
            <Tabs.Screen name="passwords" options={{ title: 'Пароли', href: null }} />
            <Tabs.Screen name="groups-access" options={{ title: 'Доступ к папкам', href: null }} />
            <Tabs.Screen name="warehouse-1c" options={{ title: 'Склад 1С', href: null }} />
            <Tabs.Screen name="mfu" options={{ title: 'МФУ', href: null }} />
        </Tabs>
      </View>
    </View>
  );
}

const styles = {
  shell: { flex: 1 },
  content: { flex: 1 },
} as const;

export default function ShellLayout() {
  const { user, loading, loginChallengeId } = useAuth();
  const redirect = resolveNativeAuthRedirect({ loading, user, loginChallengeId });

  if (loading) return <BrandedLoader />;
  if (redirect) return <Redirect href={redirect} />;

  return (
    <HubConnectionProvider>
      <ShellTabs />
    </HubConnectionProvider>
  );
}
