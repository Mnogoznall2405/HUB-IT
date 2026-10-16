import { useCallback, useEffect, useRef, useState } from 'react';
import type { EquipmentPhotoFile, EquipmentRecord } from '../api/databaseApi';
import type { InventoryQrPayload } from './nativeDatabaseModel';
import { loadPendingPhotos, persistPendingPhoto, removePendingPhoto } from './pendingPhotoStore';

export type ScanPhotoTarget = {
  invNo: string;
  databaseId: string;
  itemId: number;
  title: string;
};

export type ScanPhotoJobStatus = 'queued' | 'uploading' | 'failed';

export type ScanPhotoJob = {
  id: number;
  invNo: string;
  itemId: number;
  databaseId: string;
  file: EquipmentPhotoFile;
  status: ScanPhotoJobStatus;
  error: string;
  /** Запись в дисковой очереди: снимок переживёт закрытие приложения. */
  pendingId?: string;
};

export type ScanPhotoSelectResult =
  | { kind: 'selected'; target: ScanPhotoTarget }
  | { kind: 'same'; target: ScanPhotoTarget }
  | { kind: 'consumable' }
  | { kind: 'invalid' }
  | { kind: 'offline' }
  | { kind: 'missing'; invNo: string }
  | { kind: 'error' }
  | { kind: 'cancelled' };

const normalizeInvNo = (value: string) => String(value || '').trim().toLocaleUpperCase('ru-RU');

// Быстрые фото по QR: сканируем технику, снимаем серию кадров, каждый кадр уходит
// на сервер фоном (по одному — FILE_NO на сервере берётся как MAX+1), сканируем
// следующую технику. Очередь переживает смену цели и закрытие сканера.
export function useNativeScanPhotoSession({
  databaseId,
  userId,
  offlineMode,
  resolveEquipment,
  uploadPhoto,
}: {
  databaseId: string;
  userId: number;
  offlineMode: boolean;
  resolveEquipment: (invNo: string, databaseId: string) => Promise<EquipmentRecord | null>;
  uploadPhoto: (itemId: number, file: EquipmentPhotoFile, databaseId?: string) => Promise<unknown>;
}) {
  const [active, setActive] = useState(false);
  const [target, setTarget] = useState<ScanPhotoTarget | null>(null);
  const [jobs, setJobs] = useState<ScanPhotoJob[]>([]);
  const [doneByInvNo, setDoneByInvNo] = useState<Record<string, number>>({});

  const jobsRef = useRef<ScanPhotoJob[]>([]);
  const targetRef = useRef<ScanPhotoTarget | null>(null);
  const pumpingRef = useRef(false);
  const idRef = useRef(0);
  const selectTokenRef = useRef(0);
  const mountedRef = useRef(true);
  const resolveRef = useRef(resolveEquipment);
  const uploadRef = useRef(uploadPhoto);
  const persistRef = useRef<Map<string, Promise<unknown>>>(new Map());

  useEffect(() => { resolveRef.current = resolveEquipment; }, [resolveEquipment]);
  useEffect(() => { uploadRef.current = uploadPhoto; }, [uploadPhoto]);
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const commitJobs = useCallback((next: ScanPhotoJob[]) => {
    jobsRef.current = next;
    if (mountedRef.current) setJobs(next);
  }, []);

  // Снимок дошёл до сервера (или отброшен): копию на диске можно удалить.
  const forgetPending = useCallback((pendingId?: string) => {
    if (!pendingId) return;
    const writing = persistRef.current.get(pendingId) || Promise.resolve();
    persistRef.current.delete(pendingId);
    void writing.then(() => removePendingPhoto(pendingId));
  }, []);

  const pump = useCallback(async () => {
    if (pumpingRef.current) return;
    pumpingRef.current = true;
    try {
      for (;;) {
        const job = jobsRef.current.find((entry) => entry.status === 'queued');
        if (!job) return;
        commitJobs(jobsRef.current.map((entry) => (entry.id === job.id ? { ...entry, status: 'uploading' } : entry)));
        try {
          await uploadRef.current(job.itemId, job.file, job.databaseId || undefined);
          commitJobs(jobsRef.current.filter((entry) => entry.id !== job.id));
          forgetPending(job.pendingId);
          if (mountedRef.current) {
            const key = normalizeInvNo(job.invNo);
            setDoneByInvNo((current) => ({ ...current, [key]: (current[key] || 0) + 1 }));
          }
        } catch (cause) {
          const message = cause instanceof Error && cause.message ? cause.message : 'Не удалось загрузить фото';
          commitJobs(jobsRef.current.map((entry) => (
            entry.id === job.id ? { ...entry, status: 'failed', error: message } : entry
          )));
        }
      }
    } finally {
      pumpingRef.current = false;
    }
  }, [commitJobs, forgetPending]);

  const start = useCallback(() => { setActive(true); }, []);

  // Выход из режима: цель сбрасывается, фото в очереди дозагружаются.
  const stop = useCallback(() => {
    selectTokenRef.current += 1;
    targetRef.current = null;
    setActive(false);
    setTarget(null);
    setDoneByInvNo({});
  }, []);

  const selectTarget = useCallback(async (payload: InventoryQrPayload): Promise<ScanPhotoSelectResult> => {
    if (payload.kind === 'consumable') return { kind: 'consumable' };
    const invNo = payload.inventoryNumber.trim();
    if (!invNo) return { kind: 'invalid' };
    if (offlineMode) return { kind: 'offline' };
    const targetDatabaseId = String(payload.databaseId || databaseId || '').trim();
    const current = targetRef.current;
    if (current && normalizeInvNo(current.invNo) === normalizeInvNo(invNo) && current.databaseId === targetDatabaseId) {
      return { kind: 'same', target: current };
    }
    const token = ++selectTokenRef.current;
    let equipment: EquipmentRecord | null;
    try {
      equipment = await resolveRef.current(invNo, targetDatabaseId);
    } catch {
      return { kind: token === selectTokenRef.current ? 'error' : 'cancelled' };
    }
    // Пока шёл запрос, отсканировали другую технику или вышли из режима.
    if (token !== selectTokenRef.current || !mountedRef.current) return { kind: 'cancelled' };
    const itemId = Number(equipment?.id);
    if (!equipment || !Number.isFinite(itemId) || itemId <= 0) return { kind: 'missing', invNo };
    const next: ScanPhotoTarget = {
      invNo: equipment.inv_no || invNo,
      databaseId: targetDatabaseId,
      itemId,
      title: [equipment.type_name, equipment.model_name].filter(Boolean).join(' · ') || equipment.inv_no || invNo,
    };
    targetRef.current = next;
    setTarget(next);
    return { kind: 'selected', target: next };
  }, [databaseId, offlineMode]);

  // forTarget — цель на момент нажатия затвора: пока кадр сохранялся, могли
  // отсканировать другую технику. false — снимать некуда (цель не выбрана).
  const enqueue = useCallback((file: EquipmentPhotoFile, forTarget?: ScanPhotoTarget | null): boolean => {
    const current = forTarget || targetRef.current;
    if (!current) return false;
    idRef.current += 1;
    const pendingId = `ph-${Date.now().toString(36)}-${idRef.current}-${Math.random().toString(36).slice(2, 8)}`;
    persistRef.current.set(pendingId, persistPendingPhoto({
      id: pendingId,
      userId,
      itemId: current.itemId,
      databaseId: current.databaseId,
      invNo: current.invNo,
      file,
    }));
    commitJobs([
      ...jobsRef.current,
      {
        id: idRef.current,
        invNo: current.invNo,
        itemId: current.itemId,
        databaseId: current.databaseId,
        // Ключ тот же, что у копии на диске: после перезапуска повтор не создаст второе фото.
        file: { ...file, uploadKey: pendingId },
        status: 'queued',
        error: '',
        pendingId,
      },
    ]);
    void pump();
    return true;
  }, [commitJobs, pump, userId]);

  // После перезапуска приложения догружаем снимки, которые не успели уйти.
  useEffect(() => {
    let cancelled = false;
    if (!(userId > 0)) return undefined;
    void loadPendingPhotos(userId).then((entries) => {
      if (cancelled || !mountedRef.current || !entries.length) return;
      const known = new Set(jobsRef.current.map((job) => job.pendingId));
      const restored = entries.filter((entry) => !known.has(entry.id)).map((entry): ScanPhotoJob => {
        idRef.current += 1;
        return {
          id: idRef.current,
          invNo: entry.invNo,
          itemId: entry.itemId,
          databaseId: entry.databaseId,
          file: { ...entry.file, uploadKey: entry.id },
          status: 'queued',
          error: '',
          pendingId: entry.id,
        };
      });
      if (!restored.length) return;
      commitJobs([...jobsRef.current, ...restored]);
      void pump();
    });
    return () => { cancelled = true; };
  }, [commitJobs, pump, userId]);

  const retryFailed = useCallback(() => {
    if (!jobsRef.current.some((entry) => entry.status === 'failed')) return;
    commitJobs(jobsRef.current.map((entry) => (
      entry.status === 'failed' ? { ...entry, status: 'queued', error: '' } : entry
    )));
    void pump();
  }, [commitJobs, pump]);

  const discardFailed = useCallback(() => {
    jobsRef.current.filter((entry) => entry.status === 'failed').forEach((entry) => forgetPending(entry.pendingId));
    commitJobs(jobsRef.current.filter((entry) => entry.status !== 'failed'));
  }, [commitJobs, forgetPending]);

  const targetKey = target ? normalizeInvNo(target.invNo) : '';
  const forTarget = jobs.filter((job) => normalizeInvNo(job.invNo) === targetKey);

  return {
    active,
    target,
    start,
    stop,
    selectTarget,
    enqueue,
    retryFailed,
    discardFailed,
    // По выбранной технике — для панели.
    uploadedCount: targetKey ? (doneByInvNo[targetKey] || 0) : 0,
    pendingCount: forTarget.filter((job) => job.status !== 'failed').length,
    failedCount: forTarget.filter((job) => job.status === 'failed').length,
    // По всей очереди — чтобы не потерять фото при закрытии сканера.
    totalPending: jobs.filter((job) => job.status !== 'failed').length,
    totalFailed: jobs.filter((job) => job.status === 'failed').length,
    totalUploaded: Object.values(doneByInvNo).reduce((sum, value) => sum + value, 0),
  };
}
