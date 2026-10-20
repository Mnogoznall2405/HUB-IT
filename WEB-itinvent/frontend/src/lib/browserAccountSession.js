export const BROWSER_ACCOUNT_EVENT = 'hubit:browser-account';
export const PREFERENCES_CACHE_KEY = 'web_preferences_cache';
const OWNER_KEY = 'hubit_browser_account';
let accountGeneration = 0;

export function captureBrowserAccountSession() {
  const userKey = getStoredUserKey();
  const generation = accountGeneration;
  return {
    userKey,
    isCurrent: () => Boolean(userKey) && generation === accountGeneration && getStoredUserKey() === userKey,
  };
}

export function getStoredUserKey() {
  if (typeof window === 'undefined') return '';
  try {
    const user = JSON.parse(localStorage.getItem('user') || 'null');
    return String(user?.id ?? user?.username ?? '');
  } catch {
    return '';
  }
}

export function getBrowserAccount() {
  const key = getStoredUserKey();
  return key && localStorage.getItem(OWNER_KEY) === key ? key : '';
}

// Keep the existing sign-in screen appearance without retaining account data.
export function presentationPreferences(value) {
  return Object.fromEntries(['theme_mode', 'font_family', 'font_scale']
    .filter((key) => value?.[key] !== undefined)
    .map((key) => [key, value[key]]));
}

export function synchronizeBrowserAccount(userKey = '') {
  const key = String(userKey || '');
  const previous = localStorage.getItem(OWNER_KEY) || '';
  const reset = previous !== key || !key;
  if (reset) {
    accountGeneration += 1;
    // The legacy shared history has no reliable account owner to migrate.
    localStorage.removeItem('mail_recent_searches_v1');
    localStorage.removeItem('itinvent_toast_history');
    localStorage.removeItem('itinvent_hub_seen_ids');
    let presentation = {};
    try {
      presentation = presentationPreferences(JSON.parse(localStorage.getItem(PREFERENCES_CACHE_KEY) || '{}'));
    } catch {
      // Discard malformed cache.
    }
    localStorage.setItem(PREFERENCES_CACHE_KEY, JSON.stringify(presentation));
    localStorage.removeItem('selected_database');
    localStorage.removeItem('database_branch_filters');
  }
  if (key) localStorage.setItem(OWNER_KEY, key);
  else localStorage.removeItem(OWNER_KEY);
  window.dispatchEvent(new CustomEvent(BROWSER_ACCOUNT_EVENT, { detail: { key, reset } }));
}
