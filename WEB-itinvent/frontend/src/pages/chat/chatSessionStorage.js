export function readSessionStorageValue(storageKey) {
  const normalizedStorageKey = String(storageKey || '').trim();
  if (!normalizedStorageKey) return '';
  try {
    return String(window.sessionStorage.getItem(normalizedStorageKey) || '').trim();
  } catch {
    return '';
  }
}

export function readSelectedDatabaseId() {
  if (typeof window === 'undefined') return '';
  try {
    return String(window.localStorage.getItem('selected_database') || '').trim();
  } catch {
    return '';
  }
}

export function resolveRestoredMobileView(lastMobileViewSessionKey) {
  return readSessionStorageValue(lastMobileViewSessionKey) === 'thread' ? 'thread' : 'inbox';
}
