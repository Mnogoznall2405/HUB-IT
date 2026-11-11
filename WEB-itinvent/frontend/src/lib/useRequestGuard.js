import { useCallback, useEffect, useRef } from 'react';

// A response belongs to both its request and the UI context that started it.
export default function useRequestGuard(scope) {
  const current = useRef({ scope, version: 0 });
  if (current.current.scope !== scope) {
    current.current = { scope, version: current.current.version + 1 };
  }
  useEffect(() => () => { current.current.version += 1; }, []);
  return useCallback(() => {
    const version = ++current.current.version;
    return () => current.current.version === version;
  }, []);
}
