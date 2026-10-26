import { nativeMonitoringDestinationFromPortalPath, resolveNativeMonitoringEnabled } from './nativeMonitoringFeature';

it('maps only the bare portal monitoring path to the native route', () => {
  const native = { pathname: '/(shell)/monitoring' };
  expect(nativeMonitoringDestinationFromPortalPath('/monitoring')).toEqual(native);
  expect(nativeMonitoringDestinationFromPortalPath('https://hubit.zsgp.ru/monitoring/')).toEqual(native);
  expect(nativeMonitoringDestinationFromPortalPath('/monitoring?target=1')).toBeNull();
  expect(nativeMonitoringDestinationFromPortalPath('/monitoring/devices')).toBeNull();
  expect(nativeMonitoringDestinationFromPortalPath('/statistics')).toBeNull();
});

it('stays enabled unless explicitly switched off', () => {
  expect(resolveNativeMonitoringEnabled(undefined)).toBe(true);
  expect(resolveNativeMonitoringEnabled('false')).toBe(false);
});
