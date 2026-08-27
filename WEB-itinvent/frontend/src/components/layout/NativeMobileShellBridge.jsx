import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  isSafeNativeShellPath,
  NATIVE_SHELL_NAVIGATE_EVENT,
} from '../../lib/nativeShell';

export default function NativeMobileShellBridge() {
  const navigate = useNavigate();

  useEffect(() => {
    const onNavigate = (event) => {
      const path = String(event?.detail?.path || '').trim();
      if (!isSafeNativeShellPath(path)) return;
      navigate(path);
    };
    window.addEventListener(NATIVE_SHELL_NAVIGATE_EVENT, onNavigate);
    return () => window.removeEventListener(NATIVE_SHELL_NAVIGATE_EVENT, onNavigate);
  }, [navigate]);

  return null;
}
