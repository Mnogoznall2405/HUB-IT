import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { createNativeFormDraftSession } from './nativeFormDrafts';

export function useNativeFormDraft<T extends object>(options: {
  userId: number; scope: string; state: T; restore: (state: T) => void; ready: boolean; paused?: boolean;
}) {
  const { userId, scope, ready, paused } = options;
  const callbacks = useRef(options); callbacks.current = options;
  const initialState = useRef(JSON.parse(JSON.stringify(options.state)) as T);
  const previousOwner = useRef(userId);
  const session = useRef<ReturnType<typeof createNativeFormDraftSession<T>> | null>(null);
  const ownerKey = `${userId}:${scope}`;
  const sessionOwner = useRef('');
  const ownerStates = useRef(new Map<string, { state: T; paused?: boolean }>());
  ownerStates.current.set(ownerKey, { state: options.state, paused });
  const [restored, setRestored] = useState(false);
  const [status, setStatus] = useState('');
  const finished = useRef(false);
  const fingerprint = JSON.stringify(options.state);
  useEffect(() => {
    if (!ready || !userId) return;
    let active = true;
    let loaded = false;
    finished.current = false; setRestored(false);
    const current = createNativeFormDraftSession<T>(userId, scope); session.current = current; sessionOwner.current = ownerKey;
    void current.read().then((saved) => {
      if (!active) return;
      if (saved) callbacks.current.restore(saved);
      else if (previousOwner.current !== userId) callbacks.current.restore(initialState.current);
      previousOwner.current = userId;
      loaded = true;
      setStatus(saved ? 'Открыт локальный черновик' : '');
      setRestored(true);
    }).catch(() => { if (active) setStatus('Не удалось открыть черновик. Не закрывайте форму.'); });
    return () => {
      active = false;
      const lastOwned = ownerStates.current.get(ownerKey);
      if (loaded && lastOwned && !lastOwned.paused && !finished.current) void current.write(lastOwned.state).catch(() => undefined);
      session.current = null;
    };
  }, [userId, scope, ready]);
  const write = async (state: T = callbacks.current.state) => {
    const current = session.current;
    if (!current || sessionOwner.current !== ownerKey || !restored || finished.current) throw new Error('Локальный черновик ещё не готов.');
    const saved = await current.write(state);
    if (session.current === current && !finished.current) setStatus('Сохранено на устройстве');
    return saved;
  };
  const saveRef = useRef(write); saveRef.current = write;
  useEffect(() => {
    if (!restored || paused || finished.current) return;
    let active = true;
    const state = callbacks.current.state;
    const save = saveRef.current;
    setStatus('Сохраняем на устройстве…');
    const timer = setTimeout(() => {
      void save(state).then((saved) => {
        if (active && JSON.stringify(callbacks.current.state) === JSON.stringify(state) && JSON.stringify(saved) !== JSON.stringify(state)) callbacks.current.restore(saved);
      }).catch(() => { if (active) setStatus('Не удалось сохранить на устройстве. Не закрывайте форму.'); });
    }, 350);
    return () => { active = false; clearTimeout(timer); };
  }, [fingerprint, restored, paused, userId, scope]);
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && !callbacks.current.paused && !finished.current) void saveRef.current().catch(() => undefined);
    });
    return () => { subscription.remove(); };
  }, []);
  return { restored, status, write, clear: async () => {
    finished.current = true;
    try { await session.current?.clear(); } catch (error) { finished.current = false; throw error; }
  } };
}
