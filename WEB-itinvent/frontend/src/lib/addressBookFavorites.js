// Per-user address-book favorites and recently-opened entries.
// Only employee_code values are persisted — never names, phones or emails.
// All storage access is wrapped so private mode / disabled storage degrade
// to an in-memory session copy without breaking the page.

export const ADDRESS_BOOK_MAX_FAVORITES = 50;
export const ADDRESS_BOOK_MAX_RECENT = 20;

const memoryFallback = new Map();

const storageKey = (kind, userKey) => `hubit.addressBook.${kind}.${userKey || 'anon'}`;

const readCodes = (kind, userKey) => {
  const key = storageKey(kind, userKey);
  let raw = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    raw = memoryFallback.get(key) || null;
  }
  if (raw == null) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((code) => String(code || '').trim())
      .filter(Boolean);
  } catch {
    // Corrupted JSON must not break the page.
    return [];
  }
};

const writeCodes = (kind, userKey, codes) => {
  const key = storageKey(kind, userKey);
  const list = (Array.isArray(codes) ? codes : [])
    .map((code) => String(code || '').trim())
    .filter(Boolean);
  try {
    window.localStorage.setItem(key, JSON.stringify(list));
  } catch {
    memoryFallback.set(key, JSON.stringify(list));
  }
  return list;
};

export const getFavoriteEmployeeCodes = (userKey) => readCodes('favorites', userKey);

export const isFavoriteEmployee = (userKey, employeeCode) => (
  getFavoriteEmployeeCodes(userKey).includes(String(employeeCode || '').trim())
);

export const toggleFavoriteEmployee = (userKey, employeeCode) => {
  const code = String(employeeCode || '').trim();
  if (!code) return { codes: getFavoriteEmployeeCodes(userKey), active: false };
  const current = getFavoriteEmployeeCodes(userKey);
  const existing = current.indexOf(code);
  let next;
  let active;
  if (existing >= 0) {
    next = current.filter((item) => item !== code);
    active = false;
  } else {
    next = [code, ...current].slice(0, ADDRESS_BOOK_MAX_FAVORITES);
    active = true;
  }
  writeCodes('favorites', userKey, next);
  return { codes: next, active };
};

export const getRecentEmployeeCodes = (userKey) => readCodes('recent', userKey);

export const pushRecentEmployee = (userKey, employeeCode) => {
  const code = String(employeeCode || '').trim();
  if (!code) return getRecentEmployeeCodes(userKey);
  const next = [
    code,
    ...getRecentEmployeeCodes(userKey).filter((item) => item !== code),
  ].slice(0, ADDRESS_BOOK_MAX_RECENT);
  writeCodes('recent', userKey, next);
  return next;
};

export const clearRecentEmployees = (userKey) => {
  writeCodes('recent', userKey, []);
  return [];
};
