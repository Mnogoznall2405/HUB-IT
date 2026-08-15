export const ABOUT_RETURN_TO_STORAGE_KEY = 'hubit.auth.return-to';

const BLOCKED_RETURN_PATHS = new Set(['/login', '/about']);

export function needsAboutOnboarding(user) {
  return Boolean(
    user
    && Object.prototype.hasOwnProperty.call(user, 'about_onboarding_completed_at')
    && user.about_onboarding_completed_at === null,
  );
}

export function normalizeInternalReturnPath(value) {
  const candidate = String(value || '').trim();
  if (!candidate.startsWith('/') || candidate.startsWith('//') || candidate.includes('\\')) {
    return '';
  }
  if (/\p{Cc}/u.test(candidate)) {
    return '';
  }

  try {
    const parsed = new URL(candidate, 'https://hubit.invalid');
    if (parsed.origin !== 'https://hubit.invalid') return '';
    const normalizedPathname = parsed.pathname.replace(/\/+$/, '') || '/';
    if (BLOCKED_RETURN_PATHS.has(normalizedPathname)) return '';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return '';
  }
}

export function rememberPostAuthReturnPath(value) {
  const safePath = normalizeInternalReturnPath(value);
  if (!safePath || typeof window === 'undefined') return '';
  window.sessionStorage.setItem(ABOUT_RETURN_TO_STORAGE_KEY, safePath);
  return safePath;
}

export function peekPostAuthReturnPath() {
  if (typeof window === 'undefined') return '';
  const safePath = normalizeInternalReturnPath(
    window.sessionStorage.getItem(ABOUT_RETURN_TO_STORAGE_KEY),
  );
  if (!safePath) {
    window.sessionStorage.removeItem(ABOUT_RETURN_TO_STORAGE_KEY);
  }
  return safePath;
}

export function consumePostAuthReturnPath() {
  const safePath = peekPostAuthReturnPath();
  if (typeof window !== 'undefined') {
    window.sessionStorage.removeItem(ABOUT_RETURN_TO_STORAGE_KEY);
  }
  return safePath;
}

export function resolvePostAuthenticationPath(user, fallbackPath = '/dashboard') {
  if (needsAboutOnboarding(user)) return '/about';
  return consumePostAuthReturnPath() || normalizeInternalReturnPath(fallbackPath) || '/dashboard';
}

export function resolveAfterAboutOnboardingPath() {
  return consumePostAuthReturnPath() || '/';
}
