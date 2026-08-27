import { hrefForPortalPath, routePathForPortalPath } from './moduleRegistry';
import { resolveShellTabPath } from './nativeAccountRoutes';

describe('native-only route registry', () => {
  it('maps core destinations to native shell screens', () => {
    expect(hrefForPortalPath('/dashboard')).toEqual({ pathname: '/(shell)/dashboard' });
    expect(hrefForPortalPath('/notifications')).toEqual({ pathname: '/(shell)/notifications' });
    expect(hrefForPortalPath('/menu')).toEqual({ pathname: '/(shell)/menu' });
    expect(hrefForPortalPath('/address-book')).toEqual({ pathname: '/(shell)/address-book' });
    expect(hrefForPortalPath('/chat')).toEqual({ pathname: '/(shell)/chat' });
    expect(hrefForPortalPath('/feed')).toEqual({ pathname: '/(shell)/feed' });
    expect(hrefForPortalPath('/tasks')).toEqual({ pathname: '/(shell)/tasks' });
    expect(hrefForPortalPath('/mail')).toEqual({ pathname: '/(shell)/mail' });
    expect(hrefForPortalPath('/database')).toEqual({ pathname: '/(shell)/database', params: {} });
    expect(hrefForPortalPath('/my-files')).toEqual({ pathname: '/(shell)/my-files' });
    expect(hrefForPortalPath('/company-structure')).toEqual({ pathname: '/(shell)/company-structure' });
    expect(hrefForPortalPath('/docflow')).toEqual({ pathname: '/(shell)/docflow' });
  });

  it('preserves supported native deep links', () => {
    expect(hrefForPortalPath('/chat?conversation=c1&message=m1')).toEqual({
      pathname: '/(shell)/chat/[conversationId]',
      params: { conversationId: 'c1', messageId: 'm1' },
    });
    expect(hrefForPortalPath('/tasks?task=task%2F42')).toEqual({
      pathname: '/(shell)/tasks/[taskId]',
      params: { taskId: 'task/42' },
    });
    expect(hrefForPortalPath('/tasks?create=1')).toEqual({ pathname: '/(shell)/tasks/create' });
    expect(hrefForPortalPath('/tasks?view=analytics')).toEqual({ pathname: '/(shell)/tasks/analytics' });
    expect(hrefForPortalPath('/mail?compose=new')).toEqual({
      pathname: '/(shell)/mail/compose',
      params: { mode: 'new' },
    });
    expect(hrefForPortalPath('/mail?message=message%2F7&mailbox_id=box-1')).toEqual({
      pathname: '/(shell)/mail/[messageId]',
      params: { messageId: 'message/7', mailboxId: 'box-1' },
    });
    expect(hrefForPortalPath('/database?inv_no=INV%2F7&db_id=OBJ-ITINVENT&tab=history')).toEqual({
      pathname: '/(shell)/database/[invNo]',
      params: { invNo: 'INV/7', databaseId: 'OBJ-ITINVENT', tab: 'history' },
    });
  });

  it('reduces unsupported workflows to a safe native root', () => {
    expect(hrefForPortalPath('/admin/system')).toEqual({ pathname: '/(shell)/menu/admin' });
    expect(hrefForPortalPath('/tasks?view=board')).toEqual({ pathname: '/(shell)/tasks' });
    expect(hrefForPortalPath('/mail?compose=android-share&android_share_id=share-1'))
      .toEqual({ pathname: '/(shell)/mail' });
    expect(hrefForPortalPath('/database?upload_act=1&reminder_id=r1'))
      .toEqual({ pathname: '/(shell)/database' });
    expect(hrefForPortalPath('/unknown-module')).toEqual({ pathname: '/(shell)/menu' });
  });

  it('keeps account screens inside the native Menu stack', () => {
    expect(hrefForPortalPath('/profile')).toEqual({ pathname: '/(shell)/menu/profile' });
    expect(hrefForPortalPath('/settings/appearance')).toEqual({ pathname: '/(shell)/menu/settings/appearance' });
    expect(hrefForPortalPath('/admin/users')).toEqual({ pathname: '/(shell)/menu/admin/users' });
    expect(routePathForPortalPath('/settings/appearance')).toBe('/menu/settings/appearance');
  });

  it.each([
    ['/scan-center', 'EXPO_PUBLIC_NATIVE_SCAN_CENTER_ENABLED', '/(shell)/scan-center'],
    ['/computers', 'EXPO_PUBLIC_NATIVE_COMPUTERS_ENABLED', '/(shell)/computers'],
    ['/passwords', 'EXPO_PUBLIC_NATIVE_PASSWORDS_ENABLED', '/(shell)/passwords'],
    ['/groups-access', 'EXPO_PUBLIC_NATIVE_GROUPS_ACCESS_ENABLED', '/(shell)/groups-access'],
    ['/warehouse-1c', 'EXPO_PUBLIC_NATIVE_WAREHOUSE_1C_ENABLED', '/(shell)/warehouse-1c'],
    ['/mfu', 'EXPO_PUBLIC_NATIVE_MFU_ENABLED', '/(shell)/mfu'],
  ])('hides disabled native module %s and exposes it only when enabled', (path, envName, nativePath) => {
    expect(hrefForPortalPath(path)).toEqual({ pathname: '/(shell)/menu' });
    const previous = process.env[envName];
    process.env[envName] = 'true';
    jest.isolateModules(() => {
      const registry = require('./moduleRegistry') as typeof import('./moduleRegistry');
      expect(registry.hrefForPortalPath(path)).toEqual({ pathname: nativePath });
    });
    if (previous === undefined) delete process.env[envName];
    else process.env[envName] = previous;
  });
});

describe('resolveShellTabPath', () => {
  it.each([
    ['/menu/profile', '/menu'],
    ['/address-book', '/address-book'],
    ['/feed/post-1', '/feed'],
    ['/tasks/task-1', '/tasks'],
    ['/mail/compose', '/mail'],
    ['/database/INV-1', '/database'],
    ['/my-files', '/my-files'],
    ['/company-structure', '/company-structure'],
    ['/docflow/task-1', '/docflow'],
    ['/scan-center', '/scan-center'],
    ['/computers/AA-BB', '/computers'],
    ['/passwords', '/passwords'],
    ['/groups-access', '/groups-access'],
    ['/warehouse-1c', '/warehouse-1c'],
    ['/mfu', '/mfu'],
  ])('selects the owning native tab for %s', (pathname, expected) => {
    expect(resolveShellTabPath(pathname, '/dashboard')).toBe(expected);
  });
});
