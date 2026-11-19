import { useContext, useLayoutEffect, useRef, useState } from 'react';
import { UNSAFE_NavigationContext } from 'react-router-dom';

let activePopGuard = null;
// App imports this before BrowserRouter mounts. Its history listener can
// synchronously unmount the editor, so POP protection must be registered first.
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', (event) => activePopGuard?.(event), true);
}

// BrowserRouter has no data-router blocker. Several editor instances can guard
// at once, so the navigator patch is shared per navigator: each instance only
// subscribes, and the last subscribed (innermost dialog) asks first. Restoring
// originals happens only when the last subscriber unmounts, so unmount order
// can no longer leave a dead wrapper on the navigator.
const navigatorGuards = new WeakMap();

const ensureNavigatorGuard = (navigator) => {
  let guard = navigatorGuards.get(navigator);
  if (guard) return guard;
  const originals = { push: navigator.push, replace: navigator.replace, go: navigator.go };
  const subscribers = new Set();
  const wrappers = {};
  for (const method of ['push', 'replace', 'go']) {
    wrappers[method] = (...args) => {
      const target = args[0];
      const pathname = typeof target === 'string' ? new URL(target, window.location.href).pathname : target?.pathname;
      const blockers = [...subscribers].filter((entry) => entry.isBlocked(method, pathname));
      if (!blockers.length) {
        const result = originals[method].apply(navigator, args);
        subscribers.forEach((entry) => entry.onNavigated?.(method));
        return result;
      }
      blockers[blockers.length - 1].requestLeave(method, args);
      return undefined;
    };
    navigator[method] = wrappers[method];
  }
  guard = { originals, wrappers, subscribers };
  navigatorGuards.set(navigator, guard);
  return guard;
};

const releaseNavigatorGuard = (navigator, entry) => {
  const guard = navigatorGuards.get(navigator);
  if (!guard) return;
  guard.subscribers.delete(entry);
  if (guard.subscribers.size === 0) {
    for (const method of Object.keys(guard.originals)) {
      if (navigator[method] === guard.wrappers[method]) navigator[method] = guard.originals[method];
    }
    navigatorGuards.delete(navigator);
  }
};

export function useConstructionWorkLeaveGuard(dirty) {
  const context = useContext(UNSAFE_NavigationContext);
  const [pending, setPending] = useState(null);
  const allowed = useRef(false);
  useLayoutEffect(() => {
    if (!dirty || !context?.navigator) return undefined;
    const navigator = context.navigator;
    const guard = ensureNavigatorGuard(navigator);
    const readIndex = (state = window.history.state) => {
      const nativeIndex = window.navigation?.currentEntry?.index;
      return Number.isInteger(nativeIndex) && nativeIndex >= 0 ? nativeIndex : state?.idx;
    };
    let index = readIndex();
    let currentUrl = window.location.href;
    let currentState = window.history.state;
    let restoring = false;
    let afterRestore = null;
    let currentPath = navigator.location?.pathname || window.location.pathname;
    const run = (method, args) => {
      const result = guard.originals[method].apply(navigator, args);
      if (method !== 'go') {
        index = readIndex();
        currentUrl = window.location.href;
        currentState = window.history.state;
        currentPath = navigator.location?.pathname || window.location.pathname;
      }
      return result;
    };
    const entry = {
      isBlocked: (method, pathname) => (
        !allowed.current
        && !(method !== 'go' && (!pathname || pathname === currentPath || /\/(login|logout)\/?$/.test(pathname)))
      ),
      onNavigated: (method) => {
        if (method !== 'go') {
          index = readIndex();
          currentUrl = window.location.href;
          currentState = window.history.state;
          currentPath = navigator.location?.pathname || window.location.pathname;
        }
      },
      requestLeave: (method, args) => {
        setPending({ go: method === 'go', run: () => run(method, args) });
      },
    };
    guard.subscribers.add(entry);
    const onPop = (event) => {
      if (allowed.current) { allowed.current = false; index = readIndex(event.state); currentPath = window.location.pathname; currentUrl = window.location.href; currentState = event.state; return; }
      const nextIndex = readIndex(event.state);
      if (restoring) {
        event.stopImmediatePropagation();
        restoring = false;
        setPending(afterRestore);
        afterRestore = null;
        return;
      }
      if (window.location.pathname === currentPath) { index = nextIndex; currentUrl = window.location.href; currentState = event.state; return; }
      const delta = nextIndex - index;
      event.stopImmediatePropagation();
      if (!Number.isInteger(index) || !Number.isInteger(nextIndex) || !delta) {
        // Some older routes replace history.state or reuse idx. Keep the editor
        // mounted even when the browser exposes no reliable traversal distance.
        const destination = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        const state = event.state?.usr;
        window.history.pushState({ ...currentState, idx: Number.isInteger(currentState?.idx) ? currentState.idx : 0 }, '', currentUrl);
        index = readIndex();
        setPending({ go: false, run: () => run('replace', [destination, state]) });
        return;
      }
      restoring = true;
      afterRestore = { go: true, run: () => guard.originals.go.call(navigator, delta) };
      window.history.go(-delta);
    };
    activePopGuard = onPop;
    return () => {
      allowed.current = false;
      if (activePopGuard === onPop) activePopGuard = null;
      releaseNavigatorGuard(navigator, entry);
    };
  }, [context?.navigator, dirty]);
  return {
    pending: Boolean(pending),
    cancel: () => setPending(null),
    leave: () => { allowed.current = Boolean(pending?.go); const navigate = pending?.run; setPending(null); navigate?.(); },
  };
}
