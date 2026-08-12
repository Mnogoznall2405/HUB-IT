import { describe, expect, it } from 'vitest';
import { buildDesktopQuickRoutes } from './desktopQuickRoutes';

const visibleItems = [
  { path: '/dashboard', label: 'Главная' },
  { path: '/tasks', label: 'Задачи' },
  { path: '/mail', label: 'Почта' },
  { path: '/computers', label: 'Компьютеры' },
];

describe('desktopQuickRoutes', () => {
  it('builds only routes from the permission-filtered navigation input', () => {
    expect(buildDesktopQuickRoutes({
      visibleNavigationItems: visibleItems,
      pinnedPaths: ['/dashboard', '/computers', '/passwords'],
      showNotifications: true,
      unreadCounts: {
        notifications_unread_total: 7,
        tasks_open_total: 3,
        mail_unread: 2,
      },
    })).toEqual([
      {
        id: 'notifications',
        label: 'Уведомления',
        route: '/dashboard?desktop_action=notifications',
        badge: 7,
      },
      { id: 'tasks', label: 'Задачи', route: '/tasks', badge: 3 },
      { id: 'mail', label: 'Почта', route: '/mail', badge: 2 },
      { id: 'dashboard', label: 'Главная', route: '/dashboard', badge: 0 },
      { id: 'computers', label: 'Компьютеры', route: '/computers', badge: 0 },
    ]);
  });

  it('rejects unsafe routes and bounds labels, badges, duplicates, and extra pins', () => {
    const longLabel = 'Я'.repeat(100);
    const routes = buildDesktopQuickRoutes({
      visibleNavigationItems: [
        { path: '/tasks', label: longLabel },
        { path: '/tasks', label: 'Duplicate' },
        { path: 'https://evil.example', label: 'External' },
        { path: '/chat\\escape', label: 'Escape' },
        { path: '/one', label: 'One' },
        { path: '/two', label: 'Two' },
        { path: '/three', label: 'Three' },
        { path: '/four', label: 'Four' },
        { path: '/five', label: 'Five' },
        { path: '/six', label: 'Six' },
      ],
      pinnedPaths: ['/one', '/two', '/three', '/four', '/five', '/six'],
      showNotifications: false,
      unreadCounts: { tasks_open_total: 10001 },
    });

    expect(routes).toHaveLength(6);
    expect(routes[0]).toEqual({
      id: 'tasks',
      label: 'Я'.repeat(48),
      route: '/tasks',
      badge: 9999,
    });
    expect(routes.slice(1).map((item) => item.route)).toEqual([
      '/one', '/two', '/three', '/four', '/five',
    ]);
  });

  it('adds only permission-approved quick-create routes with existing contracts', () => {
    const routes = buildDesktopQuickRoutes({
      visibleNavigationItems: visibleItems,
      canCreateTasks: true,
      canComposeMail: true,
    });

    expect(routes).toEqual(expect.arrayContaining([
      { id: 'new-task', label: 'Новая задача', route: '/tasks?create=1', badge: 0 },
      { id: 'new-mail', label: 'Новое письмо', route: '/mail?compose=new', badge: 0 },
    ]));
    expect(routes.some((route) => route.id === 'new-ticket')).toBe(false);
  });
});
