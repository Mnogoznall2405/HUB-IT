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

it('maps the public root and an explicit task link while keeping unsupported state in web', () => {
  expect(nativeDocflowDestinationFromPortalPath('/docflow')).toEqual({ pathname: '/(shell)/docflow' });
  expect(nativeDocflowDestinationFromPortalPath('/docflow/')).toEqual({ pathname: '/(shell)/docflow' });
  expect(nativeDocflowDestinationFromPortalPath('/docflow?task=task-1')).toEqual({
    pathname: '/(shell)/docflow/[taskRef]',
    params: { taskRef: 'task-1' },
  });
  expect(nativeDocflowDestinationFromPortalPath('/docflow/history')).toBeNull();
  expect(nativeDocflowDestinationFromPortalPath('/docflow#task')).toBeNull();
  expect(docflowPortalPath()).toBe('/docflow');
});
