import type { ComponentProps } from 'react';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';

export type NavItem = {
  name: string;
  label: string;
  shortLabel?: string;
  title: string;
  icon: ComponentProps<typeof MaterialCommunityIcons>['name'];
  permission?: string;
  adminOnly?: boolean;
};

/** Нативные разделы мобильного приложения. */
export const NAV_ITEMS: NavItem[] = [
  { name: 'dashboard', label: 'Главная', shortLabel: 'Главная', title: 'Главная', icon: 'view-dashboard-outline', permission: 'dashboard.read' },
  { name: 'tasks', label: 'Задачи', shortLabel: 'Задачи', title: 'Задачи', icon: 'checkbox-marked-circle-outline', permission: 'tasks.read' },
  { name: 'chat', label: 'Chat', shortLabel: 'Чат', title: 'Чаты', icon: 'forum-outline', permission: 'chat.read' },
  { name: 'settings', label: 'Настройки', shortLabel: 'Настройки', title: 'Настройки', icon: 'cog-outline', permission: 'settings.read' },
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
  if (!first) return '/(shell)/dashboard';
  if (first.name === 'chat') return '/(shell)/chat';
  if (first.name === 'dashboard') return '/(shell)/dashboard';
  return '/(shell)/dashboard';
}
