import { peekPostAuthReturnPath } from './aboutOnboarding';

export const DESKTOP_HANDOFF_PREFERENCE_KEY = 'hubit:desktop-handoff';
export const DESKTOP_HANDOFF_SESSION_SKIP_KEY = 'hubit:desktop-handoff-skip';
export const HUBIT_PROTOCOL_SCHEME = 'hubit';
export const MAXIMUM_HANDOFF_ROUTE_LENGTH = 1024;
export const MAXIMUM_PROTOCOL_HREF_LENGTH = 2048;

const EXACT_PATHS = new Set([
  '/',
  '/address-book',
  '/chat',
  '/company-structure',
  '/computers',
  '/dashboard',
  '/database',
  '/docflow',
  '/feed',
  '/kb',
  '/mail',
  '/mfu',
  '/my-files',
  '/networks',
  '/profile',
  '/scan-center',
  '/settings',
  '/statistics',
  '/tasks',
  '/tickets',
  '/vcs',
  '/warehouse-1c',
]);

const BLOCKED_PATH_PREFIXES = ['/login', '/shared-files', '/auth', '/reset'];
const BLOCKED_QUERY_KEYS = new Set([
  'access_token',
  'code',
  'download',
  'export',
  'key',
  'password',
  'refresh_token',
  'reset',
  'secret',
  'signature',
  'token',
]);

function hasControlCharacters(value) {
  return /[\u0000-\u001F\u007F-\u009F]/u.test(value);
}

function isDesktopWebViewHost(win = typeof window === 'undefined' ? undefined : window) {
  return typeof win?.chrome?.webview?.postMessage === 'function';
}

export function isWindowsDesktopBrowser({
  userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent,
  runtimeWindow = typeof window === 'undefined' ? undefined : window,
} = {}) {
  if (isDesktopWebViewHost(runtimeWindow)) return false;
  const ua = String(userAgent || '');
  return /Windows NT/i.test(ua) && !/Windows Phone/i.test(ua);
}

export function getDesktopHandoffPreference(storage = typeof window === 'undefined' ? null : window.localStorage) {
  try {
    return storage?.getItem(DESKTOP_HANDOFF_PREFERENCE_KEY) === 'never' ? 'never' : 'ask';
  } catch {
    return 'ask';
  }
}

export function setDesktopHandoffPreference(
  value,
  storage = typeof window === 'undefined' ? null : window.localStorage,
) {
  if (value !== 'never') {
    try {
      storage?.removeItem(DESKTOP_HANDOFF_PREFERENCE_KEY);
    } catch {
      // Ignore quota/private-mode failures.
    }
    return;
  }
  try {
    storage?.setItem(DESKTOP_HANDOFF_PREFERENCE_KEY, 'never');
  } catch {
    // Ignore quota/private-mode failures.
  }
}

export function isDesktopHandoffSkippedThisSession(
  storage = typeof window === 'undefined' ? null : window.sessionStorage,
) {
  try {
    return storage?.getItem(DESKTOP_HANDOFF_SESSION_SKIP_KEY) === '1';
  } catch {
    return false;
  }
}

export function skipDesktopHandoffThisSession(
  storage = typeof window === 'undefined' ? null : window.sessionStorage,
) {
  try {
    storage?.setItem(DESKTOP_HANDOFF_SESSION_SKIP_KEY, '1');
  } catch {
    // Ignore quota/private-mode failures.
  }
}

function hasValidPercentEncoding(value) {
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] !== '%') continue;
    if (
      index + 2 >= value.length
      || !/^[0-9a-fA-F]$/u.test(value[index + 1])
      || !/^[0-9a-fA-F]$/u.test(value[index + 2])
    ) {
      return false;
    }
    index += 2;
  }
  return true;
}

function decodeQueryKey(rawKey) {
  const normalized = String(rawKey || '').replace(/\+/g, ' ');
  if (!hasValidPercentEncoding(normalized)) return null;
  try {
    const once = decodeURIComponent(normalized);
    if (!hasValidPercentEncoding(once)) return null;
    return decodeURIComponent(once).trim();
  } catch {
    return null;
  }
}

function containsBlockedQuery(search) {
  const query = String(search || '').replace(/^\?/u, '');
  if (!query) return false;
  return query.split('&').filter(Boolean).some((pair) => {
    const separator = pair.indexOf('=');
    const rawKey = separator >= 0 ? pair.slice(0, separator) : pair;
    const key = decodeQueryKey(rawKey);
    if (!key) return true;
    return (
      BLOCKED_QUERY_KEYS.has(key.toLowerCase())
      || key.toLowerCase().includes('token')
      || key.toLowerCase().includes('password')
    );
  });
}

function isAllowedParameterizedPath(pathname) {
  const normalized = String(pathname || '');
  if (!normalized.toLowerCase().startsWith('/networks/')) return false;
  const branchId = normalized.slice('/networks/'.length);
  return (
    branchId.length > 0
    && branchId.length <= 128
    && !branchId.includes('/')
    && /^[A-Za-z0-9._~-]+$/u.test(branchId)
  );
}

export function normalizeHandoffRoute(value) {
  const candidate = String(value || '').trim();
  if (
    !candidate
    || candidate.length > MAXIMUM_HANDOFF_ROUTE_LENGTH
    || !candidate.startsWith('/')
    || candidate.startsWith('//')
    || candidate.includes('\\')
    || candidate.includes('#')
    || hasControlCharacters(candidate)
  ) {
    return '';
  }

  let parsed;
  try {
    parsed = new URL(candidate, 'https://hub.invalid/');
  } catch {
    return '';
  }
  if (parsed.origin !== 'https://hub.invalid') return '';

  const escapedPath = parsed.pathname || '/';
  if (
    /%2f/i.test(escapedPath)
    || /%5c/i.test(escapedPath)
    || /%25/i.test(escapedPath)
  ) {
    return '';
  }

  const path = `/${escapedPath.replace(/^\/+/u, '')}`.replace(/\/+$/u, '') || '/';
  if (
    BLOCKED_PATH_PREFIXES.some((prefix) => (
      path.toLowerCase() === prefix
      || path.toLowerCase().startsWith(`${prefix}/`)
    ))
  ) {
    return '';
  }

  if (!EXACT_PATHS.has(path.toLowerCase()) && !isAllowedParameterizedPath(path)) {
    return '';
  }

  if (containsBlockedQuery(parsed.search)) return '';

  return parsed.search ? `${path}${parsed.search}` : path;
}

export function buildHubitProtocolHref(route) {
  const normalized = normalizeHandoffRoute(route);
  if (!normalized) return '';
  const href = `${HUBIT_PROTOCOL_SCHEME}://open${normalized}`;
  return href.length <= MAXIMUM_PROTOCOL_HREF_LENGTH ? href : '';
}

export function resolveHandoffRoute(pathname, search, {
  peekReturnPath = peekPostAuthReturnPath,
} = {}) {
  const current = `${String(pathname || '')}${String(search || '')}`;
  const fromCurrent = normalizeHandoffRoute(current);
  if (fromCurrent) return fromCurrent;

  const currentPath = String(pathname || '');
  if (currentPath === '/login' || currentPath === '/') {
    return normalizeHandoffRoute(peekReturnPath?.() || '');
  }
  return '';
}

export function launchHubitProtocol(href, { click } = {}) {
  const protocolHref = String(href || '');
  if (!protocolHref.startsWith(`${HUBIT_PROTOCOL_SCHEME}://open/`)) return false;
  if (typeof click === 'function') {
    click(protocolHref);
    return true;
  }
  if (typeof document === 'undefined') return false;

  const anchor = document.createElement('a');
  anchor.href = protocolHref;
  anchor.rel = 'noreferrer';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  return true;
}

export function canOfferDesktopHandoff(options) {
  if (!isWindowsDesktopBrowser(options)) return false;
  if (getDesktopHandoffPreference(options?.localStorage) === 'never') return false;
  if (isDesktopHandoffSkippedThisSession(options?.sessionStorage)) return false;
  return true;
}
