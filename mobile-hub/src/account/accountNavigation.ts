import type { ComponentProps } from 'react';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import {
  ADMIN_AREA_PERMISSIONS,
  canAccessAdminArea,
  isAdminUser,
} from '../navigation/mobileNavItems';

export type AccountIconName = ComponentProps<typeof MaterialCommunityIcons>['name'];

export type AccountSection = {
  key: string;
  label: string;
  description: string;
  icon: AccountIconName;
  nativeHref: string;
  permission?: string;
  permissions?: string[];
  adminOnly?: boolean;
  adminOnlyFallback?: boolean;
};

export const PERSONAL_SETTINGS_SECTIONS: AccountSection[] = [
  {
    key: 'appearance',
    label: 'Внешний вид',
    description: 'Тема и пункты нижнего меню',
    icon: 'palette-outline',
    nativeHref: '/(shell)/menu/settings/appearance',
  },
  {
    key: 'notifications',
    label: 'Уведомления',
    description: 'Каналы и Android push',
    icon: 'bell-outline',
    nativeHref: '/(shell)/menu/settings/notifications',
  },
  {
    key: 'security',
    label: 'Безопасность',
    description: '2FA, резервные коды и устройства',
    icon: 'shield-outline',
    nativeHref: '/(shell)/menu/settings/security',
  },
  {
    key: 'app',
    label: 'Приложение',
    description: 'Обновление APK, блокировка и диагностика',
    icon: 'cellphone-cog',
    nativeHref: '/(shell)/menu/settings/app',
  },
  {
    key: 'about',
    label: 'О HUB-IT',
    description: 'Версия APK и канал preview',
    icon: 'information-outline',
    nativeHref: '/(shell)/menu/settings/about',
  },
];

export const ADMIN_SECTION_DEFINITIONS: AccountSection[] = [
  { key: 'ad-users', label: 'Пользователи AD', description: 'Импорт и синхронизация Active Directory', icon: 'account-network-outline', nativeHref: '/(shell)/menu/admin/ad-users', adminOnly: true },
  { key: 'ai-bots', label: 'AI-боты', description: 'Настройки моделей и история запусков', icon: 'robot-outline', nativeHref: '/(shell)/menu/admin/ai-bots', permission: 'settings.ai.manage' },
  { key: 'system', label: 'Система', description: 'Служебные параметры и контроль актов', icon: 'cog-outline', nativeHref: '/(shell)/menu/admin/system', adminOnly: true },
  {
    key: 'users',
    label: 'Пользователи',
    description: 'Учётные записи, роли и права',
    icon: 'account-group-outline',
    nativeHref: '/(shell)/menu/admin/users',
    permission: 'settings.users.manage',
  },
  {
    key: 'departments',
    label: 'Отделы',
    description: 'Состав и руководители отделов',
    icon: 'office-building-outline',
    nativeHref: '/(shell)/menu/admin/departments',
    permission: 'departments.manage',
  },
  {
    key: 'sessions',
    label: 'Сессии',
    description: 'Активные входы и очистка',
    icon: 'shield-lock-outline',
    nativeHref: '/(shell)/menu/admin/sessions',
    permission: 'settings.sessions.manage',
  },
];

export type AccountNavTone = { foreground: string; background: string };

export const ACCOUNT_NAV_TONES: Record<string, AccountNavTone> = {
  appearance: { foreground: '#7f6df2', background: 'rgba(127, 109, 242, 0.18)' },
  notifications: { foreground: '#ff9f1a', background: 'rgba(255, 159, 26, 0.18)' },
  security: { foreground: '#36b37e', background: 'rgba(54, 179, 126, 0.18)' },
  app: { foreground: '#4aa3ff', background: 'rgba(74, 163, 255, 0.18)' },
  about: { foreground: '#22a6c7', background: 'rgba(34, 166, 199, 0.18)' },
  admin: { foreground: '#7f6df2', background: 'rgba(127, 109, 242, 0.18)' },
  users: { foreground: '#4aa3ff', background: 'rgba(74, 163, 255, 0.18)' },
  departments: { foreground: '#22a6c7', background: 'rgba(34, 166, 199, 0.18)' },
  'ad-users': { foreground: '#36b37e', background: 'rgba(54, 179, 126, 0.18)' },
  sessions: { foreground: '#ef5b70', background: 'rgba(239, 91, 112, 0.18)' },
  'ai-bots': { foreground: '#7f6df2', background: 'rgba(127, 109, 242, 0.18)' },
  system: { foreground: '#8a94a6', background: 'rgba(138, 148, 166, 0.18)' },
};

export function accountNavTone(key: string): AccountNavTone {
  return ACCOUNT_NAV_TONES[key] || { foreground: '#4aa3ff', background: 'rgba(74, 163, 255, 0.18)' };
}

export { ADMIN_AREA_PERMISSIONS, canAccessAdminArea, isAdminUser };

export function getAvailableAdminSections({
  user,
  hasPermission,
}: {
  user?: { role?: string | null } | null;
  hasPermission: (permission: string) => boolean;
}): AccountSection[] {
  const admin = isAdminUser(user);
  const safeHasPermission = typeof hasPermission === 'function' ? hasPermission : () => false;
  return ADMIN_SECTION_DEFINITIONS.filter((section) => {
    if (section.adminOnly) return admin;
    if (section.permissions) {
      return admin || section.permissions.some((permission) => safeHasPermission(permission));
    }
    if (section.adminOnlyFallback && admin) return true;
    return admin || !section.permission || safeHasPermission(section.permission);
  });
}

export function canAccessAdminSection(
  sectionKey: string,
  access: {
    user?: { role?: string | null } | null;
    hasPermission: (permission: string) => boolean;
  },
): boolean {
  return getAvailableAdminSections(access).some((section) => section.key === sectionKey);
}
