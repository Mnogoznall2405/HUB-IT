import { describe, expect, it } from 'vitest';

import {
  canAccessAdminArea,
  getAvailableAdminSections,
  resolveLegacySettingsTarget,
} from './accountNavigationConfig';

describe('account navigation configuration', () => {
  it('allows administration for admins or users with at least one admin permission', () => {
    expect(canAccessAdminArea({
      user: { role: 'admin' },
      hasPermission: () => false,
    })).toBe(true);

    expect(canAccessAdminArea({
      user: { role: 'operator' },
      hasPermission: (permission) => permission === 'settings.sessions.manage',
    })).toBe(true);

    expect(canAccessAdminArea({
      user: { role: 'operator' },
      hasPermission: () => false,
    })).toBe(false);
  });

  it('filters admin categories by permission', () => {
    const sections = getAvailableAdminSections({
      user: { role: 'operator' },
      hasPermission: (permission) => ['departments.manage', 'ad_users.read'].includes(permission),
    });

    expect(sections.map((section) => section.key)).toEqual(['departments', 'ad-users']);
  });

  it.each([
    ['?tab=profile', '', '/profile'],
    ['?tab=appearance', '', '/settings/appearance'],
    ['?tab=security', '', '/settings/security'],
    ['?tab=users', '', '/admin/users'],
    ['?tab=departments', '', '/admin/departments'],
    ['?tab=sessions', '', '/admin/sessions'],
    ['?tab=ai-bots', '', '/admin/ai-bots'],
    ['?tab=env', '#password-groups-settings', '/admin/system#password-groups-settings'],
  ])('redirects legacy %s links', (search, hash, expected) => {
    expect(resolveLegacySettingsTarget(search, hash)).toBe(expected);
  });
});
