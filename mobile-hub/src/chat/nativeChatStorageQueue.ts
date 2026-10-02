export const CHAT_DRAFT_STORAGE_KEY = 'hubit_native_chat_drafts_v1';
export const CHAT_OUTBOX_STORAGE_KEY = 'hubit_native_chat_outbox_v1';

type QueuedOperation = {
  lane: 'default' | 'draft';
  coalesceKey?: string;
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
};

// Pending operations in enqueue order. Operations still run strictly one at a
// time; the 'draft' lane only lets later outbox commits and file-reference
// checks overtake draft writes that have not started yet.
const pending: QueuedOperation[] = [];
let drain: Promise<void> | null = null;

export type NativeChatStorageEnqueueOptions = {
  lane?: 'draft';
  // A newer queued write of the same draft replaces still-pending ones.
  coalesceKey?: string;
};

function takeNext(): QueuedOperation {
  const priority = pending.findIndex((queued) => queued.lane !== 'draft');
  return pending.splice(priority < 0 ? 0 : priority, 1)[0];
}

async function drainQueue() {
  while (pending.length) {
    const queued = takeNext();
    try {
      queued.resolve(await queued.run());
    } catch (error) {
      queued.reject(error);
    }
  }
}

function kick() {
  if (drain) return;
  drain = drainQueue().catch(() => undefined).finally(() => {
    drain = null;
    // An operation enqueued while this drain was settling has no runner yet.
    if (pending.length) kick();
  });
}

/** Draft/outbox commits and their file-reference checks share one ordering. */
export function enqueueNativeChatStorage<T>(
  operation: () => Promise<T>,
  options?: NativeChatStorageEnqueueOptions,
): Promise<T> {
  if (options?.coalesceKey !== undefined) {
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const queued = pending[index];
      if (queued.coalesceKey === options.coalesceKey) {
        pending.splice(index, 1);
        queued.resolve(undefined);
      }
    }
  }
  const result = new Promise<T>((resolve, reject) => {
    pending.push({
      lane: options?.lane === 'draft' ? 'draft' : 'default',
      coalesceKey: options?.coalesceKey,
      run: operation as () => Promise<unknown>,
      resolve: resolve as (value: unknown) => void,
      reject,
    });
  });
  kick();
  return result;
}

export function waitForNativeChatStorage() { return drain ?? Promise.resolve(); }

// In-process snapshot of the serialized outbox. Every write path goes through
// the single storage queue above, so the cache is always coherent with the
// durable blob: reads after the first load cost zero SecureStore round-trips.
let outboxRowsCache: unknown[] | null = null;
export function getNativeChatOutboxRowsCache() { return outboxRowsCache; }
export function setNativeChatOutboxRowsCache(rows: unknown[] | null) { outboxRowsCache = rows; }
/** Test/debug hook: drop the snapshot when storage was written behind the queue. */
export function resetNativeChatOutboxRowsCache() { outboxRowsCache = null; }
