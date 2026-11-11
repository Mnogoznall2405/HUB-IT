export const DEFAULT_MOBILE_BOTTOM_NAV_ITEMS = ['/dashboard', '/tasks', '/chat', '/mail'];
export const MOBILE_BOTTOM_NAV_ALLOWED_PATHS = [
  '/dashboard',
  '/tasks',
  '/tickets',
  '/chat',
  '/mail',
  '/address-book',
  '/passwords',
  '/my-files',
  '/database',
  '/networks',
  '/vcs',
  '/mfu',
  '/computers',
  '/scan-center',
  '/statistics',
  '/kb',
];

export function normalizeMobileBottomNavItems(value, fallback = DEFAULT_MOBILE_BOTTOM_NAV_ITEMS) {
  if (!Array.isArray(value)) return [...fallback];
  const result = [];
  value.forEach((item) => {
    const path = String(item || '').trim();
    if (
      MOBILE_BOTTOM_NAV_ALLOWED_PATHS.includes(path)
      && !result.includes(path)
      && result.length < 4
    ) {
      result.push(path);
    }
  });
  return result;
}
