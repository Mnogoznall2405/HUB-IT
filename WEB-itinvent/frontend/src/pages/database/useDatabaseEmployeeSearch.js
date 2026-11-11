import { useCallback, useEffect, useRef, useState } from 'react';

import { equipmentSearchAPI } from '../../api/equipmentSearch';

const LIMIT = 50;
const emptyState = () => ({ key: '', employees: [], total: null, page: 0, loading: false, error: '' });

export function useDatabaseEmployeeSearch({ searchQuery, databaseId, enabled }) {
  const query = String(searchQuery || '').trim();
  const key = enabled && databaseId && query.length >= 2 ? JSON.stringify([databaseId, query]) : '';
  const [state, setState] = useState(emptyState);
  const requestRef = useRef({ id: 0, controller: null, busy: false });
  const timerRef = useRef(null);

  const cancel = useCallback(() => {
    clearTimeout(timerRef.current);
    timerRef.current = null;
    requestRef.current.controller?.abort();
    requestRef.current = { id: requestRef.current.id + 1, controller: null, busy: false };
  }, []);

  const fetchPage = useCallback(async (page) => {
    if (!key || requestRef.current.busy) return;
    const controller = new AbortController();
    const id = requestRef.current.id + 1;
    requestRef.current = { id, controller, busy: true };
    setState(prev => ({ ...(page === 1 ? emptyState() : prev), key, loading: true, error: '' }));
    try {
      const payload = await equipmentSearchAPI.searchByEmployee(query, page, LIMIT, {
        signal: controller.signal, databaseId,
      });
      if (controller.signal.aborted || id !== requestRef.current.id) return;
      if (!Array.isArray(payload?.employees) || !Number.isFinite(payload?.total) || payload.total < 0) {
        throw new Error('Invalid employee search response');
      }
      setState(prev => ({
        key, page, total: payload.total, loading: false, error: '',
        employees: page === 1 ? payload.employees : Array.from(new Map(
          [...prev.employees, ...payload.employees].map(employee => [employee.owner_no, employee]),
        ).values()),
      }));
    } catch (error) {
      if (controller.signal.aborted || id !== requestRef.current.id) return;
      const detail = error?.response?.data?.detail;
      setState(prev => ({ ...prev, key, loading: false, error: typeof detail === 'string'
        ? detail : 'Не удалось загрузить сотрудников. Повторите поиск.' }));
    } finally {
      if (id === requestRef.current.id) requestRef.current.busy = false;
    }
  }, [databaseId, key, query]);

  useEffect(() => {
    cancel();
    setState(emptyState());
    if (!key) return undefined;
    timerRef.current = setTimeout(() => { timerRef.current = null; void fetchPage(1); }, 500);
    return cancel;
  }, [cancel, fetchPage, key]);

  const runEmployeeSearchNow = useCallback(() => {
    cancel();
    void fetchPage(1);
  }, [cancel, fetchPage]);
  const visible = key && state.key === key ? state : emptyState();
  const loadMoreEmployees = useCallback(() => {
    if (visible.loading || visible.total == null || visible.employees.length >= visible.total) return;
    void fetchPage(visible.page + 1);
  }, [fetchPage, visible.employees.length, visible.loading, visible.page, visible.total]);

  return {
    employeeSearch: { ...visible, active: Boolean(key), loading: Boolean(key) && (visible.loading || state.key !== key),
      query, retry: runEmployeeSearchNow, loadMore: loadMoreEmployees },
    runEmployeeSearchNow,
  };
}
