import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createMailQuickReplyDraftSession, type MailQuickReplyScope } from './mailQuickReplyDrafts';

export function useMailQuickReplyDraft(scope: MailQuickReplyScope) {
  const { userId, mailboxId, kind, entityId } = scope;
  const session = useMemo(() => userId > 0 && mailboxId && entityId
    ? createMailQuickReplyDraftSession({ userId, mailboxId, kind, entityId }) : null,
  [userId, mailboxId, kind, entityId]);
  const [text, setLocalText] = useState('');
  const [storageError, setStorageError] = useState('');
  const [saved, setSaved] = useState(false);
  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);
  const [restoreVersion, setRestoreVersion] = useState(0);
  const [pendingKey, setPendingKey] = useState('');
  const pendingRef = useRef('');
  const pending = Boolean(pendingKey);
  const currentText = useRef('');
  const revision = useRef(0);
  const mounted = useRef(true);
  const owner = useRef(session);
  const [renderedSession, setRenderedSession] = useState(session);
  // Reset before committing the next scope, so another message never renders
  // the previous user's input, even while its own storage read is pending.
  if (renderedSession !== session) {
    owner.current = session;
    currentText.current = '';
    revision.current += 1;
    setRenderedSession(session);
    setLocalText('');
    setStorageError('');
    setSaved(false);
    readyRef.current = false;
    setReady(false);
    pendingRef.current = '';
    setPendingKey('');
  }
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);
  useEffect(() => {
    if (!session) return;
    let active = true;
    const initialRevision = revision.current;
    void Promise.all([session.read(), session.readPendingKey()]).then(([value, hasPending]) => {
      if (!active || owner.current !== session || revision.current !== initialRevision) return;
      currentText.current = value;
      setLocalText(value);
      setSaved(true);
      pendingRef.current = hasPending;
      setPendingKey(hasPending);
      readyRef.current = true;
      setReady(true);
      setStorageError('');
    }).catch(() => {
      if (active && owner.current === session && revision.current === initialRevision) setStorageError('Не удалось восстановить черновик быстрого ответа.');
    });
    return () => { active = false; };
  }, [session, restoreVersion]);
  const retryRestore = useCallback(() => {
    if (!mounted.current || owner.current !== session || readyRef.current) return;
    setStorageError('');
    setRestoreVersion((value) => value + 1);
  }, [session]);
  const setText = useCallback((value: string | ((previous: string) => string)) => {
    if (!mounted.current || !session || owner.current !== session || !readyRef.current || pendingRef.current) return;
    const next = typeof value === 'function' ? value(currentText.current) : value;
    currentText.current = next;
    const version = ++revision.current;
    setLocalText(next);
    setSaved(false);
    void session.write(next).then(() => {
      if (mounted.current && version === revision.current) { setStorageError(''); setSaved(true); }
    }).catch(() => {
      if (mounted.current && version === revision.current) setStorageError('Ответ не сохранён на устройстве. Не закрывайте приложение до отправки или сохранения в редакторе.');
    });
  }, [session]);
  const takeLocal = useCallback((expected: string) => {
    if (!mounted.current || owner.current !== session || !readyRef.current || pendingRef.current) return;
    if (currentText.current !== expected) return;
    revision.current += 1;
    currentText.current = '';
    setLocalText('');
  }, [session]);
  const acknowledgeTransfer = useCallback((expected: string) => session?.clearIfText(expected) ?? Promise.resolve(), [session]);
  const prepareSend = useCallback(async (payload: unknown, makeKey: () => string, expectedKey?: string) => {
    if (!session || owner.current !== session || !mounted.current || !readyRef.current) throw new Error('Экран ответа закрыт.');
    const attempt = await session.prepareSend(currentText.current, payload, makeKey, expectedKey);
    if (owner.current !== session || !mounted.current) throw new Error('Экран ответа закрыт.');
    pendingRef.current = attempt.key;
    setPendingKey(attempt.key);
    return attempt;
  }, [session]);
  const completeSend = useCallback(async (key: string) => {
    if (!session) return;
    await session.completeSend(key);
    if (owner.current !== session || !mounted.current) return;
    revision.current += 1;
    currentText.current = '';
    setLocalText('');
    pendingRef.current = '';
    setPendingKey('');
    setSaved(true);
  }, [session]);
  const resolvePending = useCallback(async (wasSent: boolean) => {
    if (!session || owner.current !== session || !mounted.current) return;
    await session.resolvePending(wasSent, pendingKey);
    if (owner.current !== session || !mounted.current) return;
    if (wasSent) { currentText.current = ''; setLocalText(''); }
    pendingRef.current = '';
    setPendingKey('');
    setStorageError('');
  }, [session, pendingKey]);
  const canTransfer = useCallback(() => Boolean(session && mounted.current && owner.current === session && readyRef.current && !pendingRef.current), [session]);
  return { ready, retryRestore, canTransfer, text, setText, storageError, saved, pending, prepareSend, completeSend, resolvePending, takeLocal, acknowledgeTransfer };
}
