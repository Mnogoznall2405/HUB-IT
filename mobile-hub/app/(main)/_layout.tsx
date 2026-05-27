import { Drawer } from 'expo-router/drawer';
import { useAuth } from '../../src/auth/AuthContext';
import { HubDrawerContent } from '../../src/components/layout/HubDrawerContent';
import { BrandedLoader } from '../../src/components/ui/BrandedLoader';
import { filterNavItems } from '../../src/navigation/navItems';
import { hubTheme } from '../../src/theme/hubTheme';
import { officeTokens } from '../../src/theme/officeTokens';

export default function MainDrawerLayout() {
  const { user, loading, hasPermission } = useAuth();
  if (loading) return <BrandedLoader />;
  const items = filterNavItems(hasPermission, user?.role);
  const allowed = new Set(items.map((i) => i.name));

  const screen = (name: string, title: string) =>
    allowed.has(name) ? { title, drawerLabel: title } : { href: null };

  return (
    <Drawer
      drawerContent={(props) => <HubDrawerContent {...props} />}
      screenOptions={{
        headerStyle: { backgroundColor: officeTokens.shellBg },
        headerTintColor: hubTheme.primary,
        headerTitleStyle: { fontWeight: '700' },
        drawerActiveTintColor: hubTheme.primary,
        drawerInactiveTintColor: officeTokens.textSecondary,
        drawerStyle: { backgroundColor: officeTokens.navBg, width: 280 },
      }}
    >
      <Drawer.Screen name="dashboard" options={screen('dashboard', 'Главная')} />
      <Drawer.Screen name="tasks" options={screen('tasks', 'Задачи')} />
      <Drawer.Screen name="tickets" options={screen('tickets', 'Билеты')} />
      <Drawer.Screen name="chat" options={{ ...screen('chat', 'Chat'), headerShown: false }} />
      <Drawer.Screen name="mail" options={screen('mail', 'Почта')} />
      <Drawer.Screen name="address-book" options={screen('address-book', 'Адресная книга')} />
      <Drawer.Screen name="database" options={screen('database', 'IT-invent WEB')} />
      <Drawer.Screen name="networks" options={screen('networks', 'Сети')} />
      <Drawer.Screen name="ad-users" options={screen('ad-users', 'Пользователи AD')} />
      <Drawer.Screen name="vcs" options={screen('vcs', 'ВКС')} />
      <Drawer.Screen name="mfu" options={screen('mfu', 'МФУ')} />
      <Drawer.Screen name="computers" options={screen('computers', 'Компьютеры')} />
      <Drawer.Screen name="scan-center" options={screen('scan-center', 'Scan Center')} />
      <Drawer.Screen name="statistics" options={screen('statistics', 'Статистика')} />
      <Drawer.Screen name="kb" options={screen('kb', 'База знаний')} />
      <Drawer.Screen name="settings" options={screen('settings', 'Настройки')} />
    </Drawer>
  );
}
