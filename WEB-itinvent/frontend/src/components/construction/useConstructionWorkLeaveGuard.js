import { useContext, useLayoutEffect, useRef, useState } from 'react';
import { UNSAFE_NavigationContext } from 'react-router-dom';

let activePopGuard = null;
// App imports this before BrowserRouter mounts. Its history listener can
// synchronously unmount the editor, so POP protection must be registered first.
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', (event) => activePopGuard?.(event), true);
}

// BrowserRouter has no data-router blocker. Guard its navigator and restore a
// browser POP before asking, so cancelling keeps both the route and journal.
export function useConstructionWorkLeaveGuard(dirty) {
  const context = useContext(UNSAFE_NavigationContext);
  const [pending, setPending] = useState(null);
  const allowed = useRef(false);
  useLayoutEffect(() => {
    if (!dirty || !context?.navigator) return undefined;
    const navigator = context.navigator;
    const originals = { push: navigator.push, replace: navigator.replace, go: navigator.go };
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
      const result = originals[method].apply(navigator, args);
      if (method !== 'go') {
        index = readIndex();
        currentUrl = window.location.href;
        currentState = window.history.state;
        currentPath = navigator.location?.pathname || window.location.pathname;
      }
      return result;
    };
    const wrappers = {};
    for (const method of ['push', 'replace', 'go']) {
      wrappers[method] = (...args) => {
        const target = args[0];
        const pathname = typeof target === 'string' ? new URL(target, window.location.href).pathname : target?.pathname;
        // Search changes switch construction tabs without unmounting the editor.
        // Authentication redirects must remain available on session expiration.
        if (allowed.current || (method !== 'go' && (!pathname || pathname === currentPath || /\/(login|logout)\/?$/.test(pathname)))) {
          return run(method, args);
        }
        setPending({ go: method === 'go', run: () => run(method, args) });
        return undefined;
      };
      navigator[method] = wrappers[method];
    }
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
      afterRestore = { go: true, run: () => originals.go.call(navigator, delta) };
      window.history.go(-delta);
    };
    activePopGuard = onPop;
    return () => {
      allowed.current = false;
      if (activePopGuard === onPop) activePopGuard = null;
      for (const method of Object.keys(originals)) {
        if (navigator[method] === wrappers[method]) navigator[method] = originals[method];
      }
    };
  }, [context?.navigator, dirty]);
  return {
    pending: Boolean(pending),
    cancel: () => setPending(null),
    leave: () => { allowed.current = Boolean(pending?.go); const navigate = pending?.run; setPending(null); navigate?.(); },
  };
}
