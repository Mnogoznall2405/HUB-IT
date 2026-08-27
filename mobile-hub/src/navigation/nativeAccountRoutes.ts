export const NATIVE_ACCOUNT_HREF_BY_PATH = {
  '/profile': '/(shell)/menu/profile',
  '/settings': '/(shell)/menu/settings',
  '/settings/appearance': '/(shell)/menu/settings/appearance',
  '/settings/notifications': '/(shell)/menu/settings/notifications',
  '/settings/security': '/(shell)/menu/settings/security',
  '/settings/app': '/(shell)/menu/settings/app',
  '/settings/about': '/(shell)/menu/settings/about',
  '/admin': '/(shell)/menu/admin',
  '/admin/users': '/(shell)/menu/admin/users',
  '/admin/departments': '/(shell)/menu/admin/departments',
  '/admin/sessions': '/(shell)/menu/admin/sessions',
} as const;

export type NativeAccountPortalPath = keyof typeof NATIVE_ACCOUNT_HREF_BY_PATH;
export type NativeAccountHref = (typeof NATIVE_ACCOUNT_HREF_BY_PATH)[NativeAccountPortalPath];

export function nativeAccountHrefFromPortalPath(path: string): NativeAccountHref | null {
  const pathname = String(path || '').split('?')[0];
  if (pathname in NATIVE_ACCOUNT_HREF_BY_PATH) {
    return NATIVE_ACCOUNT_HREF_BY_PATH[pathname as NativeAccountPortalPath];
  }
  return null;
}

export function isAccountTabPath(path: string): boolean {
  const pathname = String(path || '').split('?')[0];
  return ['/profile', '/settings', '/admin', '/menu'].some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function resolveShellTabPath(pathname: string, _legacyPath?: string): string {
  if (pathname === '/dashboard' || pathname.startsWith('/dashboard')) return '/dashboard';
  if (pathname === '/notifications') return '/dashboard';
  if (pathname === '/menu' || pathname.startsWith('/menu')) return '/menu';
  if (pathname === '/chat' || pathname.startsWith('/chat')) return '/chat';
  if (pathname === '/feed' || pathname.startsWith('/feed')) return '/feed';
  if (pathname === '/address-book' || pathname.startsWith('/address-book')) return '/address-book';
  if (pathname === '/tasks' || pathname.startsWith('/tasks/')) return '/tasks';
  if (pathname === '/mail' || pathname.startsWith('/mail/')) return '/mail';
  if (pathname === '/database' || pathname.startsWith('/database/')) return '/database';
  if (pathname === '/my-files' || pathname.startsWith('/my-files/')) return '/my-files';
  if (pathname === '/company-structure' || pathname.startsWith('/company-structure/')) return '/company-structure';
  if (pathname === '/docflow' || pathname.startsWith('/docflow/')) return '/docflow';
  if (pathname === '/scan-center' || pathname.startsWith('/scan-center/')) return '/scan-center';
  if (pathname === '/computers' || pathname.startsWith('/computers/')) return '/computers';
  if (pathname === '/passwords' || pathname.startsWith('/passwords/')) return '/passwords';
  if (pathname === '/groups-access' || pathname.startsWith('/groups-access/')) return '/groups-access';
  if (pathname === '/warehouse-1c' || pathname.startsWith('/warehouse-1c/')) return '/warehouse-1c';
  if (pathname === '/mfu' || pathname.startsWith('/mfu/')) return '/mfu';
  if (isAccountTabPath(pathname)) return '/menu';
  return '/dashboard';
}
