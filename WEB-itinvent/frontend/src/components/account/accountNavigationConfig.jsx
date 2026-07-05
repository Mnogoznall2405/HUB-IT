import PaletteOutlinedIcon from '@mui/icons-material/PaletteOutlined';
import NotificationsOutlinedIcon from '@mui/icons-material/NotificationsOutlined';
import ShieldOutlinedIcon from '@mui/icons-material/ShieldOutlined';
import InstallMobileOutlinedIcon from '@mui/icons-material/InstallMobileOutlined';
import GroupOutlinedIcon from '@mui/icons-material/GroupOutlined';
import CorporateFareOutlinedIcon from '@mui/icons-material/CorporateFareOutlined';
import AdminPanelSettingsOutlinedIcon from '@mui/icons-material/AdminPanelSettingsOutlined';
import SmartToyOutlinedIcon from '@mui/icons-material/SmartToyOutlined';
import SecurityOutlinedIcon from '@mui/icons-material/SecurityOutlined';
import SettingsApplicationsOutlinedIcon from '@mui/icons-material/SettingsApplicationsOutlined';

export const ADMIN_AREA_PERMISSIONS = [
  'departments.manage',
  'settings.users.manage',
  'settings.sessions.manage',
  'settings.ai.manage',
  'ad_users.read',
  'ad_users.manage',
];

export const PERSONAL_SETTINGS_SECTIONS = [
  {
    key: 'appearance',
    label: 'Внешний вид',
    description: 'Тема, шрифт и мобильная навигация',
    icon: <PaletteOutlinedIcon />,
  },
  {
    key: 'notifications',
    label: 'Уведомления',
    description: 'Каналы, браузер и chat push',
    icon: <NotificationsOutlinedIcon />,
  },
  {
    key: 'security',
    label: 'Безопасность',
    description: '2FA, passkey и доверенные устройства',
    icon: <ShieldOutlinedIcon />,
  },
  {
    key: 'app',
    label: 'Приложение',
    description: 'Установка PWA и обновления',
    icon: <InstallMobileOutlinedIcon />,
  },
];

const ADMIN_SECTION_DEFINITIONS = [
  {
    key: 'users',
    label: 'Пользователи',
    description: 'Учётные записи, роли и права',
    icon: <GroupOutlinedIcon />,
    permission: 'settings.users.manage',
  },
  {
    key: 'departments',
    label: 'Отделы',
    description: 'Состав и руководители отделов',
    icon: <CorporateFareOutlinedIcon />,
    permission: 'departments.manage',
  },
  {
    key: 'ad-users',
    label: 'Пользователи AD',
    description: 'Импорт и синхронизация Active Directory',
    icon: <AdminPanelSettingsOutlinedIcon />,
    permissions: ['ad_users.read', 'ad_users.manage'],
    adminOnlyFallback: true,
  },
  {
    key: 'ai-bots',
    label: 'AI-боты',
    description: 'Модели, инструменты и запуски',
    icon: <SmartToyOutlinedIcon />,
    permission: 'settings.ai.manage',
  },
  {
    key: 'sessions',
    label: 'Сессии',
    description: 'Активные входы и очистка',
    icon: <SecurityOutlinedIcon />,
    permission: 'settings.sessions.manage',
  },
  {
    key: 'system',
    label: 'Система',
    description: 'Переменные, allowlist и служебные параметры',
    icon: <SettingsApplicationsOutlinedIcon />,
    adminOnly: true,
  },
];

export function isAdminUser(user) {
  return String(user?.role || '').trim().toLowerCase() === 'admin';
}

export function canAccessAdminArea({ user, hasPermission }) {
  if (isAdminUser(user)) return true;
  const safeHasPermission = typeof hasPermission === 'function' ? hasPermission : () => false;
  return ADMIN_AREA_PERMISSIONS.some((permission) => safeHasPermission(permission));
}

export function getAvailableAdminSections({ user, hasPermission }) {
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

export function resolveLegacySettingsTarget(search = '', hash = '') {
  const tab = String(new URLSearchParams(search).get('tab') || '').trim();
  if (!tab) return '';
  const targetByTab = {
    profile: '/profile',
    appearance: '/settings/appearance',
    security: '/settings/security',
    users: '/admin/users',
    departments: '/admin/departments',
    sessions: '/admin/sessions',
    'ai-bots': '/admin/ai-bots',
    env: '/admin/system',
  };
  const target = targetByTab[tab] || '';
  return target ? `${target}${hash || ''}` : '';
}
