import { nativeMfuDestinationFromPortalPath, resolveNativeMfuEnabled } from './nativeMfuFeature';

it('enables Native MFU by default with an explicit kill switch', () => {
  expect(resolveNativeMfuEnabled(undefined)).toBe(true);
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
