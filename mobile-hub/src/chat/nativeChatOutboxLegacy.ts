import * as SecureStore from 'expo-secure-store';
import type { ChatMessage } from '../api/types';
import type { NativePickedFile } from '../files/nativeFilePicker';
import { recordChatQueueStorageOp } from '../diagnostics/chatSendTiming';
import { recordDiagnosticEvent } from '../diagnostics/diagnostics';
import { persistNativeChatDraftFiles, deleteUnreferencedChatFiles } from './nativeChatDraftFiles';

export type NativeChatQueuedUpload = {
  files: NativePickedFile[];
  mediaKind?: 'image' | 'video' | 'file' | 'audio';
  durationSeconds?: number;
  body: string;
  replyToMessageId?: string;
  replyPreview?: ChatMessage['reply_preview'];
  // Durable resumable-upload session handle; survives process restarts so a
  // retry can reattach to the same server session instead of re-uploading.
  sessionId?: string;
};

import { CHAT_OUTBOX_STORAGE_KEY as KEY, enqueueNativeChatStorage as enqueue,
  getNativeChatOutboxRowsCache, setNativeChatOutboxRowsCache } from './nativeChatStorageQueue';
const MAX_CHARACTERS = 262_144;
/** Non-text send intent persisted with the row so the session runner can
 * dispatch sticker/task-share deliveries without an open thread screen. */
export type NativeChatOutboxCommand =
  | { type: 'sticker'; sticker_id: string }
  | { type: 'task_share'; task_id: string };
export type NativeChatOutboxEntry = {
  userId: number;
  message: ChatMessage;
  upload?: NativeChatQueuedUpload;
  title?: string;
  command?: NativeChatOutboxCommand;
};
type Entry = NativeChatOutboxEntry;
const listeners = new Set<() => void>();
function notify() {
  listeners.forEach((listener) => {
    try { listener(); } catch { /* UI observers cannot invalidate a storage commit. */ }
  });
}
export function subscribeNativeChatOutbox(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function readNativeChatOutbox(userId: number) {
  return enqueue(async () => (await readAll(userId)).filter((entry) => entry.userId === userId).map((entry) => ({
    ...entry,
    busy: sending.has(JSON.stringify([generation, userId, entry.message.conversation_id, entry.message.client_message_id]))
      || uploading.has(JSON.stringify([generation, userId, entry.message.conversation_id, entry.message.client_message_id])),
  })));
}
let generation = 0;
const sending = new Map<string, Promise<ChatMessage>>();
const uploading = new Set<string>();
const discarding = new Set<string>();
const discarded = new Set<string>();

function validReply(value: unknown): boolean {
  if (value == null) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  const reply = value as Record<string, unknown>;
  return typeof reply.id === 'string' && Boolean(reply.id.trim())
    && (reply.body == null || typeof reply.body === 'string')
    && (reply.sender_name == null || typeof reply.sender_name === 'string');
}

function validMessage(value: unknown): value is ChatMessage {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const message = value as Partial<ChatMessage>;
  return typeof message.id === 'string' && Boolean(message.id.trim())
    && typeof message.client_message_id === 'string' && Boolean(message.client_message_id.trim())
    && typeof message.conversation_id === 'string' && Boolean(message.conversation_id.trim())
    && (message.body_text == null || typeof message.body_text === 'string')
    && validReply(message.reply_preview);
}

function validUpload(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const upload = value as Partial<NativeChatQueuedUpload>;
  return typeof upload.body === 'string' && Array.isArray(upload.files)
    && (upload.replyToMessageId == null || typeof upload.replyToMessageId === 'string')
    && validReply(upload.replyPreview)
    && (upload.durationSeconds == null || (typeof upload.durationSeconds === 'number' && Number.isFinite(upload.durationSeconds) && upload.durationSeconds >= 0))
    && (upload.mediaKind == null || ['image', 'video', 'file', 'audio'].includes(upload.mediaKind))
    && (upload.sessionId == null || typeof upload.sessionId === 'string')
    && upload.files.every((file) => file && typeof file.uri === 'string' && Boolean(file.uri.trim())
      && typeof file.name === 'string' && typeof file.mimeType === 'string'
      && typeof file.size === 'number' && Number.isFinite(file.size) && file.size >= 0);
}

export function validNativeChatOutboxCommand(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  const command = value as Record<string, unknown>;
  if (command.type === 'sticker') {
    return typeof command.sticker_id === 'string' && Boolean(command.sticker_id.trim());
  }
  if (command.type === 'task_share') {
    return typeof command.task_id === 'string' && Boolean(command.task_id.trim());
  }
  return false;
}

/** Upload file references found on dropped entries — reclaimed after a repair. */
export function nativeChatOutboxUploadUris(items: unknown[]): string[] {
  return items.flatMap((item) => {
    const files = (item as Entry | null)?.upload?.files;
    if (!Array.isArray(files)) return [];
    return files.map((file) => file?.uri).filter((uri): uri is string => typeof uri === 'string');
  });
}

/** Splits a decoded blob into valid rows owned by `ownerId` and the dropped
 * remainder (structurally damaged rows and rows left by another account). */
export function partitionNativeChatOutboxEntries(value: unknown, ownerId?: number): { rows: Entry[]; dropped: unknown[] } {
  const rows: Entry[] = [];
  const dropped: unknown[] = [];
  if (!Array.isArray(value)) return { rows, dropped };
  for (const item of value as Entry[]) {
    if (!item || !Number.isInteger(item.userId) || item.userId <= 0 || !validMessage(item.message)
      || item.message.sender_user_id !== item.userId || !validUpload(item.upload)
      || !validNativeChatOutboxCommand(item.command)) {
      dropped.push(item);
      continue;
    }
    // Rows of another account can never be delivered under this session —
    // they only consume the shared storage budget, so they are dropped once.
    if (ownerId != null && item.userId !== ownerId) {
      dropped.push(item);
      continue;
    }
    rows.push(item);
  }
  return { rows, dropped };
}

/** Moves an unreadable blob aside instead of failing every later operation:
 * the payload stays recoverable for support, the queue restarts empty. */
export async function quarantineNativeChatOutboxBlob(raw: string): Promise<void> {
  try { await SecureStore.setItemAsync(`${KEY}_corrupt_${Date.now()}`, raw); }
  catch { /* The quarantine copy is best-effort; the empty queue still unblocks sends. */ }
  const startedAt = Date.now();
  try { await SecureStore.deleteItemAsync(KEY); }
  catch { /* The next successful write overwrites the blob anyway. */ }
  finally { recordChatQueueStorageOp('delete', Date.now() - startedAt, 0); }
}

async function readAll(ownerId?: number): Promise<Entry[]> {
  const cached = getNativeChatOutboxRowsCache();
  let parsed: unknown = cached;
  if (parsed === null || parsed === undefined) {
    const startedAt = Date.now();
    let raw: string | null = null;
    try { raw = await SecureStore.getItemAsync(KEY); }
    finally { recordChatQueueStorageOp('read', Date.now() - startedAt, raw?.length || 0); }
    try { parsed = raw ? JSON.parse(raw) : []; }
    catch { parsed = null; }
    if (!Array.isArray(parsed)) {
      if (raw) await quarantineNativeChatOutboxBlob(raw);
      void recordDiagnosticEvent('native_file_error');
      setNativeChatOutboxRowsCache([]);
      notify();
      return [];
    }
  }
  const { rows, dropped } = partitionNativeChatOutboxEntries(parsed, ownerId);
  if (dropped.length) {
    await writeAll(rows);
    void recordDiagnosticEvent('native_file_error');
    await deleteUnreferencedChatFiles(nativeChatOutboxUploadUris(dropped)).catch(() => undefined);
    return rows;
  }
  if (!cached) setNativeChatOutboxRowsCache(rows);
  return rows;
}

async function writeAll(entries: Entry[]) {
  const raw = JSON.stringify(entries);
  if (raw.length > MAX_CHARACTERS) throw new Error('Очередь сообщений заполнена. Повторите отправку ожидающих сообщений.');
  const startedAt = Date.now();
  try {
    if (entries.length) await SecureStore.setItemAsync(KEY, raw);
    else await SecureStore.deleteItemAsync(KEY);
  } finally {
    recordChatQueueStorageOp(entries.length ? 'write' : 'delete', Date.now() - startedAt, entries.length ? raw.length : 0);
  }
  setNativeChatOutboxRowsCache(entries);
  notify();
}

export function createNativeChatOutbox(userId: number, conversationId: string, getTitle?: () => string) {
  const lease = generation;
  const operationKey = (id: string) => JSON.stringify([lease, userId, conversationId, id]);
  const assertNotDiscarded = (id: string) => {
    const key = operationKey(id);
    if (discarding.has(key) || discarded.has(key)) throw new Error('Сообщение удаляется или уже убрано из очереди');
  };
  const assertCurrent = () => {
    if (generation !== lease || userId <= 0 || !conversationId) throw new Error('Сеанс очереди сообщений завершён');
  };
  const matches = (entry: Entry, id: string) => entry.userId === userId
    && entry.message.conversation_id === conversationId && entry.message.client_message_id === id;
  const put = (message: ChatMessage, upload?: NativeChatQueuedUpload, decorate?: (entry: Entry) => Entry,
    command?: NativeChatOutboxCommand) => enqueue(async () => {
    assertCurrent();
    assertNotDiscarded(message.client_message_id || '');
    const entries = await readAll(userId);
    assertCurrent();
    if (!validMessage(message) || message.conversation_id !== conversationId || message.sender_user_id !== userId
      || !validUpload(upload) || !validNativeChatOutboxCommand(command)) throw new Error('Некорректное исходящее сообщение');
    const previous = entries.find((entry) => matches(entry, message.client_message_id!));
    if (previous) {
      if (Boolean(previous.upload) !== Boolean(upload)) throw new Error('Тип повторной отправки изменился');
      if (previous.message.body_text !== message.body_text || previous.message.reply_preview?.id !== message.reply_preview?.id
        || JSON.stringify(previous.command || null) !== JSON.stringify(command || null)) {
        throw new Error('Содержимое повторной отправки изменилось');
      }
      return previous.upload;
    }
    // Upload files arrive already durable — callers copy them outside the
    // storage queue so large attachments do not stall every chat write.
    const durableMessage = upload ? { ...message, attachments: message.attachments?.map((attachment, index) => ({
      ...attachment, local_uri: upload.files[index]?.uri || attachment.local_uri,
    })) } : message;
    const fresh: Entry = {
      userId, message: durableMessage, title: getTitle?.(),
      ...(upload ? { upload } : {}), ...(command ? { command } : {}),
    };
    await writeAll([...entries, decorate ? decorate(fresh) : fresh]);
    return upload;
  });
  const remove = (id: string) => enqueue(async () => {
    assertCurrent();
    const entries = await readAll(userId);
    assertCurrent();
    await writeAll(entries.filter((entry) => !matches(entry, id)));
    await deleteUnreferencedChatFiles(entries.filter((entry) => matches(entry, id)).flatMap((entry) => entry.upload?.files.map((file) => file.uri) || [])).catch(() => undefined);
  });
  return {
    detachReply: (id: string, replacementId: string, canProceed: () => boolean = () => true): Promise<{ message: ChatMessage; upload?: NativeChatQueuedUpload }> => {
      const key = operationKey(id);
      if (sending.has(key) || uploading.has(key) || discarding.has(key)) return Promise.reject(new Error('Дождитесь завершения отправки'));
      discarding.add(key);
      return enqueue(async () => {
        assertCurrent();
        if (!canProceed()) throw new Error('Доступ к диалогу изменился');
        const entries = await readAll(userId);
        assertCurrent();
        if (!canProceed()) throw new Error('Доступ к диалогу изменился');
        const entry = entries.find((candidate) => matches(candidate, id));
        if (!entry || !entry.message.reply_preview?.id || !replacementId.trim()
          || entries.some((candidate) => matches(candidate, replacementId))) throw new Error('Не удалось изменить ответ в очереди');
        assertNotDiscarded(replacementId);
        const message: ChatMessage = { ...entry.message, id: `pending:${replacementId}`,
          client_message_id: replacementId, reply_preview: null, local_status: 'failed' };
        const upload = entry.upload ? { ...entry.upload, replyToMessageId: undefined, replyPreview: null } : undefined;
        await writeAll(entries.map((candidate) => candidate === entry ? { ...entry, message, ...(upload ? { upload } : {}) } : candidate));
        discarded.add(key);
        return { message, upload };
      }).finally(() => { discarding.delete(key); });
    },
    discard: (id: string): Promise<void> => {
      const key = operationKey(id);
      if (sending.has(key) || uploading.has(key)) return Promise.reject(new Error('Дождитесь завершения или отмены отправки'));
      if (discarding.has(key)) return Promise.reject(new Error('Сообщение уже удаляется из очереди'));
      discarding.add(key);
      return remove(id).then(() => { discarded.add(key); }).finally(() => { discarding.delete(key); });
    },
    prepareUpload: async (message: ChatMessage, upload: NativeChatQueuedUpload, decorate?: (entry: Entry) => Entry) => {
      const key = operationKey(message.client_message_id || '');
      assertNotDiscarded(message.client_message_id || '');
      if (uploading.has(key)) throw new Error('Файлы уже отправляются');
      uploading.add(key);
      let durableUpload: NativeChatQueuedUpload | null = null;
      try {
        // Durable copies run before the serialized storage queue: file IO must
        // not block drafts, reads and delivery claims across conversations.
        durableUpload = { ...upload, files: await persistNativeChatDraftFiles(userId, upload.files) };
        assertCurrent();
        assertNotDiscarded(message.client_message_id || '');
        const persisted = await put(message, durableUpload, decorate);
        assertCurrent();
        if (!persisted) throw new Error('Не удалось восстановить файлы исходящего сообщения');
        if (persisted !== durableUpload) {
          // The entry already existed and keeps its own durable copies.
          await deleteUnreferencedChatFiles(durableUpload.files.map((file) => file.uri)).catch(() => undefined);
        }
        return persisted;
      } catch (error) {
        if (durableUpload) {
          await deleteUnreferencedChatFiles(durableUpload.files.map((file) => file.uri)).catch(() => undefined);
        }
        uploading.delete(key);
        throw error;
      }
    },
    finishUpload: (id: string) => { uploading.delete(operationKey(id)); notify(); },
    completeUpload: (id: string) => remove(id).finally(() => { uploading.delete(operationKey(id)); notify(); }),
    readUploads: () => enqueue(async () => {
      assertCurrent();
      const entries = await readAll(userId);
      assertCurrent();
      return entries.filter((entry) => entry.userId === userId && entry.message.conversation_id === conversationId && entry.upload)
        .map((entry) => ({ id: entry.message.client_message_id!, upload: entry.upload! }));
    }),
    acknowledge: (messages: ChatMessage[]) => enqueue(async () => {
      assertCurrent();
      const confirmedIds = new Set(messages.filter((message) => !message.local_status
        && message.sender_user_id === userId && message.conversation_id === conversationId)
        .map((message) => message.client_message_id).filter(Boolean));
      if (!confirmedIds.size) return;
      const entries = await readAll(userId);
      assertCurrent();
      const next = entries.filter((entry) => !(entry.userId === userId
        && entry.message.conversation_id === conversationId && confirmedIds.has(entry.message.client_message_id)));
      if (next.length !== entries.length) {
        await writeAll(next);
        await deleteUnreferencedChatFiles(entries.filter((entry) => !next.includes(entry)).flatMap((entry) => entry.upload?.files.map((file) => file.uri) || [])).catch(() => undefined);
      }
    }),
    read: () => enqueue(async () => {
      assertCurrent();
      const entries = await readAll(userId);
      assertCurrent();
      return entries.filter((entry) => entry.userId === userId && entry.message.conversation_id === conversationId)
        .map((entry): ChatMessage => ({ ...entry.message, local_status: 'failed' }));
    }),
    send: (message: ChatMessage, sendText: typeof import('../api/chatApi').sendTextMessage, onPersisted?: () => void,
      options?: { deliver?: boolean; decorate?: (entry: Entry) => Entry; command?: NativeChatOutboxCommand }): Promise<ChatMessage> => {
      const key = JSON.stringify([lease, userId, conversationId, message.client_message_id]);
      try { assertNotDiscarded(message.client_message_id || ''); }
      catch (error) { return Promise.reject(error); }
      const existing = sending.get(key);
      if (existing) return existing;
      const operation = (async () => {
        await put(message, undefined, options?.decorate, options?.command);
        assertCurrent();
        onPersisted?.();
        if (options?.deliver === false) {
          return { ...message, local_status: 'failed' as const };
        }
        const saved = await sendText(conversationId, message.body_text || '', {
          clientMessageId: message.client_message_id || undefined,
          replyToMessageId: message.reply_preview?.id,
        });
        // A cleanup failure must not turn an acknowledged send into an error.
        // The retained entry can be retried with the same idempotency key.
        await remove(message.client_message_id!).catch(() => undefined);
        return saved;
      })().finally(() => { sending.delete(key); notify(); });
      sending.set(key, operation);
      return operation;
    },
  };
}

export function clearNativeChatOutbox(): Promise<void> {
  generation += 1;
  discarded.clear();
  return enqueue(async () => {
    const startedAt = Date.now();
    try { await SecureStore.deleteItemAsync(KEY); }
    finally { recordChatQueueStorageOp('delete', Date.now() - startedAt, 0); }
    setNativeChatOutboxRowsCache([]);
    notify();
  });
}
