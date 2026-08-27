import type { ComponentProps } from 'react';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { NATIVE_CHAT_ENABLED } from '../chat/nativeChatFeature';
import { NATIVE_COMPANY_STRUCTURE_ENABLED } from '../companyStructure/nativeCompanyStructureFeature';
import { NATIVE_COMPUTERS_ENABLED } from '../computers/nativeComputersFeature';
import { NATIVE_DATABASE_ENABLED } from '../database/nativeDatabaseFeature';
import { NATIVE_DOCFLOW_ENABLED } from '../docflow/nativeDocflowFeature';
import { NATIVE_GROUPS_ACCESS_ENABLED } from '../groupsAccess/nativeGroupsAccessFeature';
import { NATIVE_MAIL_ENABLED } from '../mail/nativeMailFeature';
import { NATIVE_MFU_ENABLED } from '../mfu/nativeMfuFeature';
import { NATIVE_MY_FILES_ENABLED } from '../myFiles/nativeMyFilesFeature';
import { NATIVE_PASSWORDS_ENABLED } from '../passwords/nativePasswordsFeature';
import { DEFAULT_MOBILE_BOTTOM_NAV_ITEMS } from '../preferences/preferenceNormalizers';
import { NATIVE_SCAN_CENTER_ENABLED } from '../scanCenter/nativeScanCenterFeature';
import { NATIVE_TASKS_ENABLED } from '../tasks/nativeTasksFeature';
import { NATIVE_WAREHOUSE_1C_ENABLED } from '../warehouse1c/nativeWarehouse1cFeature';

export type NavIconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export type MobileNavItem = {
  path: string;
  label: string;
  shortLabel: string;
  icon: NavIconName;
  permission?: string;
  adminOnly?: boolean;
  group: 'main' | 'tools' | 'menu';
};

function whenNative(enabled: boolean, item: MobileNavItem): MobileNavItem[] {
  return enabled ? [item] : [];
}

export const navigationItems: MobileNavItem[] = [
  { path: '/dashboard', label: 'Главная', shortLabel: 'Главная', icon: 'view-dashboard', permission: 'dashboard.read', group: 'main' },
  { path: '/feed', label: 'Лента', shortLabel: 'Лента', icon: 'newspaper-variant-outline', permission: 'dashboard.read', group: 'main' },
  ...whenNative(NATIVE_TASKS_ENABLED, { path: '/tasks', label: 'Задачи', shortLabel: 'Задачи', icon: 'check-circle-outline', permission: 'tasks.read', group: 'main' }),
  ...whenNative(NATIVE_CHAT_ENABLED, {
    path: '/chat',
    label: 'Корпоративный чат',
    shortLabel: 'Чат',
    icon: 'forum-outline',
    permission: 'chat.read',
    group: 'main',
  }),
  ...whenNative(NATIVE_MAIL_ENABLED, { path: '/mail', label: 'Почта', shortLabel: 'Почта', icon: 'email-outline', permission: 'mail.access', group: 'main' }),
  ...whenNative(NATIVE_DOCFLOW_ENABLED, { path: '/docflow', label: 'Документооборот', shortLabel: 'Документы', icon: 'file-document-outline', permission: 'docflow.read', group: 'main' }),
  { path: '/address-book', label: 'Адресная книга', shortLabel: 'Адреса', icon: 'card-account-phone-outline', permission: 'address_book.read', group: 'tools' },
  ...whenNative(NATIVE_COMPANY_STRUCTURE_ENABLED, { path: '/company-structure', label: 'Структура компании', shortLabel: 'Структура', icon: 'file-tree-outline', permission: 'company_structure.read', group: 'tools' }),
  ...whenNative(NATIVE_PASSWORDS_ENABLED, { path: '/passwords', label: 'Пароли', shortLabel: 'Пароли', icon: 'key-outline', permission: 'passwords.read', group: 'tools' }),
  ...whenNative(NATIVE_GROUPS_ACCESS_ENABLED, { path: '/groups-access', label: 'Доступ к папкам', shortLabel: 'Доступ', icon: 'folder-account-outline', permission: 'groups_access.read', group: 'tools' }),
  ...whenNative(NATIVE_MY_FILES_ENABLED, { path: '/my-files', label: 'Мой диск', shortLabel: 'Диск', icon: 'folder-open-outline', permission: 'my_files.read', group: 'tools' }),
  ...whenNative(NATIVE_DATABASE_ENABLED, { path: '/database', label: 'Инвентарь', shortLabel: 'Учёт', icon: 'database', permission: 'database.read', group: 'tools' }),
  ...whenNative(NATIVE_MFU_ENABLED, { path: '/mfu', label: 'МФУ', shortLabel: 'МФУ', icon: 'printer-outline', permission: 'mfu.read', group: 'tools' }),
  ...whenNative(NATIVE_COMPUTERS_ENABLED, { path: '/computers', label: 'Компьютеры', shortLabel: 'ПК', icon: 'desktop-classic', permission: 'computers.read', group: 'tools' }),
  ...whenNative(NATIVE_SCAN_CENTER_ENABLED, { path: '/scan-center', label: 'Scan Center', shortLabel: 'Scan', icon: 'shield-search', permission: 'scan.read', group: 'tools' }),
  ...whenNative(NATIVE_WAREHOUSE_1C_ENABLED, { path: '/warehouse-1c', label: 'Склад 1С', shortLabel: 'Склад 1С', icon: 'package-variant-closed', permission: 'warehouse_1c.read', group: 'tools' }),
];

export const mobileMenuNavigationItem: MobileNavItem = {
  path: '/menu',
  label: 'Меню',
  shortLabel: 'Меню',
  icon: 'menu',
  group: 'menu',
};

export const ADMIN_AREA_PERMISSIONS = [
  'departments.manage',
  'settings.users.manage',
  'settings.sessions.manage',
];

export function isAdminUser(user: { role?: string | null } | null | undefined): boolean {
  return String(user?.role || '').trim().toLowerCase() === 'admin';
}

export function canAccessNavigationItem(
  item: MobileNavItem | null | undefined,
  { user, hasPermission }: { user?: { role?: string | null } | null; hasPermission: (permission: string) => boolean },
): boolean {
  if (!item) return false;
  if (item.adminOnly) return isAdminUser(user);
  return !item.permission || hasPermission(item.permission);
}

export function canAccessAdminArea({
  user,
  hasPermission,
}: {
  user?: { role?: string | null } | null;
  hasPermission: (permission: string) => boolean;
}): boolean {
  if (isAdminUser(user)) return true;
  return ADMIN_AREA_PERMISSIONS.some((permission) => hasPermission(permission));
}

export function getVisibleNavigationItems({
  user,
  hasPermission,
}: {
  user?: { role?: string | null } | null;
  hasPermission: (permission: string) => boolean;
}): MobileNavItem[] {
  return navigationItems.filter((item) => canAccessNavigationItem(item, { user, hasPermission }));
}

export function resolveMobileNavigationItems({
  selectedPaths,
  user,
  hasPermission,
}: {
  selectedPaths?: unknown;
  user?: { role?: string | null } | null;
  hasPermission: (permission: string) => boolean;
}): MobileNavItem[] {
  const visibleItems = getVisibleNavigationItems({ user, hasPermission });
  const visiblePathSet = new Set(visibleItems.map((item) => item.path));
  const selectedPathSet = new Set<string>();

  const addVisiblePath = (path: unknown) => {
    const normalizedPath = String(path || '').trim();
    if (selectedPathSet.size < 4 && visiblePathSet.has(normalizedPath)) {
      selectedPathSet.add(normalizedPath);
    }
  };

  (Array.isArray(selectedPaths) ? selectedPaths : DEFAULT_MOBILE_BOTTOM_NAV_ITEMS).forEach(addVisiblePath);
  DEFAULT_MOBILE_BOTTOM_NAV_ITEMS.forEach(addVisiblePath);
  visibleItems.forEach((item) => addVisiblePath(item.path));

  return [
    ...visibleItems.filter((item) => selectedPathSet.has(item.path)).slice(0, 4),
    mobileMenuNavigationItem,
  ];
}

export function isNavigationItemActive(path: string, candidatePath = ''): boolean {
  const currentPath = String(candidatePath || '').trim() || '/';
  if (path === '/chat') return currentPath === '/chat' || currentPath.startsWith('/chat/');
  if (path === '/feed') return currentPath === '/feed' || currentPath.startsWith('/feed/');
  if (path === '/mail') return currentPath === '/mail' || currentPath.startsWith('/mail/');
  if (path === '/address-book') return currentPath === '/address-book' || currentPath.startsWith('/address-book/');
  if (path === '/menu') return currentPath === '/menu' || currentPath.startsWith('/menu/');
  return currentPath === path;
}

export function getNavigationBadgeCount(path: string, unreadCounts: Record<string, unknown> = {}): number {
  if (path === '/tasks') {
    return Number(unreadCounts?.tasks_open || unreadCounts?.tasks_open_total || 0);
  }
  if (path === '/chat') return Number(unreadCounts?.chat_messages_unread_total || 0);
  if (path === '/mail') return Number(unreadCounts?.mail_unread || 0);
  return 0;
}

export function getMailNavigationBadgeMeta(mailState: unknown, badgeCount = 0) {
  const state = String(mailState || 'unknown');
  const needsAttention = state === 'unknown' || state === 'error';
  const count = Math.max(0, Number(badgeCount) || 0);
  return {
    state,
    needsAttention,
    badgeContent: needsAttention ? (count > 0 ? count : '?') : count,
    showBadge: count > 0 || needsAttention,
    color: needsAttention ? 'warning' : 'error',
    title: needsAttention ? `Почтовый снимок: ${state}` : undefined,
  };
}

export function resolveActiveBottomNavPath(
  currentPath: string,
  visibleMobileItems: MobileNavItem[],
  visibleAllItems: MobileNavItem[],
): string | null {
  const item = visibleMobileItems.find((candidate) => isNavigationItemActive(candidate.path, currentPath));
  if (item?.path) return item.path;
  const isVisibleOverflowRoute = visibleAllItems.some((navigationItem) => (
    isNavigationItemActive(navigationItem.path, currentPath)
  ));
  const isAccountRoute = ['/profile', '/settings', '/admin', '/menu'].some((path) => (
    currentPath === path || currentPath.startsWith(`${path}/`)
  ));
  return (isVisibleOverflowRoute || isAccountRoute) ? '/menu' : null;
}
