import {
  nativeMyFilesDestinationFromPortalPath,
  resolveNativeMyFilesEnabled,
} from './nativeMyFilesFeature';

it('maps only the exact private My Files screen', () => {
  expect(nativeMyFilesDestinationFromPortalPath('/my-files')).toEqual({ pathname: '/(shell)/my-files' });
  expect(nativeMyFilesDestinationFromPortalPath('/my-files/')).toEqual({ pathname: '/(shell)/my-files' });
  expect(nativeMyFilesDestinationFromPortalPath('/my-files?preview=f-1')).toBeNull();
  expect(nativeMyFilesDestinationFromPortalPath('/my-files/f-1')).toBeNull();
  expect(nativeMyFilesDestinationFromPortalPath('/shared-files/public-token')).toBeNull();
});

it('is default-on with an explicit rollback flag', () => {
  expect(resolveNativeMyFilesEnabled(undefined)).toBe(true);
  expect(resolveNativeMyFilesEnabled('true')).toBe(true);
  expect(resolveNativeMyFilesEnabled('false')).toBe(false);
});
