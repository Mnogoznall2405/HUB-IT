/**
 * Safe Web Storage accessors.
 *
 * localStorage/sessionStorage throw in blocked-storage environments (Safari
 * private mode, strict cookie policies, some WebView sandboxes). Hot paths —
 * the axios request interceptor, session restore, route guards — must never
 * die on a storage read, so every call here swallows DOMException/SecurityError
 * and degrades to "no stored value" semantics.
 */

const getStorage = (kind) => {
  try {
    if (typeof window === 'undefined') return null;
    return kind === 'session' ? window.sessionStorage : window.localStorage;
  } catch {
    return null;
  }
};

const safeCall = (fn, fallback = null) => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

export const safeLocalGetItem = (key) => (
  safeCall(() => getStorage('local')?.getItem(key) ?? null)
);

export const safeLocalSetItem = (key, value) => {
  safeCall(() => {
    getStorage('local')?.setItem(key, value);
  });
};

export const safeLocalRemoveItem = (key) => {
  safeCall(() => {
    getStorage('local')?.removeItem(key);
  });
};

export const safeSessionGetItem = (key) => (
  safeCall(() => getStorage('session')?.getItem(key) ?? null)
);

export const safeSessionSetItem = (key, value) => {
  safeCall(() => {
    getStorage('session')?.setItem(key, value);
  });
};

export const safeSessionRemoveItem = (key) => {
  safeCall(() => {
    getStorage('session')?.removeItem(key);
  });
};
