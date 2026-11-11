import { Directory, File, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import { readEncryptedNativeSnapshot, writeEncryptedNativeSnapshot, deleteEncryptedNativeSnapshot } from '../cache/nativeSnapshotStorage';

type Entry<T> = { version: 1; revision: number; state: T };
let generation = 0;
let operations: Promise<unknown> = Promise.resolve();
const owners = new Set<number>();
const scopes = new Map<number, Set<string>>();
const root = () => new Directory(Paths.document, 'hubit-form-draft-files');
function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = operations.then(operation);
  operations = result.then(() => undefined, () => undefined);
  return result;
}

/** Copy only upload descriptors; remap feed order/cover keys in the same commit. */
function durableState<T>(userId: number, scope: string, state: T): T {
  const directory = new Directory(root(), String(userId), scope);
  const replacements = new Map<string, string>();
  const copy = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(copy);
    if (!value || typeof value !== 'object') return value;
    const item = value as Record<string, unknown>;
    if (typeof item.uri === 'string' && typeof item.name === 'string' && typeof item.size === 'number') {
      const file = new File(item.uri);
      if (!file.exists || (item.size > 0 && file.size !== item.size)) throw new Error('Вложение недоступно или изменилось. Черновик не обновлён.');
      const prefix = `${directory.uri.replace(/\/$/, '')}/`;
      if (item.uri.startsWith(prefix)) return { ...item, size: file.size };
      const previous = replacements.get(item.uri);
      if (previous) return { ...item, uri: previous, size: file.size };
      directory.create({ intermediates: true, idempotent: true });
      const target = new File(directory, randomUUID?.() || `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`);
      file.copy(target);
      if (!target.exists || target.size !== file.size) throw new Error('Не удалось сохранить вложение на устройстве.');
      replacements.set(item.uri, target.uri);
      return { ...item, uri: target.uri, size: target.size };
    }
    return Object.fromEntries(Object.entries(item).map(([key, child]) => [key, copy(child)]));
  };
  const copied = copy(state);
  const remap = (value: unknown): unknown => {
    if (typeof value === 'string') {
      if (replacements.has(value)) return replacements.get(value);
      if (value.startsWith('new:') && replacements.has(value.slice(4))) return `new:${replacements.get(value.slice(4))}`;
      return value;
    }
    if (Array.isArray(value)) return value.map(remap);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, remap(child)]));
    return value;
  };
  return remap(copied) as T;
}

export function createNativeFormDraftSession<T extends object>(userId: number, scope: string) {
  if (!Number.isInteger(userId) || userId <= 0 || !/^[a-zA-Z0-9_-]{1,120}$/.test(scope)) throw new Error('Не определён владелец черновика.');
  const storageScope = `form-draft-${scope}`;
  owners.add(userId);
  const registered = scopes.get(userId) || new Set<string>(); registered.add(storageScope); scopes.set(userId, registered);
  const lease = generation;
  let closed = false;
  let observedRevision: number | undefined;
  const check = () => { if (closed || lease !== generation) throw new Error('Сессия черновика завершена.'); };
  const readEntry = async (): Promise<Entry<T> | null> => {
    const raw = await readEncryptedNativeSnapshot(storageScope, userId);
    if (!raw) return null;
    const entry = JSON.parse(raw) as Entry<T>;
    if (entry.version !== 1 || !Number.isSafeInteger(entry.revision) || !entry.state || typeof entry.state !== 'object' || Array.isArray(entry.state)) throw new Error('Не удалось прочитать локальный черновик.');
    return entry;
  };
  return {
    read: () => enqueue(async () => { check(); const entry = await readEntry(); check(); observedRevision = entry?.revision; return entry?.state ?? null; }),
    write: (state: T) => {
      const snapshot = JSON.parse(JSON.stringify(state)) as T;
      return enqueue(async () => {
        check(); const current = await readEntry(); check();
        if (current && current.revision !== observedRevision) throw new Error('Черновик изменён в другом окне. Откройте его заново.');
        const durable = durableState(userId, scope, snapshot);
        const revision = (current?.revision || 0) + 1;
        check();
        if (!await writeEncryptedNativeSnapshot(storageScope, userId, JSON.stringify({ version: 1, revision, state: durable }))) throw new Error('Не удалось сохранить черновик на устройстве.');
        check(); observedRevision = revision;
        return durable;
      });
    },
    clear: () => enqueue(async () => {
      check(); const current = await readEntry(); check();
      if (current && current.revision !== observedRevision) throw new Error('Черновик уже обновлён.');
      await deleteEncryptedNativeSnapshot(storageScope, userId);
      closed = true;
      const directory = new Directory(root(), String(userId), scope);
      // The committed draft is gone; a temporary file cleanup failure must not
      // make a successful server operation look like a failed submission.
      try { if (directory.exists) directory.delete(); } catch { /* Logout retries file cleanup. */ }
    }),
  };
}

/** Call on logout before any queued draft write can recreate files. */
export function clearNativeFormDrafts(): Promise<void> {
  generation += 1;
  return enqueue(async () => {
    for (const userId of owners) for (const scope of scopes.get(userId) || []) await deleteEncryptedNativeSnapshot(scope, userId);
    const directory = root(); if (directory.exists) directory.delete();
    owners.clear(); scopes.clear();
  });
}
