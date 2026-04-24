import { describe, expect, it, vi } from 'vitest';
import { hasAnyAppPushPermission } from './appPushPermissions';

describe('appPushPermissions', () => {
  it('treats mail access as enough for app-wide push bootstrap', () => {
    const hasPermission = vi.fn((permission) => permission === 'mail.access');

    expect(hasAnyAppPushPermission(hasPermission, { chatFeatureEnabled: false })).toBe(true);
  });

  it('returns false when the user has no push-capable permissions', () => {
    const hasPermission = vi.fn(() => false);

    expect(hasAnyAppPushPermission(hasPermission, { chatFeatureEnabled: true })).toBe(false);
  });

  it('ignores chat permission when chat feature is disabled', () => {
    const hasPermission = vi.fn((permission) => permission === 'chat.read');

    expect(hasAnyAppPushPermission(hasPermission, { chatFeatureEnabled: false })).toBe(false);
  });
});
