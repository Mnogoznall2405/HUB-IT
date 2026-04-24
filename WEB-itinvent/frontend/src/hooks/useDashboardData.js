import { useCallback, useState } from 'react';
import { hubAPI } from '../api/client';

const DASHBOARD_ANNOUNCEMENTS_LIMIT = 120;
const DASHBOARD_TASKS_LIMIT = 80;

export function useDashboardData() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [dashboardPayload, setDashboardPayload] = useState({
    announcements: { items: [], total: 0, unread_total: 0, ack_pending_total: 0 },
    my_tasks: { items: [], total: 0 },
    unread_counts: {},
    summary: {},
  });

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const payload = await hubAPI.getDashboard({
        announcements_limit: DASHBOARD_ANNOUNCEMENTS_LIMIT,
        tasks_limit: DASHBOARD_TASKS_LIMIT,
      });
      setDashboardPayload(payload || {
        announcements: { items: [], total: 0, unread_total: 0, ack_pending_total: 0 },
        my_tasks: { items: [], total: 0 },
        unread_counts: {},
        summary: {},
      });
    } catch (err) {
      setError(err?.response?.data?.detail || err?.message || 'Ошибка загрузки центра управления');
      throw err;
    } finally {
      setLoading(false);
    }
  }, []);

  const patchAnnouncementItem = useCallback((announcementId, patch) => {
    const targetId = String(announcementId || '').trim();
    if (!targetId) return;
    setDashboardPayload((prev) => ({
      ...(prev || {}),
      announcements: {
        ...(prev?.announcements || {}),
        items: Array.isArray(prev?.announcements?.items)
          ? prev.announcements.items.map((item) => (
            String(item?.id || '') === targetId ? { ...item, ...(patch || {}) } : item
          ))
          : [],
      },
    }));
  }, []);

  const patchTaskItem = useCallback((taskId, patch) => {
    const targetId = String(taskId || '').trim();
    if (!targetId) return;
    setDashboardPayload((prev) => ({
      ...(prev || {}),
      my_tasks: {
        ...(prev?.my_tasks || {}),
        items: Array.isArray(prev?.my_tasks?.items)
          ? prev.my_tasks.items.map((item) => (
            String(item?.id || '') === targetId ? { ...item, ...(patch || {}) } : item
          ))
          : [],
      },
    }));
  }, []);

  return {
    loading,
    error,
    dashboardPayload,
    loadDashboard,
    patchAnnouncementItem,
    patchTaskItem,
    setError,
  };
}
