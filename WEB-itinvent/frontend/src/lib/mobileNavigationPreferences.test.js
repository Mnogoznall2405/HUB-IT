import { describe, expect, it } from 'vitest';

import {
  DEFAULT_MOBILE_BOTTOM_NAV_ITEMS,
  normalizeMobileBottomNavItems,
} from './mobileNavigationPreferences';

describe('normalizeMobileBottomNavItems', () => {
  it('removes duplicates, unknown values, and account/admin routes', () => {
    expect(normalizeMobileBottomNavItems([
      '/mail',
      '/settings',
      '/profile',
      '/admin',
      '/ad-users',
      '/tasks',
      '/mail',
      '/database',
      '/kb',
      '/statistics',
    ])).toEqual(['/mail', '/tasks', '/database', '/kb']);
  });

  it('uses defaults for non-array values and preserves an intentional empty selection', () => {
    expect(normalizeMobileBottomNavItems(null)).toEqual(DEFAULT_MOBILE_BOTTOM_NAV_ITEMS);
    expect(normalizeMobileBottomNavItems([], [])).toEqual([]);
  });
});
