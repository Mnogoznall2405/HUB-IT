export const NAVIGATION_DEBUG_STORAGE_KEY = 'itinvent:nav-debug';

let navigationDebugSeq = 0;

export const isNavigationDebugEnabled = () => {
  try {
    if (typeof window === 'undefined') return false;
    if (window.__itinventNavigationDebug === true) return true;
    const raw = String(window.localStorage.getItem(NAVIGATION_DEBUG_STORAGE_KEY) || '').trim().toLowerCase();
    if (!raw) return false;
    return !['0', 'false', 'off', 'no', 'disabled'].includes(raw);
  } catch {
    return false;
  }
};

export const pushNavigationDebugEntry = (event, details = {}) => {
  try {
    if (typeof window === 'undefined') return null;
    const entry = {
      seq: ++navigationDebugSeq,
      at: new Date().toISOString(),
      event: String(event || 'navigation:event').trim(),
      path: String(window.location?.pathname || ''),
      search: String(window.location?.search || ''),
      hash: String(window.location?.hash || ''),
      href: String(window.location?.href || ''),
      visibilityState: typeof document !== 'undefined' ? String(document.visibilityState || '') : '',
      details: details && typeof details === 'object' ? details : { value: details },
    };
    const current = Array.isArray(window.__itinventNavigationLog) ? window.__itinventNavigationLog : [];
    window.__itinventNavigationLog = [...current.slice(-199), entry];
    if (isNavigationDebugEnabled()) {
      console.info(`[nav-debug #${entry.seq}] ${entry.event}`, entry);
    }
    return entry;
  } catch {
    return null;
  }
};
