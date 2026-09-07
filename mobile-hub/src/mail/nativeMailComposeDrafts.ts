import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';
import * as SecureStore from 'expo-secure-store';
import { Directory, File, Paths } from 'expo-file-system';
import { randomUUID } from 'expo-crypto';
import type { MailAttachment, MailUploadFile } from '../api/mailApi';

const KEY = 'hubit_mail_compose_drafts_v1';
const MAX_CHARACTERS = 262_144;
let operations: Promise<unknown> = Promise.resolve();
let generation = 0;
let revisionClock = 0;
const root = () => new Directory(Paths.document, 'hubit-mail-compose-files');
const copies = new Map<string, string>();
export type MailComposeDraftScope = { userId: number; mailboxId: string; sourceId: string; mode: string };
export type MailComposeLocalDraft = {
  draftId: string; to: string; cc: string; bcc: string; subject: string; body: string;
  quoteHtml: string; replyToMessageId: string; forwardMessageId: string;
  richDraftRequiresWeb?: boolean;
  bodyHtml?: string;
  richEditing?: boolean;
  retainedAttachments: MailAttachment[]; files: MailUploadFile[];
};
type SendAttempt = { key: string; fingerprint: string; status: 'pending' | 'sent' };
type Entry = { key: string; state: MailComposeLocalDraft; revision?: number; sendAttempt?: SendAttempt };
function sendFingerprint(state: MailComposeLocalDraft): string {
  return bytesToHex(sha256(utf8ToBytes(JSON.stringify(state))));
}
function matchesSendState(attempt: SendAttempt, state: MailComposeLocalDraft): boolean {
  return attempt.fingerprint === sendFingerprint(state) || attempt.fingerprint === JSON.stringify(state);
}
function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = operations.then(operation);
  operations = result.then(() => undefined, () => undefined);
  return result;
}
function validState(value: unknown): value is MailComposeLocalDraft {
  if (!value || typeof value !== 'object') return false;
  const state = value as Record<string, unknown>;
  return ['draftId', 'to', 'cc', 'bcc', 'subject', 'body', 'quoteHtml', 'replyToMessageId', 'forwardMessageId']
    .every((key) => typeof state[key] === 'string')
    && (state.richEditing === undefined || typeof state.richEditing === 'boolean')
    && (state.bodyHtml === undefined || typeof state.bodyHtml === 'string')
    && (state.richDraftRequiresWeb === undefined || typeof state.richDraftRequiresWeb === 'boolean')
    && Array.isArray(state.retainedAttachments) && Array.isArray(state.files)
    && state.files.every((file) => file && typeof file.uri === 'string' && typeof file.name === 'string');
}
async function readAll(): Promise<Entry[]> {
  const raw = await SecureStore.getItemAsync(KEY);
  let entries: unknown;
  try { entries = raw ? JSON.parse(raw) : []; }
  catch { throw new Error('Не удалось прочитать локальные черновики писем.'); }
  if (!Array.isArray(entries) || entries.some((entry) => !entry || typeof entry.key !== 'string' || !validState(entry.state) || (entry.sendAttempt && (typeof entry.sendAttempt.key !== 'string' || typeof entry.sendAttempt.fingerprint !== 'string' || !['pending', 'sent'].includes(entry.sendAttempt.status))))) {
    throw new Error('Не удалось прочитать локальные черновики писем.');
  }
  return entries;
}

export function listLocalMailComposeDrafts(userId: number): Promise<Array<MailComposeDraftScope & { subject: string }>> {
  return enqueue(async () => {
    if (!Number.isInteger(userId) || userId <= 0) return [];
    const entries = await readAll();
    return entries.slice().sort((a, b) => (b.revision || 0) - (a.revision || 0)).flatMap((entry) => {
      let parts: unknown;
      try { parts = JSON.parse(entry.key); } catch { return []; }
      if (!Array.isArray(parts) || parts.length !== 4 || parts[0] !== userId
        || typeof parts[1] !== 'string' || !parts[1] || typeof parts[2] !== 'string'
        || !['new', 'reply', 'reply_all', 'forward', 'draft'].includes(parts[3])) return [];
      if (entry.sendAttempt?.status === 'sent') return [];
      return [{ userId, mailboxId: parts[1], sourceId: parts[2], mode: parts[3], subject: entry.state.subject }];
    });
  });
}
function copyFiles(userId: number, files: MailUploadFile[]): MailUploadFile[] {
  const directory = new Directory(root(), String(userId));
  directory.create({ intermediates: true, idempotent: true });
  const prefix = `${directory.uri.replace(/\/$/, '')}/`;
  return files.map((file) => {
    const source = new File(file.uri);
    if (!source.exists) throw new Error('Вложение недоступно. Локальный черновик не обновлён.');
    if (file.uri.startsWith(prefix)) {
      if (file.size > 0 && source.size !== file.size) {
        throw new Error('Размер вложения изменился. Выберите файл снова.');
      }
      return { ...file, size: source.size };
    }
    const key = JSON.stringify([userId, file.uri, source.size, source.modificationTime]);
    const previous = copies.get(key);
    if (previous) {
      const cached = new File(previous);
      if (cached.exists && cached.size === source.size) return { ...file, uri: previous, size: cached.size };
    }
    const target = new File(directory, randomUUID());
    source.copy(target);
    if (!target.exists || target.size !== source.size) throw new Error('Не удалось сохранить копию вложения.');
    copies.set(key, target.uri);
    return { ...file, uri: target.uri, size: target.size };
  });
}
export function createMailComposeDraftSession(scope: MailComposeDraftScope) {
  if (!Number.isInteger(scope.userId) || scope.userId <= 0 || !scope.mailboxId || !scope.mode) {
    throw new Error('Не удалось определить владельца черновика.');
  }
  const key = JSON.stringify([scope.userId, scope.mailboxId, scope.sourceId, scope.mode]);
  const lease = generation;
  let closed = false;
  let terminal = false;
  let clearAttempt = 0;
  let observed = false;
  let observedRevision: number | undefined;
  const check = () => { if (closed || terminal || lease !== generation) throw new Error('Сессия черновика завершена.'); };
  const persist = (state: MailComposeLocalDraft, createSendKey?: () => string) => {
    // Snapshot immediately so caller edits cannot change a queued save.
    const snapshot: MailComposeLocalDraft = JSON.parse(JSON.stringify(state));
    return enqueue(async () => {
      check();
      if (!validState(snapshot)) throw new Error('Некорректный локальный черновик.');
      const entries = await readAll(); check();
      const previous = entries.find((entry) => entry.key === key);
      let sendAttempt = previous?.sendAttempt?.status === 'pending' ? previous.sendAttempt : undefined;
      const next = entries.filter((entry) => entry.key !== key);
      for (const entry of entries) {
        if (Number.isSafeInteger(entry.revision)) revisionClock = Math.max(revisionClock, entry.revision!);
      }
      const revision = ++revisionClock;
      const entry: Entry = { key, state: snapshot, revision, sendAttempt };
      next.push(entry);
      if (JSON.stringify(next).length > MAX_CHARACTERS) throw new Error('Недостаточно места для локальных черновиков.');
      snapshot.files = copyFiles(scope.userId, snapshot.files);
      if (createSendKey) {
        const fingerprint = sendFingerprint(snapshot);
        if (sendAttempt && !matchesSendState(sendAttempt, snapshot)) throw new Error('Предыдущая отправка не подтверждена. Проверьте «Отправленные» перед отправкой изменённого письма.');
        sendAttempt = sendAttempt || { key: createSendKey(), fingerprint, status: 'pending' };
        if (sendAttempt.key.length < 8 || sendAttempt.key.length > 128) throw new Error('Не удалось подготовить ключ отправки.');
        entry.sendAttempt = sendAttempt;
      }
      const raw = JSON.stringify(next);
      if (raw.length > MAX_CHARACTERS) throw new Error('Недостаточно места для локальных черновиков.');
      check(); await SecureStore.setItemAsync(KEY, raw);
      observed = true; observedRevision = revision;
      return { state: snapshot, sendAttempt, retry: previous?.sendAttempt?.status === 'pending' };
    });
  };
  return {
    clear: () => {
      closed = true;
      const attempt = ++clearAttempt;
      return enqueue(async () => {
        if (lease !== generation) return;
        const current = await readAll();
        const existing = current.find((entry) => entry.key === key);
        if (existing && (!observed || existing.revision !== observedRevision)) return;
        const entries = current.filter((entry) => entry.key !== key);
        if (entries.length) await SecureStore.setItemAsync(KEY, JSON.stringify(entries));
        else await SecureStore.deleteItemAsync(KEY);
      }).catch((error: unknown) => {
        if (!terminal && lease === generation && attempt === clearAttempt) closed = false;
        throw error;
      });
    },
    read: () => enqueue(async () => {
      check(); const entries = await readAll(); check();
      const entry = entries.find((item) => item.key === key);
      observed = true; observedRevision = entry?.revision;
      return entry?.sendAttempt?.status === 'sent' ? null : entry?.state ?? null;
    }),
    write: (state: MailComposeLocalDraft) => persist(state).then((result) => result.state),
    prepareSend: (state: MailComposeLocalDraft, createSendKey: () => string) => persist(state, createSendKey),
    hasPendingSend: () => enqueue(async () => { check(); const entries = await readAll(); check(); return entries.some((entry) => entry.key === key && entry.sendAttempt?.status === 'pending'); }),
    completeSend: (sendKey: string) => {
      closed = true; terminal = true;
      return enqueue(async () => {
        if (lease !== generation) return;
        const entries = await readAll();
        const entry = entries.find((item) => item.key === key);
        if (!entry?.sendAttempt || entry.sendAttempt.key !== sendKey) return;
        if (matchesSendState(entry.sendAttempt, entry.state)) entry.sendAttempt.status = 'sent';
        else delete entry.sendAttempt;
        if (lease !== generation) return;
        await SecureStore.setItemAsync(KEY, JSON.stringify(entries));
      });
    },
  };
}
export function clearMailComposeDrafts(): Promise<void> {
  generation += 1;
  return enqueue(async () => {
    await SecureStore.deleteItemAsync(KEY);
    const directory = root();
    if (directory.exists) directory.delete();
    copies.clear();
  });
}
