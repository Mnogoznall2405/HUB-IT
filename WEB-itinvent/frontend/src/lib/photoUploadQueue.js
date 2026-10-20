import { equipmentPhotosAPI } from '../api/equipmentPhotos';
import { isPermanentFailure, shrinkPhoto } from './resumablePhotoUpload';

// Фоновая очередь загрузки фото оборудования. Снимок сразу попадает в очередь (и в IndexedDB),
// человек идёт к следующей технике, а отправка идёт докачкой по одному файлу. Очередь
// переживает закрытие вкладки: после открытия страницы неотправленное уходит само, а при
// возврате связи («online») и при возврате на вкладку повтор не ждёт паузы.

const DB_NAME = 'hubit-photo-upload-queue';
const DB_VERSION = 1;
const STORE = 'jobs';

// Пауза перед автоповтором после обрыва (сам поток уже ждал по 1–30 с между попытками).
export const AUTO_RETRY_MS = 30_000;

export const STATUS = {
  QUEUED: 'queued',
  UPLOADING: 'uploading',
  WAITING: 'waiting',
  FAILED: 'failed',
};

// --- хранилище: IndexedDB, а без него (приватный режим, тесты) — память вкладки ---

export function createMemoryStore() {
  const rows = new Map();
  return {
    async put(job) { rows.set(job.id, job); },
    async remove(id) { rows.delete(id); },
    async getAll() { return [...rows.values()]; },
  };
}

export function createIndexedDbStore() {
  let opening = null;
  const open = () => {
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
    });
    // A failed open (blocked, quota, private mode) must not be cached forever: allow a retry.
    opening.catch(() => { opening = null; });
    return opening;
  };
  const run = async (mode, operation) => {
    const database = await open();
    return new Promise((resolve, reject) => {
      const transaction = database.transaction(STORE, mode);
      const request = operation(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request?.result);
      transaction.onerror = () => reject(transaction.error || new Error('IndexedDB failed'));
      transaction.onabort = () => reject(transaction.error || new Error('IndexedDB aborted'));
    });
  };
  return {
    put: (job) => run('readwrite', (store) => store.put(job)),
    remove: (id) => run('readwrite', (store) => store.delete(id)),
    getAll: async () => (await run('readonly', (store) => store.getAll())) || [],
  };
}

// Если IndexedDB не отвечает, очередь работает в памяти вкладки — загрузка не должна ломаться.
function createDefaultStore() {
  if (typeof indexedDB === 'undefined') return createMemoryStore();
  const persistent = createIndexedDbStore();
  const memory = createMemoryStore();
  let broken = false;
  const guard = (name) => async (...args) => {
    if (!broken) {
      try { return await persistent[name](...args); } catch { broken = true; }
    }
    return memory[name](...args);
  };
  return { put: guard('put'), remove: guard('remove'), getAll: guard('getAll') };
}

const newId = () => (
  typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : `q-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
);

// Что показываем человеку: без самого файла.
const publicJob = (job) => ({
  id: job.id,
  itemId: job.itemId,
  dbId: job.dbId,
  userId: job.userId,
  fileName: job.fileName,
  size: job.blob?.size || 0,
  createdAt: job.createdAt,
  status: job.status,
  progress: job.progress || 0,
  error: job.error || '',
  attempts: job.attempts || 0,
  blob: job.blob,
});

export function createPhotoUploadQueue({
  store = createDefaultStore(),
  upload = (...args) => equipmentPhotosAPI.upload(...args),
  shrink = shrinkPhoto,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
  onlineNow = () => (typeof navigator === 'undefined' || navigator.onLine !== false),
} = {}) {
  const jobs = new Map();
  const listeners = new Set();
  const uploadedListeners = new Set();
  let userId = 0;
  let running = false;
  let retryTimer = null;
  let restored = null;
  let snapshot = [];
  const mine = (job) => !userId || job.userId === userId;

  const rebuild = () => {
    snapshot = [...jobs.values()]
      .filter(mine)
      .sort((a, b) => a.createdAt - b.createdAt)
      .map(publicJob);
  };
  const emit = () => {
    rebuild();
    listeners.forEach((listener) => { try { listener(snapshot); } catch { /* слушатель не должен ломать очередь */ } });
  };
  const persist = (job) => store.put({ ...job, progress: 0 }).catch(() => {});

  const readError = (error) => {
    const detail = error?.response?.data?.detail;
    if (typeof detail === 'string' && detail) return detail;
    return error?.message || 'Не удалось загрузить фото.';
  };

  async function runNext() {
    if (running) return;
    const job = [...jobs.values()]
      .sort((a, b) => a.createdAt - b.createdAt)
      .find((candidate) => candidate.status === STATUS.QUEUED && mine(candidate));
    if (!job) return;
    running = true;
    job.status = STATUS.UPLOADING;
    job.progress = 0;
    job.error = '';
    emit();
    try {
      const result = await upload(
        job.itemId,
        job.blob,
        {
          params: job.dbId ? { db_id: job.dbId } : {},
          // Снимок уже уменьшен при постановке в очередь — второй раз не пережимаем.
          onProgress: (done, total) => {
            job.progress = total ? Math.min(1, done / total) : 0;
            emit();
          },
          shrink: async (file) => file,
        },
      );
      jobs.delete(job.id);
      await store.remove(job.id).catch(() => {});
      emit();
      uploadedListeners.forEach((listener) => {
        try { listener({ job: publicJob(job), result }); } catch { /* см. выше */ }
      });
    } catch (error) {
      job.error = readError(error);
      job.attempts = (job.attempts || 0) + 1;
      // Отказ сервера повтором не лечится; обрыв связи — лечится сам.
      job.status = isPermanentFailure(error) ? STATUS.FAILED : STATUS.WAITING;
      job.progress = 0;
      await persist(job);
      emit();
      if (job.status === STATUS.WAITING) scheduleRetry();
    } finally {
      running = false;
    }
    void runNext();
  }

  function scheduleRetry() {
    if (retryTimer) return;
    retryTimer = setTimer(() => {
      retryTimer = null;
      resumeWaiting();
    }, AUTO_RETRY_MS);
  }

  function resumeWaiting() {
    let changed = false;
    jobs.forEach((job) => {
      if (job.status === STATUS.WAITING && mine(job)) { job.status = STATUS.QUEUED; changed = true; }
    });
    if (changed) emit();
    void runNext();
  }

  async function restore() {
    if (!restored) {
      restored = (async () => {
        let rows = [];
        try { rows = await store.getAll(); } catch { rows = []; }
        rows.forEach((row) => {
          if (!row?.id || !row.blob || jobs.has(row.id)) return;
          // Закрытая вкладка оставила «загрузку» без исхода: сервер помнит принятые куски.
          const status = row.status === STATUS.FAILED ? STATUS.FAILED : STATUS.QUEUED;
          jobs.set(row.id, { ...row, status, progress: 0 });
        });
        emit();
      })();
    }
    await restored;
    void runNext();
  }

  return {
    // Постановка в очередь: уменьшаем снимок один раз и сохраняем на диск.
    async enqueue({ itemId, dbId = '', userId: owner, files }) {
      const created = [];
      for (const file of files) {
        const shrunk = await shrink(file);
        const stamp = now();
        const fileName = file.name || `photo-${stamp}.jpg`;
        // Серверу и идентификатору загрузки нужны имя и дата файла.
        const blob = shrunk?.name ? shrunk : new File([shrunk], fileName, { type: shrunk.type, lastModified: stamp });
        const job = {
          id: newId(),
          itemId,
          dbId: dbId || '',
          userId: owner || userId,
          fileName,
          blob,
          createdAt: stamp,
          status: STATUS.QUEUED,
          progress: 0,
          error: '',
          attempts: 0,
        };
        jobs.set(job.id, job);
        await persist(job);
        created.push(job.id);
      }
      emit();
      void runNext();
      return created;
    },

    setUser(id) {
      const next = Number(id) || 0;
      if (next === userId) return;
      userId = next;
      emit();
      void restore();
    },

    restore,

    // Связь вернулась: повторяем сразу, не дожидаясь паузы.
    resume() {
      if (retryTimer) { clearTimer(retryTimer); retryTimer = null; }
      if (onlineNow()) resumeWaiting();
    },

    retry(id) {
      const job = jobs.get(id);
      if (!job || job.status === STATUS.UPLOADING) return;
      job.status = STATUS.QUEUED;
      job.error = '';
      emit();
      void runNext();
    },

    retryAll(filter = () => true) {
      jobs.forEach((job) => {
        if ((job.status === STATUS.FAILED || job.status === STATUS.WAITING) && mine(job) && filter(job)) {
          job.status = STATUS.QUEUED;
          job.error = '';
        }
      });
      emit();
      void runNext();
    },

    async remove(id) {
      const job = jobs.get(id);
      if (!job || job.status === STATUS.UPLOADING) return;
      jobs.delete(id);
      await store.remove(id).catch(() => {});
      emit();
    },

    getJobs: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    onUploaded(listener) {
      uploadedListeners.add(listener);
      return () => uploadedListeners.delete(listener);
    },
  };
}

// Общая очередь вкладки.
let sharedQueue = null;
export function resetPhotoUploadQueue() { sharedQueue = null; }
export function getPhotoUploadQueue() {
  if (!sharedQueue) {
    sharedQueue = createPhotoUploadQueue();
    if (typeof window !== 'undefined') {
      window.addEventListener('online', () => sharedQueue.resume());
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') sharedQueue.resume();
      });
    }
  }
  return sharedQueue;
}
