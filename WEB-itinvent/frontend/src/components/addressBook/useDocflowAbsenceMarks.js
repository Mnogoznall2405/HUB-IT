import { useCallback, useEffect, useMemo, useState } from 'react';
import { docflowAPI } from '../../api/docflow';

const EMPTY = [];

export default function useDocflowAbsenceMarks({ userKey, enabled }) {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState(null);
  const refresh = useCallback(() => setAttempt((value) => value + 1), []);
  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    const controller = new AbortController();
    setState({ userKey, status: 'loading' });
    docflowAPI.listAbsences({ signal: controller.signal }).then((data) => {
      if (active) setState({ userKey, status: data?.status, items: data?.items, data });
    }).catch((error) => {
      if (active) setState({ userKey, status: error?.response?.data?.detail?.code === 'DOCFLOW_CREDENTIALS_REQUIRED' ? 'credentials' : 'error' });
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [userKey, enabled, attempt]);

  const current = enabled && state?.userKey === userKey ? state : null;
  const records = current?.status === 'available' && Array.isArray(current.items) ? current.items : EMPTY;
  const byEmployee = useMemo(() => {
    const index = new Map();
    for (const record of records) {
      if (record.matching_status !== 'matched' || !record.employee_code) continue;
      const code = String(record.employee_code).trim();
      const list = index.get(code) || [];
      list.push(record);
      index.set(code, list);
    }
    return index;
  }, [records]);
  const decorate = useCallback((item) => {
    if (!item) return item;
    const marks = byEmployee.get(String(item.employee_code || '').trim());
    if (marks?.length) return { ...item, docflow_absences: marks };
    // A mobile sheet keeps its original contact across searches; strip old
    // personal marks when the source/account changes or a refresh fails.
    if (item.docflow_absences) return { ...item, docflow_absences: EMPTY };
    return item;
  }, [byEmployee]);
  // The global absences payload also serves the per-employee panel (backend filters
  // employee_code over the same list) — sharing it avoids a second slow 1C read.
  const shared = useMemo(() => (
    enabled && current ? { status: current.status, data: current.data || null, refresh } : null
  ), [enabled, current, refresh]);
  return { decorate, refresh, status: current?.status, shared };
}
