import { useEffect, useRef } from 'react';

import { useAuth } from '../../contexts/AuthContext';
import { startDesktopLifecycleRecovery } from '../../lib/desktopLifecycle';

const DesktopLifecycleBootstrap = () => {
  const { user, refreshSession, isAuthenticated } = useAuth();
  const userRef = useRef(user);
  userRef.current = user;
  const isAuthenticatedRef = useRef(isAuthenticated);
  isAuthenticatedRef.current = isAuthenticated;
  const refreshSessionRef = useRef(refreshSession);
  refreshSessionRef.current = refreshSession;

  useEffect(() => startDesktopLifecycleRecovery({
    isAuthenticated: () => (
      typeof isAuthenticatedRef.current === 'function'
        ? Boolean(isAuthenticatedRef.current())
        : Boolean(userRef.current)
    ),
    refreshAuth: () => refreshSessionRef.current({ suppressAuthRequired: true }),
  }), []);

  return null;
};

export default DesktopLifecycleBootstrap;
