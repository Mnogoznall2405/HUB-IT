import { useCallback, useState } from 'react';

import { authAPI } from '../../api/client';

// AD -> OWNERS sync across all configured ITINVENT databases. Runs via
// POST /auth/sync-ad (permission database.ad_sync); the dialog reports
// per-database added/updated/errors counters.
export function useDatabaseAdSync({ notifyDatabaseError } = {}) {
  const [adSyncOpen, setAdSyncOpen] = useState(false);
  const [adSyncRunning, setAdSyncRunning] = useState(false);
  const [adSyncResult, setAdSyncResult] = useState(null);
  const [adSyncError, setAdSyncError] = useState('');

  const openAdSync = useCallback(() => {
    setAdSyncResult(null);
    setAdSyncError('');
    setAdSyncOpen(true);
  }, []);

  const closeAdSync = useCallback(() => {
    if (adSyncRunning) return;
    setAdSyncOpen(false);
  }, [adSyncRunning]);

  const confirmAdSync = useCallback(async () => {
    if (adSyncRunning) return;
    setAdSyncRunning(true);
    setAdSyncError('');
    setAdSyncResult(null);
    try {
      const result = await authAPI.syncAD();
      if (result?.status === 'error') {
        setAdSyncError(String(result?.message || 'Синхронизация завершилась с ошибкой.'));
      } else {
        setAdSyncResult(result || {});
      }
    } catch (error) {
      const detail = error?.response?.data?.detail;
      const message = String(detail || 'Не удалось выполнить синхронизацию сотрудников из AD.');
      setAdSyncError(message);
      notifyDatabaseError?.(message);
    } finally {
      setAdSyncRunning(false);
    }
  }, [adSyncRunning, notifyDatabaseError]);

  return {
    adSyncOpen,
    adSyncRunning,
    adSyncResult,
    adSyncError,
    openAdSync,
    closeAdSync,
    confirmAdSync,
  };
}

export default useDatabaseAdSync;
