import { useEffect, useState } from 'react';
import { createMailVisibilityRefreshScheduler } from './mailVisibilityRefresh';

export const MAIL_ACTIVE_REFRESH_INTERVAL_MS = 20_000;

export default function useMailViewRefreshController({
  silentRevalidateCurrentMailView,
  intervalMs = MAIL_ACTIVE_REFRESH_INTERVAL_MS,
} = {}) {
  const [pageVisible, setPageVisible] = useState(() => (
    typeof document === 'undefined' ? true : document.visibilityState === 'visible'
  ));

  useEffect(() => {
    if (typeof document === 'undefined') return undefined;
    const handleVisibilityStateChange = () => {
      setPageVisible(document.visibilityState === 'visible');
    };
    document.addEventListener('visibilitychange', handleVisibilityStateChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityStateChange);
    };
  }, []);

  useEffect(() => {
    if (typeof silentRevalidateCurrentMailView !== 'function') return undefined;
    const handler = () => {
      if (document.visibilityState === 'visible') {
        void silentRevalidateCurrentMailView({ reason: 'mail-needs-refresh', force: true });
      }
    };
    const { schedule: scheduleVisibilityRefresh, cancel: cancelVisibilityRefresh } = createMailVisibilityRefreshScheduler(
      silentRevalidateCurrentMailView,
    );
    window.addEventListener('mail-needs-refresh', handler);
    window.addEventListener('focus', scheduleVisibilityRefresh);
    document.addEventListener('visibilitychange', scheduleVisibilityRefresh);
    const timer = pageVisible ? setInterval(() => {
      if (document.visibilityState !== 'visible') return;
      void silentRevalidateCurrentMailView({ reason: 'timer' });
    }, intervalMs) : null;
    return () => {
      window.removeEventListener('mail-needs-refresh', handler);
      window.removeEventListener('focus', scheduleVisibilityRefresh);
      document.removeEventListener('visibilitychange', scheduleVisibilityRefresh);
      cancelVisibilityRefresh();
      if (timer) clearInterval(timer);
    };
  }, [intervalMs, pageVisible, silentRevalidateCurrentMailView]);

  return { pageVisible };
}
