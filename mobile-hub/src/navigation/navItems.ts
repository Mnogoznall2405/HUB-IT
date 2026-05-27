import type { ComponentProps } from 'react';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

export type NavItem = {
  name: string;
  label: string;
  title: string;
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  permission?: string;
  adminOnly?: boolean;
  webPath?: string;
};

/** Порядок и права — как в web MainLayout. */
export const NAV_ITEMS: NavItem[] = [
  { name: 'dashboard', label: 'Главная', title: 'Главная', icon: 'view-dashboard-outline', permission: 'dashboard.read' },
  { name: 'tasks', label: 'Задачи', title: 'Задачи', icon: 'checkbox-marked-circle-outline', permission: 'tasks.read' },
  { name: 'tickets', label: 'Билеты', title: 'Билеты', icon: 'ticket-outline', permission: 'tickets.read', webPath: '/tickets' },
  { name: 'chat', label: 'Chat', title: 'Чаты', icon: 'forum-outline', permission: 'chat.read' },
  { name: 'mail', label: 'Почта', title: 'Почта', icon: 'email-outline', permission: 'mail.access', webPath: '/mail' },
  { name: 'address-book', label: 'Адресная книга', title: 'Адресная книга', icon: 'card-account-phone-outline', permission: 'address_book.read', webPath: '/address-book' },
  { name: 'database', label: 'IT-invent WEB', title: 'IT-invent WEB', icon: 'database-outline', permission: 'database.read', webPath: '/database' },
  { name: 'networks', label: 'Сети', title: 'Сети', icon: 'lan', permission: 'networks.read', webPath: '/networks' },
  { name: 'ad-users', label: 'Пользователи AD', title: 'AD', icon: 'account-group-outline', adminOnly: true, webPath: '/ad-users' },
  { name: 'vcs', label: 'ВКС терминалы', title: 'ВКС', icon: 'video-outline', permission: 'vcs.read', webPath: '/vcs' },
  { name: 'mfu', label: 'МФУ', title: 'МФУ', icon: 'printer-outline', permission: 'database.read', webPath: '/mfu' },
  { name: 'computers', label: 'Компьютеры', title: 'Компьютеры', icon: 'desktop-classic', permission: 'computers.read', webPath: '/computers' },
  { name: 'scan-center', label: 'Scan Center', title: 'Scan Center', icon: 'shield-search', permission: 'scan.read', webPath: '/scan-center' },
  { name: 'statistics', label: 'Статистика', title: 'Статистика', icon: 'chart-bar', permission: 'statistics.read', webPath: '/statistics' },
  { name: 'kb', label: 'IT База знаний', title: 'База знаний', icon: 'book-open-variant', permission: 'kb.read', webPath: '/kb' },
  { name: 'settings', label: 'Настройки', title: 'Настройки', icon: 'cog-outline', permission: 'settings.read' },
];

export function filterNavItems(
  hasPermission: (p: string) => boolean,
  role?: string | null,
): NavItem[] {
  const isAdmin = role === 'admin';
  return NAV_ITEMS.filter((item) => {
    if (item.adminOnly && !isAdmin) return false;
    if (!item.permission) return true;
    return hasPermission(item.permission);
  });
}

export function firstNavRoute(items: NavItem[]): string {
  const first = items[0];
  if (!first) return '/(main)/settings';
  return `/(main)/${first.name === 'chat' ? 'chat' : first.name}`;
}
