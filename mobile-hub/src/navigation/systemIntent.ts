import { HUB_WEB_ORIGIN } from '../api/config';
import { normalizeNativeRoutePath } from './nativeRoutePath';
import { routePathForPortalPath } from './moduleRegistry';

let pendingPortalPath = '';

function nativeRoute(path: string): string {
  return routePathForPortalPath(normalizeNativeRoutePath(path));
}

export function routeSystemIntentPath(rawPath: string): string {
  const raw = String(rawPath || '').trim();
  if (!raw) return '/';

  try {
    const hubOrigin = new URL(HUB_WEB_ORIGIN).origin;
    const parsed = new URL(raw);
    if (parsed.origin === hubOrigin && parsed.protocol === 'https:') {
      return nativeRoute(`${parsed.pathname}${parsed.search}${parsed.hash}`);
    }
    if (parsed.protocol === 'hubit:') {
      if (parsed.hostname === 'portal') {
        return nativeRoute(parsed.searchParams.get('path') || '/dashboard');
      }
      const nativePath = `/${parsed.hostname}${parsed.pathname}`.replace(/\/{2,}/g, '/');
      return nativeRoute(`${nativePath}${parsed.search}${parsed.hash}`);
    }
    return '/';
  } catch {
    if (raw.startsWith('/portal') || raw.startsWith('/web')) {
      try {
        const parsed = new URL(raw, 'https://hubit.native');
        return nativeRoute(parsed.searchParams.get('path') || '/dashboard');
      } catch {
        return '/';
      }
    }
    if (raw.startsWith('/') && !raw.startsWith('//') && !raw.includes('\\')) {
      return nativeRoute(raw);
    }
    return '/';
  }
}

function portalPathFromNativeRoute(destination: string): string | null {
  try {
    const parsed = new URL(destination, 'https://hubit.native');
    if (parsed.pathname === '/portal' || parsed.pathname === '/web' || parsed.pathname === '/(shell)/web') {
      return normalizeNativeRoutePath(parsed.searchParams.get('path') || '/dashboard');
    }
    if (parsed.pathname === '/dashboard' || parsed.pathname === '/(shell)/dashboard') {
      return '/dashboard';
    }
    if (parsed.pathname === '/menu' || parsed.pathname === '/(shell)/menu') {
      return '/menu';
    }
    if (parsed.pathname === '/chat' || parsed.pathname === '/(shell)/chat') {
      return '/chat';
    }
    if (parsed.pathname === '/tasks' || parsed.pathname === '/(shell)/tasks') {
      const query = new URLSearchParams();
      for (const key of ['q', 'status', 'focus_mode']) {
        const value = parsed.searchParams.get(key);
        if (value) query.set(key, value);
      }
      const suffix = query.toString();
      return `/tasks${suffix ? `?${suffix}` : ''}`;
    }
    if (parsed.pathname === '/tasks/create' || parsed.pathname === '/(shell)/tasks/create') {
      return '/tasks?create=1';
    }
    if (parsed.pathname === '/mail' || parsed.pathname === '/(shell)/mail') {
      const query = new URLSearchParams();
      const mailboxId = parsed.searchParams.get('mailboxId');
      if (mailboxId) query.set('mailbox_id', mailboxId);
      for (const key of ['folder', 'q', 'view', 'unread_only', 'has_attachments']) {
        const value = parsed.searchParams.get(key);
        if (value) query.set(key, value);
      }
      const suffix = query.toString();
      return `/mail${suffix ? `?${suffix}` : ''}`;
    }
    if (parsed.pathname === '/mail/compose' || parsed.pathname === '/(shell)/mail/compose') {
      const query = new URLSearchParams();
      const mode = parsed.searchParams.get('mode') || 'new';
      const draftId = parsed.searchParams.get('draftId');
      if (draftId) query.set('draft_id', draftId);
      else query.set('compose', mode);
      const mailboxId = parsed.searchParams.get('mailboxId');
      const sourceMessageId = parsed.searchParams.get('sourceMessageId');
      const to = parsed.searchParams.get('to');
      const subject = parsed.searchParams.get('subject');
      if (mailboxId) query.set('mailbox_id', mailboxId);
      if (sourceMessageId) query.set('message', sourceMessageId);
      if (to) query.set('compose_to', to);
      if (subject) query.set('subject', subject);
      return `/mail?${query.toString()}`;
    }
    if (parsed.pathname === '/database' || parsed.pathname === '/(shell)/database') {
      const query = new URLSearchParams();
      for (const key of ['q', 'mode']) {
        const value = parsed.searchParams.get(key);
        if (value) query.set(key, value);
      }
      const suffix = query.toString();
      return `/database${suffix ? `?${suffix}` : ''}`;
    }
    if (parsed.pathname === '/my-files' || parsed.pathname === '/(shell)/my-files') {
      return '/my-files';
    }
    if (parsed.pathname === '/company-structure' || parsed.pathname === '/(shell)/company-structure') {
      const query = new URLSearchParams();
      const nodeId = parsed.searchParams.get('nodeId');
      const blockId = parsed.searchParams.get('blockId');
      if (nodeId) query.set('node', nodeId);
      if (blockId) query.set('block', blockId);
      if (nodeId || blockId) query.set('view', 'focus');
      const suffix = query.toString();
      return `/company-structure${suffix ? `?${suffix}` : ''}`;
    }
    if (parsed.pathname === '/docflow' || parsed.pathname === '/(shell)/docflow') {
      return '/docflow';
    }
    if (/^(?:\/\(shell\))?\/docflow\/[^/]+$/.test(parsed.pathname)) {
      return '/docflow';
    }
    if (parsed.pathname === '/scan-center' || parsed.pathname === '/(shell)/scan-center') {
      return '/scan-center';
    }
    if (parsed.pathname === '/computers' || parsed.pathname === '/(shell)/computers') {
      const q = parsed.searchParams.get('q');
      return q ? `/computers?q=${encodeURIComponent(q)}` : '/computers';
    }
    if (/^(?:\/\(shell\))?\/computers\/[^/]+$/.test(parsed.pathname)) {
      const q = parsed.searchParams.get('q');
      return q ? `/computers?q=${encodeURIComponent(q)}` : '/computers';
    }
    if (parsed.pathname === '/passwords' || parsed.pathname === '/(shell)/passwords') {
      return '/passwords';
    }
    if (parsed.pathname === '/groups-access' || parsed.pathname === '/(shell)/groups-access') {
      return '/groups-access';
    }
    if (parsed.pathname === '/warehouse-1c' || parsed.pathname === '/(shell)/warehouse-1c') {
      return '/warehouse-1c';
    }
    if (parsed.pathname === '/mfu' || parsed.pathname === '/(shell)/mfu') {
      return '/mfu';
    }
    const databaseMatch = parsed.pathname.match(/^(?:\/\(shell\))?\/database\/([^/]+)$/);
    if (databaseMatch) {
      const query = new URLSearchParams();
      query.set('inv_no', decodeURIComponent(databaseMatch[1]));
      const databaseId = parsed.searchParams.get('databaseId');
      const tab = parsed.searchParams.get('tab');
      if (databaseId) query.set('db_id', databaseId);
      if (tab) query.set('tab', tab);
      return `/database?${query.toString()}`;
    }
    const mailConversationMatch = parsed.pathname.match(/^(?:\/\(shell\))?\/mail\/conversation\/([^/]+)$/);
    if (mailConversationMatch) {
      const query = new URLSearchParams();
      query.set('conversation', decodeURIComponent(mailConversationMatch[1]));
      const mailboxId = parsed.searchParams.get('mailboxId');
      const folder = parsed.searchParams.get('folder');
      if (mailboxId) query.set('mailbox_id', mailboxId);
      if (folder) query.set('folder', folder);
      return `/mail?${query.toString()}`;
    }
    const mailMessageMatch = parsed.pathname.match(/^(?:\/\(shell\))?\/mail\/([^/]+)$/);
    if (mailMessageMatch) {
      const query = new URLSearchParams();
      query.set('message', decodeURIComponent(mailMessageMatch[1]));
      const mailboxId = parsed.searchParams.get('mailboxId');
      const folder = parsed.searchParams.get('folder');
      if (mailboxId) query.set('mailbox_id', mailboxId);
      if (folder) query.set('folder', folder);
      return `/mail?${query.toString()}`;
    }
    const taskMatch = parsed.pathname.match(/^(?:\/\(shell\))?\/tasks\/([^/]+)$/);
    if (taskMatch) {
      return `/tasks?task=${encodeURIComponent(decodeURIComponent(taskMatch[1]))}`;
    }
    const chatMatch = parsed.pathname.match(/^\/chat\/([^/]+)$/);
    if (chatMatch) {
      const message = parsed.searchParams.get('message');
      return message
        ? `/chat?conversation=${encodeURIComponent(chatMatch[1])}&message=${encodeURIComponent(message)}`
        : `/chat?conversation=${encodeURIComponent(chatMatch[1])}`;
    }
    if (parsed.pathname.startsWith('/') && !parsed.pathname.startsWith('//')) {
      return normalizeNativeRoutePath(`${parsed.pathname}${parsed.search}${parsed.hash}`);
    }
    return null;
  } catch {
    return null;
  }
}

export function rememberSystemIntentDestination(destination: string): void {
  const path = portalPathFromNativeRoute(destination);
  if (path) pendingPortalPath = path;
}

export function consumePendingPortalPath(): string {
  const path = pendingPortalPath;
  pendingPortalPath = '';
  return path;
}

export function clearPendingPortalPathForTests(): void {
  pendingPortalPath = '';
}
