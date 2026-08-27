import { nativePasswordsDestinationFromPortalPath, resolveNativePasswordsEnabled } from './nativePasswordsFeature';

it('keeps Native Passwords behind an explicit canary flag', () => {
  expect(resolveNativePasswordsEnabled(undefined)).toBe(false);
  expect(resolveNativePasswordsEnabled('false')).toBe(false);
  expect(resolveNativePasswordsEnabled('true')).toBe(true);
});

it('maps only the vault root and leaves AD expiry or unknown state in web', () => {
  expect(nativePasswordsDestinationFromPortalPath('/passwords')).toEqual({ pathname: '/(shell)/passwords' });
  expect(nativePasswordsDestinationFromPortalPath('/passwords?section=vault')).toEqual({ pathname: '/(shell)/passwords' });
  expect(nativePasswordsDestinationFromPortalPath('/passwords?section=ad-expiry')).toBeNull();
  expect(nativePasswordsDestinationFromPortalPath('/passwords?q=admin')).toBeNull();
  expect(nativePasswordsDestinationFromPortalPath('/passwords#entry-1')).toBeNull();
});

