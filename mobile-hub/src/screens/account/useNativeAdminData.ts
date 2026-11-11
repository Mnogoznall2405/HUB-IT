import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useAuth } from '../../auth/AuthContext';
import { canAccessAdminSection } from '../../account/accountNavigation';
import { formatApiError } from '../../api/formatError';

// Administrative data is kept only while the screen is active, never in offline snapshots.
export function useNativeAdminData<T>(section: string, fetchData: (signal: AbortSignal) => Promise<T>, enabled = true) {
  const access = useAuth();
  const allowed = canAccessAdminSection(section, access);
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [focused, setFocused] = useState(false);
  const generation = useRef(0);
  const mutation = useRef(false);
  const ready = allowed && Boolean(access.user?.id) && !access.offlineMode && active && focused && enabled;
  const latestAccess = useRef({ ready, userId: access.user?.id });
  latestAccess.current = { ready, userId: access.user?.id };
  useFocusEffect(useCallback(() => {
    setFocused(true);
    return () => {
      generation.current += 1;
      latestAccess.current.ready = false;
      setFocused(false); setData(null);
    };
  }, []));
  useEffect(() => {
    const subscription = AppState.addEventListener('change', state => {
      if (state !== 'active') latestAccess.current.ready = false;
      generation.current += 1;
      setActive(state === 'active'); setData(null);
    });
    return () => { latestAccess.current.ready = false; subscription.remove(); };
  }, []);
  useEffect(() => {
    const controller = new AbortController(), lease = ++generation.current;
    setData(null); setError(''); setBusy(ready);
    if (ready) void fetchData(controller.signal).then(next => {
      if (generation.current === lease) setData(next);
    }).catch(cause => {
      if (generation.current === lease) setError(formatApiError(cause, 'Не удалось загрузить настройки.'));
    }).finally(() => { if (generation.current === lease) setBusy(false); });
    return () => { generation.current += 1; controller.abort(); };
  }, [ready, access.user?.id, fetchData, revision]);
  const run = useCallback(async (operation: () => Promise<unknown>): Promise<boolean> => {
    if (!ready || !latestAccess.current.ready || latestAccess.current.userId !== access.user?.id || mutation.current) return false;
    const lease = generation.current;
    mutation.current = true; setBusy(true); setError('');
    try {
      await operation();
      if (generation.current !== lease) return false;
      setRevision(value => value + 1); return true;
    } catch (cause) {
      if (generation.current === lease) setError(formatApiError(cause, 'Не удалось сохранить изменения.'));
      return false;
    } finally { mutation.current = false; if (generation.current === lease) setBusy(false); }
  }, [ready, access.user?.id]);
  return { data, error, busy, allowed, ready, active, run, reload: () => setRevision(value => value + 1) };
}
