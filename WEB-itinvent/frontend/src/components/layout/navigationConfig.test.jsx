import { describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/chatFeature', () => ({
  CHAT_FEATURE_ENABLED: true,
}));

import { resolveMobileNavigationItems } from './navigationConfig';

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
      '/tasks',
      '/tickets',
      '/chat',
      '/menu',
    ]);
  });
});
