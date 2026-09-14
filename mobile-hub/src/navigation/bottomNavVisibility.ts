import { usePathname } from 'expo-router';

const HIDDEN_NAV_PREFIXES = [
  '/chat/',
  '/feed/',
  '/tasks/',
  '/mail/',
  '/database/',
  '/docflow/',
  '/computers/',
];

const HIDDEN_NAV_PATHS = new Set(['/notifications']);

export function isBottomNavHiddenPath(pathname: string): boolean {
  const path = String(pathname || '').trim();
  if (HIDDEN_NAV_PATHS.has(path)) return true;
  return HIDDEN_NAV_PREFIXES.some((prefix) => path.startsWith(prefix));
}

export function useBottomNavHidden(): boolean {
  return isBottomNavHiddenPath(usePathname());
}
