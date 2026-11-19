import { useCallback, useMemo, useState } from 'react';
import { matchPath, Outlet, useLocation } from 'react-router-dom';
import { MainLayoutInner } from './MainLayout';
import { MainLayoutRouteContext } from './MainLayoutShellContext';

// Mirrors the `handle={{ hubBare: true }}` routes in App.jsx. If a new
// self-chrome route is added there, add its path pattern here too — a missed
// entry only means the page also gets the portal chrome, never a crash.
const HUB_BARE_PATTERNS = [
  '/chat',
  '/scan-center',
  '/voice',
  '/profile',
  '/settings/:section?',
  '/admin/:section?',
];

const SHELL_PROP_KEYS = [
  'headerMode',
  'pageTitle',
  'contentMode',
  'mobileBottomNavMode',
  'mobileBottomNavTransitionMs',
  'showDatabaseSelector',
  'headerInlineContent',
];

function shellPropsEqual(a, b) {
  return SHELL_PROP_KEYS.every((key) => Object.is(a?.[key], b?.[key]));
}

export default function MainLayoutRouteShell() {
  const [shellProps, setShellProps] = useState(null);
  const register = useCallback((props) => {
    setShellProps((prev) => (prev && shellPropsEqual(prev, props) ? prev : props));
  }, []);
  const unregister = useCallback((props) => {
    setShellProps((prev) => (prev && shellPropsEqual(prev, props) ? null : prev));
  }, []);
  const routeCtx = useMemo(() => ({ register, unregister }), [register, unregister]);
  // Pages that render their own chrome (chat, admin, settings, …) opt out via
  // route handle so the Outlet never changes parents: the first registration
  // used to swap `<Outlet/>` for `<MainLayoutInner><Outlet/></MainLayoutInner>`
  // and remount the whole page subtree. `useMatches` cannot read those handles:
  // it only exists inside data routers and this app mounts `<Routes>` — match
  // the same handle patterns statically (keep in sync with App.jsx hubBare).
  const { pathname } = useLocation();
  const bare = HUB_BARE_PATTERNS.some(
    (pattern) => matchPath({ path: pattern, end: true }, pathname),
  );
  return (
    <MainLayoutRouteContext.Provider value={routeCtx}>
      {bare
        // Headless shell: same runtime/effects, but pages draw their own chrome.
        ? <MainLayoutInner {...(shellProps || {})} headerMode="hidden" bare><Outlet /></MainLayoutInner>
        : <MainLayoutInner {...(shellProps || {})}><Outlet /></MainLayoutInner>}
    </MainLayoutRouteContext.Provider>
  );
}
