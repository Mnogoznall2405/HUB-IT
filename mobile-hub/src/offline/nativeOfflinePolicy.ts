const SAFE_METHODS = new Set(['get', 'head', 'options']);

let readOnly = false;

export function setNativeOfflineReadOnly(value: boolean): void {
  readOnly = value === true;
}

export function isNativeOfflineReadOnly(): boolean {
  return readOnly;
}

export function isNativeOfflineMutationBlocked(method: unknown): boolean {
  return readOnly && !SAFE_METHODS.has(String(method || 'get').trim().toLowerCase());
}

export function createNativeOfflineReadOnlyError(): Error & { code: string } {
  return Object.assign(
    new Error('Автономный режим: изменения недоступны до восстановления сети.'),
    { code: 'HUBIT_OFFLINE_READ_ONLY' },
  );
}
