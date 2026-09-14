import {
  asStatisticsHref,
  nativeStatisticsDestinationFromPortalPath,
  resolveNativeStatisticsEnabled,
} from './nativeStatisticsFeature';

it('maps the portal statistics path to the native route', () => {
  expect(nativeStatisticsDestinationFromPortalPath('/statistics')).toEqual({ pathname: '/(shell)/statistics' });
  expect(nativeStatisticsDestinationFromPortalPath('https://hubit.zsgp.ru/statistics')).toEqual({ pathname: '/(shell)/statistics' });
  expect(nativeStatisticsDestinationFromPortalPath('/statistics/')).toEqual({ pathname: '/(shell)/statistics' });
  expect(nativeStatisticsDestinationFromPortalPath('/statistics?tab=mfu')).toBeNull();
  expect(nativeStatisticsDestinationFromPortalPath('/statistics/details')).toBeNull();
  expect(nativeStatisticsDestinationFromPortalPath('')).toBeNull();
  expect(nativeStatisticsDestinationFromPortalPath('/tasks')).toBeNull();
});

it('keeps the feature enabled unless explicitly disabled', () => {
  expect(resolveNativeStatisticsEnabled(undefined)).toBe(true);
  expect(resolveNativeStatisticsEnabled('true')).toBe(true);
  expect(resolveNativeStatisticsEnabled('false')).toBe(false);
});

it('produces a valid href', () => {
  const destination = nativeStatisticsDestinationFromPortalPath('/statistics');
  expect(destination && asStatisticsHref(destination)).toEqual({ pathname: '/(shell)/statistics' });
});
