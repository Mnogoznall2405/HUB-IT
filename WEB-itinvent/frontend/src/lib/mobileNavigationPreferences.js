export const DEFAULT_MOBILE_BOTTOM_NAV_ITEMS = ['/dashboard', '/tasks', '/chat', '/mail'];

export function normalizeMobileBottomNavItems(value, fallback = DEFAULT_MOBILE_BOTTOM_NAV_ITEMS) {
  if (!Array.isArray(value)) return [...fallback];
  const result = [];
  value.forEach((item) => {
    const path = String(item || '').trim();
    if (path.startsWith('/') && !result.includes(path) && result.length < 4) {
      result.push(path);
    }
  });
  return result;
}
