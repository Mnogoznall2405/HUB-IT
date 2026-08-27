import {
  nativeScanCenterDestinationFromPortalPath,
  resolveNativeScanCenterEnabled,
  scanCenterPortalPath,
} from './nativeScanCenterFeature';

it('stays disabled until an explicit canary flag is enabled', () => {
  expect(resolveNativeScanCenterEnabled(undefined)).toBe(false);
  expect(resolveNativeScanCenterEnabled('false')).toBe(false);
  expect(resolveNativeScanCenterEnabled('TRUE')).toBe(false);
  expect(resolveNativeScanCenterEnabled('true')).toBe(true);
});

it('maps only the exact public root and preserves unsupported URL state for web', () => {
  expect(nativeScanCenterDestinationFromPortalPath('/scan-center')).toEqual({ pathname: '/(shell)/scan-center' });
  expect(nativeScanCenterDestinationFromPortalPath('/scan-center/')).toEqual({ pathname: '/(shell)/scan-center' });
  expect(nativeScanCenterDestinationFromPortalPath('/scan-center?incident=i-1')).toBeNull();
  expect(nativeScanCenterDestinationFromPortalPath('/scan-center/host-1')).toBeNull();
  expect(nativeScanCenterDestinationFromPortalPath('/scan-center#agents')).toBeNull();
  expect(scanCenterPortalPath()).toBe('/scan-center');
});

