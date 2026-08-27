import {
  docflowPortalPath,
  nativeDocflowDestinationFromPortalPath,
  resolveNativeDocflowEnabled,
} from './nativeDocflowFeature';

it('is default-on with an explicit rollback flag', () => {
  expect(resolveNativeDocflowEnabled(undefined)).toBe(true);
  expect(resolveNativeDocflowEnabled('true')).toBe(true);
  expect(resolveNativeDocflowEnabled('false')).toBe(false);
});

it('maps only the exact public root and keeps unsupported state in web', () => {
  expect(nativeDocflowDestinationFromPortalPath('/docflow')).toEqual({ pathname: '/(shell)/docflow' });
  expect(nativeDocflowDestinationFromPortalPath('/docflow/')).toEqual({ pathname: '/(shell)/docflow' });
  expect(nativeDocflowDestinationFromPortalPath('/docflow?task=task-1')).toBeNull();
  expect(nativeDocflowDestinationFromPortalPath('/docflow/history')).toBeNull();
  expect(nativeDocflowDestinationFromPortalPath('/docflow#task')).toBeNull();
  expect(docflowPortalPath()).toBe('/docflow');
});

