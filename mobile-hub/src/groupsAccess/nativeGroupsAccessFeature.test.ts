import {
  nativeGroupsAccessDestinationFromPortalPath,
  resolveNativeGroupsAccessEnabled,
} from './nativeGroupsAccessFeature';

it('keeps Native Groups Access behind an explicit canary flag', () => {
  expect(resolveNativeGroupsAccessEnabled(undefined)).toBe(false);
  expect(resolveNativeGroupsAccessEnabled('false')).toBe(false);
  expect(resolveNativeGroupsAccessEnabled('true')).toBe(true);
});

it('maps only the exact public root', () => {
  expect(nativeGroupsAccessDestinationFromPortalPath('/groups-access')).toEqual({ pathname: '/(shell)/groups-access' });
  expect(nativeGroupsAccessDestinationFromPortalPath('/groups-access/')).toEqual({ pathname: '/(shell)/groups-access' });
  expect(nativeGroupsAccessDestinationFromPortalPath('/groups-access?branch=SPb')).toBeNull();
  expect(nativeGroupsAccessDestinationFromPortalPath('/groups-access/group')).toBeNull();
  expect(nativeGroupsAccessDestinationFromPortalPath('/groups-access#matrix')).toBeNull();
});
