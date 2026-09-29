import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'hubit_mail_search_history_v1';
const MAX_ENTRIES = 8;
const MAX_QUERY_LENGTH = 200;

let operations: Promise<unknown> = Promise.resolve();

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = operations.then(operation);
  operations = result.then(() => undefined, () => undefined);
  return result;
}

type HistoryStore = Record<string, string[]>;

function scopedKey(userId: number, mailboxId: string): string {
  return `${Math.max(0, Math.trunc(Number(userId) || 0))}:${String(mailboxId || '').trim()}`;
}

async function readStore(): Promise<HistoryStore> {
  const raw = await SecureStore.getItemAsync(STORAGE_KEY);
  if (!raw) return {};
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return {}; }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const store: HistoryStore = {};
  for (const [key, entries] of Object.entries(value)) {
    if (!Array.isArray(entries)) continue;
    store[key] = entries
      .map((entry) => String(entry || '').trim())
      .filter((entry) => entry && entry.length <= MAX_QUERY_LENGTH)
      .slice(0, MAX_ENTRIES);
  }
  return store;
}

async function writeStore(store: HistoryStore): Promise<void> {
  const keys = Object.keys(store).filter((key) => store[key]?.length);
  if (!keys.length) {
    await SecureStore.deleteItemAsync(STORAGE_KEY);
    return;
  }
  const slim: HistoryStore = {};
  keys.slice(0, 24).forEach((key) => { slim[key] = store[key].slice(0, MAX_ENTRIES); });
  await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(slim));
}

/** Локальная история запросов mail-поиска: свежие первыми, без дублей, cap MAX_ENTRIES. */
export function readNativeMailSearchHistory(userId: number, mailboxId: string): Promise<string[]> {
  return enqueue(async () => {
    if (!Number(userId)) return [];
    const key = scopedKey(userId, mailboxId);
    const store = await readStore();
    return store[key] || [];
  });
}

export function pushNativeMailSearchQuery(userId: number, mailboxId: string, query: unknown): Promise<string[]> {
  return enqueue(async () => {
    const key = scopedKey(userId, mailboxId);
    const value = String(query || '').trim().replace(/\s+/g, ' ');
    if (!Number(userId) || !value || value.length > MAX_QUERY_LENGTH || value.length < 2) {
      const store = await readStore();
      return store[key] || [];
    }
    const store = await readStore();
    const lower = value.toLowerCase();
    const next = [value, ...(store[key] || []).filter((entry) => entry.toLowerCase() !== lower)].slice(0, MAX_ENTRIES);
    store[key] = next;
    await writeStore(store);
    return next;
  });
}

export function clearNativeMailSearchHistory(userId: number, mailboxId: string): Promise<void> {
  return enqueue(async () => {
    const key = scopedKey(userId, mailboxId);
    const store = await readStore();
    delete store[key];
    await writeStore(store);
  });
}
