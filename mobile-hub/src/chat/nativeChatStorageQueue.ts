export const CHAT_DRAFT_STORAGE_KEY = 'hubit_native_chat_drafts_v1';
export const CHAT_OUTBOX_STORAGE_KEY = 'hubit_native_chat_outbox_v1';
let operations: Promise<void> = Promise.resolve();

/** Draft/outbox commits and their file-reference checks share one ordering. */
export function enqueueNativeChatStorage<T>(operation: () => Promise<T>): Promise<T> {
  const result = operations.then(operation);
  operations = result.then(() => undefined, () => undefined);
  return result;
}

export function waitForNativeChatStorage() { return operations; }

// In-process snapshot of the serialized outbox. Every write path goes through
// the single storage queue above, so the cache is always coherent with the
// durable blob: reads after the first load cost zero SecureStore round-trips.
let outboxRowsCache: unknown[] | null = null;
export function getNativeChatOutboxRowsCache() { return outboxRowsCache; }
export function setNativeChatOutboxRowsCache(rows: unknown[] | null) { outboxRowsCache = rows; }
/** Test/debug hook: drop the snapshot when storage was written behind the queue. */
export function resetNativeChatOutboxRowsCache() { outboxRowsCache = null; }
