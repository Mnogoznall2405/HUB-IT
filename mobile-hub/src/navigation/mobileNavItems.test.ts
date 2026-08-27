import {
  getMailNavigationBadgeMeta,
  getNavigationBadgeCount,
  getVisibleNavigationItems,
  isNavigationItemActive,
  navigationItems,
  resolveActiveBottomNavPath,
  resolveMobileNavigationItems,
} from './mobileNavItems';

const admin = { role: 'admin' };
const allow = () => true;

describe('resolveMobileNavigationItems', () => {
  it('exposes only native-enabled modules and hides web-only pages', () => {
    const paths = navigationItems.map((item) => item.path);
    expect(paths).toEqual(expect.arrayContaining([
      '/dashboard', '/feed', '/tasks', '/chat', '/mail', '/docflow',
      '/address-book', '/company-structure', '/my-files', '/database',
    ]));
    [
      '/tickets', '/networks', '/vcs', '/dlp', '/statistics', '/kb', '/file-egress',
      '/scan-center', '/computers', '/passwords', '/groups-access', '/warehouse-1c', '/mfu',
    ].forEach((path) => expect(paths).not.toContain(path));
  });

  it('keeps four selected items and always appends Menu', () => {
    const items = resolveMobileNavigationItems({
      selectedPaths: ['/dashboard', '/tasks', '/chat', '/mail'],
      user: admin,
      hasPermission: allow,
    });
    expect(items.map((item) => item.path)).toEqual([
      '/dashboard',
      '/tasks',
      '/chat',
      '/mail',
      '/menu',
    ]);
  });

  it('hides items without permission and still shows Menu', () => {
    const items = resolveMobileNavigationItems({
      selectedPaths: ['/dashboard', '/tasks', '/chat', '/mail'],
      user: { role: 'user' },
      hasPermission: (permission) => permission === 'dashboard.read',
    });
    expect(items.map((item) => item.path)).toContain('/menu');
    expect(items.some((item) => item.path === '/tasks')).toBe(false);
    expect(items.some((item) => item.path === '/dashboard')).toBe(true);
  });
});

describe('navigation badges', () => {
  it('reads task, chat and mail counters', () => {
    expect(getNavigationBadgeCount('/tasks', { tasks_open: 4 })).toBe(4);
    expect(getNavigationBadgeCount('/chat', { chat_messages_unread_total: 2 })).toBe(2);
    expect(getNavigationBadgeCount('/mail', { mail_unread: 9 })).toBe(9);
    expect(getNavigationBadgeCount('/dashboard', { tasks_open: 4 })).toBe(0);
  });

  it('shows a warning badge when mail state is unknown', () => {
    const meta = getMailNavigationBadgeMeta('unknown', 0);
    expect(meta.showBadge).toBe(true);
    expect(meta.badgeContent).toBe('?');
    expect(meta.needsAttention).toBe(true);
  });
});

describe('active tab', () => {
  it('marks chat threads as the chat tab and overflow routes as menu', () => {
    expect(isNavigationItemActive('/chat', '/chat/abc')).toBe(true);
    const items = resolveMobileNavigationItems({
      selectedPaths: ['/dashboard', '/tasks', '/chat', '/mail'],
      user: admin,
      hasPermission: allow,
    });
    expect(resolveActiveBottomNavPath('/settings', items, items)).toBe('/menu');
    expect(resolveActiveBottomNavPath('/menu/profile', items, items)).toBe('/menu');
    expect(resolveActiveBottomNavPath('/admin/users', items, items)).toBe('/menu');
    expect(resolveActiveBottomNavPath('/tasks', items, items)).toBe('/tasks');
  });

  it('highlights address book in the bar and falls back to Menu when it is overflow', () => {
    const withAddressBook = resolveMobileNavigationItems({
      selectedPaths: ['/dashboard', '/tasks', '/address-book', '/mail'],
      user: admin,
      hasPermission: allow,
    });
    const withoutAddressBook = resolveMobileNavigationItems({
      selectedPaths: ['/dashboard', '/tasks', '/chat', '/mail'],
      user: admin,
      hasPermission: allow,
    });
    const allItems = getVisibleNavigationItems({ user: admin, hasPermission: allow });
    expect(resolveActiveBottomNavPath('/address-book', withAddressBook, allItems)).toBe('/address-book');
    expect(resolveActiveBottomNavPath('/address-book', withoutAddressBook, allItems)).toBe('/menu');
  });
});
