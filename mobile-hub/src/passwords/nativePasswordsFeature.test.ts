import { nativePasswordsDestinationFromPortalPath, resolveNativePasswordsEnabled } from './nativePasswordsFeature';

it('enables Native Passwords by default with an explicit kill switch', () => {
  expect(resolveNativePasswordsEnabled(undefined)).toBe(true);
  expect(resolveNativePasswordsEnabled('false')).toBe(false);
  expect(resolveNativePasswordsEnabled('true')).toBe(true);
});

it('maps only the native vault root and rejects unsupported workflows', () => {
  expect(nativePasswordsDestinationFromPortalPath('/passwords')).toEqual({ pathname: '/(shell)/passwords' });
  expect(nativePasswordsDestinationFromPortalPath('/passwords?section=vault')).toEqual({ pathname: '/(shell)/passwords' });
  expect(nativePasswordsDestinationFromPortalPath('/passwords?section=ad-expiry')).toBeNull();
  expect(nativePasswordsDestinationFromPortalPath('/passwords?q=admin')).toBeNull();
  expect(nativePasswordsDestinationFromPortalPath('/passwords#entry-1')).toBeNull();
});
