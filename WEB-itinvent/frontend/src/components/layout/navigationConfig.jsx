import StorageIcon from '@mui/icons-material/Storage';
import BarChartIcon from '@mui/icons-material/BarChart';
import LanIcon from '@mui/icons-material/Lan';
import ComputerIcon from '@mui/icons-material/Computer';
import PrintIcon from '@mui/icons-material/Print';
import ShieldIcon from '@mui/icons-material/Policy';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import DashboardIcon from '@mui/icons-material/Dashboard';
import TaskAltIcon from '@mui/icons-material/TaskAlt';
import ConfirmationNumberIcon from '@mui/icons-material/ConfirmationNumber';
import MailOutlineIcon from '@mui/icons-material/MailOutline';
import ContactPhoneIcon from '@mui/icons-material/ContactPhone';
import VideocamIcon from '@mui/icons-material/Videocam';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import VpnKeyOutlinedIcon from '@mui/icons-material/VpnKeyOutlined';
import FolderOpenOutlinedIcon from '@mui/icons-material/FolderOpenOutlined';
import FolderSharedOutlinedIcon from '@mui/icons-material/FolderSharedOutlined';
import MenuRoundedIcon from '@mui/icons-material/MenuRounded';
import { CHAT_FEATURE_ENABLED } from '../../lib/chatFeature';
import { INVENTORY_SECTION_LABEL } from '../../lib/appBranding';
import { DEFAULT_MOBILE_BOTTOM_NAV_ITEMS } from '../../lib/mobileNavigationPreferences';

export const navigationItems = [
  { path: '/dashboard', label: 'Главная', shortLabel: 'Главная', icon: <DashboardIcon />, permission: 'dashboard.read', group: 'main' },
  { path: '/tasks', label: 'Задачи', shortLabel: 'Задачи', icon: <TaskAltIcon />, permission: 'tasks.read', group: 'main' },
  { path: '/tickets', label: 'Билеты', shortLabel: 'Билеты', icon: <ConfirmationNumberIcon />, permission: 'tickets.read', group: 'main' },
  ...(CHAT_FEATURE_ENABLED ? [{
    path: '/chat',
    label: 'Корпоративный чат',
    shortLabel: 'Чат',
    icon: <ForumOutlinedIcon />,
    permission: 'chat.read',
    group: 'main',
  }] : []),
  { path: '/mail', label: 'Почта', shortLabel: 'Почта', icon: <MailOutlineIcon />, permission: 'mail.access', group: 'main' },
  { path: '/address-book', label: 'Адресная книга', shortLabel: 'Адреса', icon: <ContactPhoneIcon />, permission: 'address_book.read', group: 'tools' },
  { path: '/passwords', label: 'Пароли', shortLabel: 'Пароли', icon: <VpnKeyOutlinedIcon />, permission: 'passwords.read', group: 'tools' },
  { path: '/groups-access', label: 'Доступ к папкам', shortLabel: 'Доступ', icon: <FolderSharedOutlinedIcon />, permission: 'groups_access.read', group: 'tools' },
  { path: '/my-files', label: 'Мои файлы', shortLabel: 'Файлы', icon: <FolderOpenOutlinedIcon />, permission: 'my_files.read', group: 'tools' },
  { path: '/database', label: INVENTORY_SECTION_LABEL, shortLabel: 'Учёт', icon: <StorageIcon />, permission: 'database.read', group: 'tools' },
  { path: '/networks', label: 'Сети', shortLabel: 'Сети', icon: <LanIcon />, permission: 'networks.read', group: 'tools' },
  { path: '/vcs', label: 'ВКС терминалы', shortLabel: 'ВКС', icon: <VideocamIcon />, permission: 'vcs.read', group: 'tools' },
  { path: '/mfu', label: 'МФУ', shortLabel: 'МФУ', icon: <PrintIcon />, permission: 'mfu.read', group: 'tools' },
  { path: '/computers', label: 'Компьютеры', shortLabel: 'ПК', icon: <ComputerIcon />, permission: 'computers.read', group: 'tools' },
  { path: '/scan-center', label: 'Scan Center', shortLabel: 'Scan', icon: <ShieldIcon />, permission: 'scan.read', group: 'tools' },
  { path: '/statistics', label: 'Статистика', shortLabel: 'Статистика', icon: <BarChartIcon />, permission: 'statistics.read', group: 'tools' },
  { path: '/kb', label: 'IT База знаний', shortLabel: 'База знаний', icon: <MenuBookIcon />, permission: 'kb.read', group: 'tools' },
];

export const mobileMenuNavigationItem = {
  path: '/menu',
  label: 'Меню',
  shortLabel: 'Меню',
  icon: <MenuRoundedIcon />,
};

export function isAdminUser(user) {
  return String(user?.role || '').trim().toLowerCase() === 'admin';
}

export function canAccessNavigationItem(item, { user, hasPermission }) {
  if (!item) return false;
  if (item.adminOnly) return isAdminUser(user);
  return !item.permission || hasPermission(item.permission);
}

export function getVisibleNavigationItems({ user, hasPermission }) {
  return navigationItems.filter((item) => canAccessNavigationItem(item, { user, hasPermission }));
}

export function resolveMobileNavigationItems({
  selectedPaths,
  user,
  hasPermission,
}) {
  const visibleItems = getVisibleNavigationItems({ user, hasPermission });
  const visiblePathSet = new Set(visibleItems.map((item) => item.path));
  const selectedPathSet = new Set();

  const addVisiblePath = (path) => {
    const normalizedPath = String(path || '').trim();
    if (
      selectedPathSet.size < 4
      && visiblePathSet.has(normalizedPath)
    ) {
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

export function isNavigationItemActive(path, candidatePath = '') {
  const currentPath = String(candidatePath || '').trim() || '/';
  if (path === '/networks') {
    return currentPath === '/networks' || currentPath.startsWith('/networks/');
  }
  if (path === '/chat') return currentPath === '/chat' || currentPath.startsWith('/chat/');
  if (path === '/mail') return currentPath === '/mail' || currentPath.startsWith('/mail/');
  if (path === '/menu') return currentPath === '/menu';
  return currentPath === path;
}

export function getNavigationBadgeCount(path, unreadCounts = {}) {
  if (path === '/tasks') return Number(unreadCounts?.tasks_open || unreadCounts?.tasks_open_total || 0);
  if (path === '/chat') return Number(unreadCounts?.chat_messages_unread_total || 0);
  if (path === '/mail') return Number(unreadCounts?.mail_unread || 0);
  return 0;
}
