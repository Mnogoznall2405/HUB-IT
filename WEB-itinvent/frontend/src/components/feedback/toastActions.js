export const TOAST_ACTION_EXECUTE_EVENT = 'itinvent:toast-action-execute';

const SOURCE_ACTION_ROUTES = {
  hub: '/dashboard',
  tasks: '/tasks',
  database: '/database',
  networks: '/networks',
  statistics: '/statistics',
  settings: '/settings',
  mail: '/mail',
  mfu: '/mfu',
  computers: '/computers',
  scan: '/scan-center',
  'scan-center': '/scan-center',
};

const DEFAULT_ACTION_LABEL = 'Открыть';
const FALLBACK_ACTION_LABEL = 'Открыть раздел';

export function normalizeToastAction(action) {
  if (!action || typeof action !== 'object') return null;

  const kind = String(action.kind || '').trim().toLowerCase();
  if (kind === 'navigate') {
    const to = String(action.to || '').trim();
    if (!to) return null;
    return {
      kind: 'navigate',
      label: String(action.label || DEFAULT_ACTION_LABEL).trim() || DEFAULT_ACTION_LABEL,
      to,
    };
  }

  if (kind === 'external') {
    const href = String(action.href || '').trim();
    if (!href) return null;
    return {
      kind: 'external',
      label: String(action.label || DEFAULT_ACTION_LABEL).trim() || DEFAULT_ACTION_LABEL,
      href,
      target: String(action.target || '_blank').trim() || '_blank',
    };
  }

  return null;
}

export function createNavigateToastAction(to, label = DEFAULT_ACTION_LABEL) {
  return normalizeToastAction({ kind: 'navigate', to, label });
}

export function createExternalToastAction(href, label = DEFAULT_ACTION_LABEL, target = '_blank') {
  return normalizeToastAction({ kind: 'external', href, label, target });
}

export function resolveToastSourceFallbackAction(source) {
  const normalizedSource = String(source || '').trim().toLowerCase();
  const route = SOURCE_ACTION_ROUTES[normalizedSource];
  if (!route) return null;
  return {
    kind: 'navigate',
    label: FALLBACK_ACTION_LABEL,
    to: route,
  };
}

export function resolveToastHistoryAction(toast) {
  return normalizeToastAction(toast?.action) || resolveToastSourceFallbackAction(toast?.source);
}

export function executeToastAction(action, options = {}) {
  const normalized = normalizeToastAction(action);
  if (!normalized) return false;

  if (normalized.kind === 'external') {
    if (typeof window !== 'undefined' && typeof window.open === 'function') {
      window.open(normalized.href, normalized.target || '_blank', 'noopener,noreferrer');
    }
    return true;
  }

  if (normalized.kind === 'navigate') {
    if (typeof options.navigate === 'function') {
      options.navigate(normalized.to);
      return true;
    }
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new CustomEvent(TOAST_ACTION_EXECUTE_EVENT, { detail: normalized }));
      return true;
    }
  }

  return false;
}
