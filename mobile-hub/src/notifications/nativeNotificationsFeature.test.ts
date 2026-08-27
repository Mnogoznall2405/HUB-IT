import {
  parseNativeNotificationsEnabled,
  resolveNativeNotificationsEnabled,
} from './nativeNotificationsFeature';

describe('native notification center feature flag', () => {
  it('is default-on for the mobile candidate', () => {
    expect(resolveNativeNotificationsEnabled(undefined)).toBe(true);
  });

  it('accepts explicit enabled values and rejects disabled values', () => {
    expect(parseNativeNotificationsEnabled('true')).toBe(true);
    expect(parseNativeNotificationsEnabled('1')).toBe(true);
    expect(parseNativeNotificationsEnabled('false')).toBe(false);
    expect(parseNativeNotificationsEnabled('0')).toBe(false);
  });
});
