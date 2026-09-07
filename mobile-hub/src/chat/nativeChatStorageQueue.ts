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
