import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { getPhotoUploadQueue, readStoredUserId, STATUS } from '../../lib/photoUploadQueue';

// Очередь загрузки фото для карточки оборудования: задания этой позиции и этой базы,
// действия над ними и сигнал «фото доехало» (чтобы перечитать список).
export function usePhotoUploadQueue({ itemId, dbId, onUploaded }) {
  const userId = readStoredUserId();
  const queue = getPhotoUploadQueue();
  const [allJobs, setAllJobs] = useState(() => queue.getJobs());
  const onUploadedRef = useRef(onUploaded);
  onUploadedRef.current = onUploaded;

  useEffect(() => {
    const unsubscribe = queue.subscribe(setAllJobs);
    queue.setUser(userId);
    void queue.restore();
    return unsubscribe;
  }, [queue, userId]);

  useEffect(() => queue.onUploaded(({ job }) => {
    if (String(job.itemId) === String(itemId) && (job.dbId || '') === (dbId || '')) {
      onUploadedRef.current?.(job);
    }
  }), [queue, itemId, dbId]);

  const jobs = useMemo(
    () => allJobs.filter((job) => String(job.itemId) === String(itemId) && (job.dbId || '') === (dbId || '')),
    [allJobs, itemId, dbId],
  );

  const enqueue = useCallback(
    (files) => queue.enqueue({ itemId, dbId, userId, files }),
    [queue, itemId, dbId, userId],
  );
  const retryAll = useCallback(
    () => queue.retryAll((job) => String(job.itemId) === String(itemId) && (job.dbId || '') === (dbId || '')),
    [queue, itemId, dbId],
  );

  // Снимки лежат только в памяти вкладки (IndexedDB недоступна): закрытие вкладки их потеряет.
  const unsaved = jobs.filter((job) => job.durable === false).length;
  const stuck = jobs.filter((job) => job.status === STATUS.FAILED || job.status === STATUS.WAITING).length;
  // Сколько ещё уходит по другим позициям: человек уже перешёл дальше, но фото ещё едут.
  const elsewhere = allJobs.length - jobs.length;

  return {
    jobs,
    stuck,
    unsaved,
    elsewhere,
    enqueue,
    retryAll,
    retry: queue.retry,
    remove: queue.remove,
  };
}
