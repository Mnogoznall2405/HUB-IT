import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/chatFeature', () => ({
  CHAT_FEATURE_ENABLED: true,
}));

import { getMailNavigationBadgeMeta, navigationItems, resolveMobileNavigationItems } from './navigationConfig';

it('does not expose the removed absences page in navigation', () => {
  expect(navigationItems.some((item) => item.path === '/absences')).toBe(false);
});

it('exposes the company feed as a primary navigation destination', () => {
  expect(navigationItems).toEqual(expect.arrayContaining([
    expect.objectContaining({ path: '/feed', label: 'Лента', permission: 'dashboard.read' }),
  ]));
});

it('exposes IT purchase requests only through their dedicated permission group', () => {
  expect(navigationItems).toEqual(expect.arrayContaining([
    expect.objectContaining({
      path: '/it/requests',
      label: 'Заявки на МПЗ',
      permission: 'warehouse_1c.it_requests.read',
      group: 'it',
    }),
  ]));
});

it('exposes construction objects through the dedicated permission', () => {
  expect(navigationItems).toEqual(expect.arrayContaining([
    expect.objectContaining({
      path: '/construction',
      label: 'Объекты строительства',
      permission: 'construction.read',
      group: 'main',
    }),
  ]));
});

describe('getMailNavigationBadgeMeta', () => {
  it('does not treat stale as attention and hides zero-count badge', () => {
    expect(getMailNavigationBadgeMeta('stale', 0)).toMatchObject({
      needsAttention: false,
      badgeContent: 0,
      showBadge: false,
    });
  });

  it('keeps a numeric badge for stale with unread mail', () => {
    expect(getMailNavigationBadgeMeta('stale', 3)).toMatchObject({
      needsAttention: false,
      badgeContent: 3,
      showBadge: true,
      color: 'error',
    });
  });

  it('shows ? only for unknown and error when count is zero', () => {
    expect(getMailNavigationBadgeMeta('unknown', 0)).toMatchObject({
      needsAttention: true,
      badgeContent: '?',
      showBadge: true,
      color: 'warning',
      title: 'Почтовый снимок: unknown',
    });
    expect(getMailNavigationBadgeMeta('error', 0)).toMatchObject({
      needsAttention: true,
      badgeContent: '?',
      showBadge: true,
      color: 'warning',
      title: 'Почтовый снимок: error',
    });
  });
});

describe('resolveMobileNavigationItems', () => {
  const user = { role: 'operator' };
  const hasPermission = () => true;

  it('returns four selected routes in system order and keeps menu last', () => {
    const result = resolveMobileNavigationItems({
      selectedPaths: ['/statistics', '/database', '/tickets', '/address-book'],
      user,
      hasPermission,
    });

    expect(result.map((item) => item.path)).toEqual([
      '/tickets',
      '/address-book',
      '/database',
      '/statistics',
      '/menu',
    ]);
  });

  it('filters inaccessible, account, and admin items and fills empty slots without duplicates', () => {
    const result = resolveMobileNavigationItems({
      selectedPaths: ['/mail', '/tasks', '/mail', '/settings', '/profile', '/admin', '/ad-users'],
      user,
      hasPermission: (permission) => permission !== 'mail.access',
    });

    expect(result.map((item) => item.path)).toEqual([
      '/dashboard',
      '/feed',
      '/tasks',
      '/chat',
      '/menu',
    ]);
  });
});
