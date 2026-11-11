import * as SecureStore from 'expo-secure-store';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

const STORAGE_KEY = 'hubit_mail_quick_reply_drafts_v1';
const MAX_STORED_CHARACTERS = 262_144;
let operations: Promise<void> = Promise.resolve();
let generation = 0;
type Attempt = { key: string; fingerprint: string; text: string; status: 'pending' | 'sent' };
type Draft = { key: string; text: string; attempt?: Attempt };
const fingerprint = (value: string) => bytesToHex(sha256(utf8ToBytes(value)));
async function save(drafts: Draft[]) {
  const serialized = JSON.stringify(drafts);
  if (serialized.length > MAX_STORED_CHARACTERS) throw new Error('Недостаточно места для сохранения ответа.');
  await SecureStore.setItemAsync(STORAGE_KEY, serialized);
}
export type MailQuickReplyScope = { userId: number; mailboxId: string; kind: 'message' | 'conversation'; entityId: string };

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = operations.then(operation);
  operations = result.then(() => undefined, () => undefined);
  return result;
}

async function readAll(): Promise<Draft[]> {
  const raw = await SecureStore.getItemAsync(STORAGE_KEY);
  if (raw === null) return [];
  let value: unknown;
  try { value = JSON.parse(raw); } catch {
    // JSON parser errors can contain the input. Never expose draft text in errors.
    throw new Error('Не удалось прочитать черновики быстрых ответов.');
  }
  if (!Array.isArray(value) || value.some((item) => !item || typeof item.key !== 'string' || typeof item.text !== 'string' || (item.attempt && (typeof item.attempt.key !== 'string' || typeof item.attempt.fingerprint !== 'string' || typeof item.attempt.text !== 'string' || !['pending', 'sent'].includes(item.attempt.status))))) {
    throw new Error('Не удалось прочитать черновики быстрых ответов.');
  }
  return value;
}

/** A mounted editor owns a lease. Logout invalidates its queued and future writes. */
export function createMailQuickReplyDraftSession(scope: MailQuickReplyScope) {
  if (!Number.isInteger(scope.userId) || scope.userId <= 0 || !scope.mailboxId.trim() || !scope.entityId.trim()) {
    throw new Error('Не удалось определить владельца черновика.');
  }
  const key = JSON.stringify([scope.userId, scope.mailboxId, scope.kind, scope.entityId]);
  const lease = generation;
  const assertCurrent = () => {
    if (lease !== generation) throw new Error('Сессия черновика завершена.');
  };
  return {
    readPendingKey: () => enqueue(async () => {
      assertCurrent();
      const drafts = await readAll();
      assertCurrent();
      const attempt = drafts.find((entry) => entry.key === key)?.attempt;
      return attempt?.status === 'pending' ? attempt.key : '';
    }),
    prepareSend: (text: string, payload: unknown, makeKey: () => string, expectedKey?: string) => enqueue(async () => {
      assertCurrent();
      const drafts = await readAll();
      assertCurrent();
      const previous = drafts.find((entry) => entry.key === key);
      const hash = fingerprint(JSON.stringify(payload));
      const pending = previous?.attempt?.status === 'pending' ? previous.attempt : undefined;
      if (expectedKey && pending?.key !== expectedKey) throw new Error('Эта попытка отправки уже завершена.');
      if (pending && pending.fingerprint !== hash) throw new Error('Состав ответа изменился. Сначала проверьте результат предыдущей отправки.');
      const attempt: Attempt = pending || { key: makeKey(), fingerprint: hash, text: fingerprint(text), status: 'pending' };
      if (attempt.key.length < 8 || attempt.key.length > 128) throw new Error('Не удалось подготовить отправку.');
      await save([...drafts.filter((entry) => entry.key !== key), { key, text, attempt }]);
      return { key: attempt.key, retry: Boolean(pending) };
    }),
    completeSend: (attemptKey: string) => enqueue(async () => {
      assertCurrent();
      const drafts = await readAll();
      assertCurrent();
      const current = drafts.find((entry) => entry.key === key);
      if (current?.attempt?.key !== attemptKey) return;
      if (fingerprint(current.text) === current.attempt.text) {
        current.text = '';
        current.attempt.text = fingerprint('');
      }
      current.attempt.status = 'sent';
      await save(drafts);
    }),
    resolvePending: (wasSent: boolean, expectedKey: string) => enqueue(async () => {
      assertCurrent();
      const drafts = await readAll();
      assertCurrent();
      const current = drafts.find((entry) => entry.key === key);
      if (!current?.attempt || current.attempt.status !== 'pending' || current.attempt.key !== expectedKey) throw new Error('Эта попытка отправки уже завершена.');
      if (wasSent) current.text = '';
      delete current.attempt;
      await save(drafts);
    }),
    clearIfText: (expected: string) => enqueue(async () => {
      assertCurrent();
      const drafts = await readAll();
      assertCurrent();
      const current = drafts.find((entry) => entry.key === key);
      if (!current || current.text !== expected) return;
      if (current.attempt?.status === 'pending') throw new Error('Сначала проверьте результат отправки.');
      const remaining = drafts.filter((entry) => entry.key !== key);
      if (remaining.length) await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(remaining));
      else await SecureStore.deleteItemAsync(STORAGE_KEY);
    }),
    read: () => enqueue(async () => {
      assertCurrent();
      const drafts = await readAll();
      assertCurrent();
      const current = drafts.find((entry) => entry.key === key);
      return current?.attempt?.status === 'sent' && current.attempt.text === fingerprint(current.text) ? '' : current?.text || '';
    }),
    write: (text: string) => enqueue(async () => {
      assertCurrent();
      const all = await readAll();
      const previous = all.find((entry) => entry.key === key);
      const drafts = all.filter((entry) => entry.key !== key);
      assertCurrent();
      if (previous?.attempt?.status === 'pending' && text !== previous.text) throw new Error('Сначала проверьте результат отправки.');
      if (text.length || previous?.attempt?.status === 'pending') drafts.push({ key, text, attempt: previous?.attempt?.status === 'pending' ? previous.attempt : undefined });
      if (!drafts.length) { await SecureStore.deleteItemAsync(STORAGE_KEY); return; }
      const serialized = JSON.stringify(drafts);
      if (serialized.length > MAX_STORED_CHARACTERS) throw new Error('Недостаточно места для черновика. Сохраните письмо в полном редакторе.');
      await SecureStore.setItemAsync(STORAGE_KEY, serialized);
    }),
  };
}

export function clearMailQuickReplyDrafts(): Promise<void> {
  generation += 1;
  return enqueue(() => SecureStore.deleteItemAsync(STORAGE_KEY));
}
