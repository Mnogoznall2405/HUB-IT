import { nativeMfuDestinationFromPortalPath, resolveNativeMfuEnabled } from './nativeMfuFeature';

it('keeps Native MFU behind an explicit canary flag', () => {
  expect(resolveNativeMfuEnabled(undefined)).toBe(false);
  expect(resolveNativeMfuEnabled('false')).toBe(false);
  expect(resolveNativeMfuEnabled('true')).toBe(true);
});

it('maps only the exact MFU root', () => {
  expect(nativeMfuDestinationFromPortalPath('/mfu')).toEqual({ pathname: '/(shell)/mfu' });
  expect(nativeMfuDestinationFromPortalPath('/mfu/')).toEqual({ pathname: '/(shell)/mfu' });
  expect(nativeMfuDestinationFromPortalPath('/mfu?device=main%7C17')).toBeNull();
  expect(nativeMfuDestinationFromPortalPath('/mfu/device/17')).toBeNull();
  expect(nativeMfuDestinationFromPortalPath('/mfu#history')).toBeNull();
});
