import * as SecureStore from 'expo-secure-store';
import type { ChatMessage } from '../api/types';
import type { NativePickedFile } from '../files/nativeFilePicker';
import { persistNativeChatDraftFiles, deleteUnreferencedChatFiles } from './nativeChatDraftFiles';

export type NativeChatQueuedUpload = {
  files: NativePickedFile[];
  mediaKind?: 'image' | 'video' | 'file' | 'audio';
  durationSeconds?: number;
  body: string;
  replyToMessageId?: string;
  replyPreview?: ChatMessage['reply_preview'];
};

import { CHAT_OUTBOX_STORAGE_KEY as KEY, enqueueNativeChatStorage as enqueue } from './nativeChatStorageQueue';
const MAX_CHARACTERS = 262_144;
export type NativeChatOutboxEntry = { userId: number; message: ChatMessage; upload?: NativeChatQueuedUpload; title?: string };
type Entry = NativeChatOutboxEntry;
const listeners = new Set<() => void>();
function notify() {
  listeners.forEach((listener) => {
    try { listener(); } catch { /* UI observers cannot invalidate a storage commit. */ }
  });
}
export function subscribeNativeChatOutbox(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function readNativeChatOutbox(userId: number) {
  return enqueue(async () => (await readAll()).filter((entry) => entry.userId === userId).map((entry) => ({
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
    && upload.files.every((file) => file && typeof file.uri === 'string' && Boolean(file.uri.trim())
      && typeof file.name === 'string' && typeof file.mimeType === 'string'
      && typeof file.size === 'number' && Number.isFinite(file.size) && file.size >= 0);
}

async function readAll(): Promise<Entry[]> {
  const raw = await SecureStore.getItemAsync(KEY);
  let value: unknown;
  try { value = raw ? JSON.parse(raw) : []; }
  catch { throw new Error('Не удалось прочитать очередь сообщений'); }
  if (!Array.isArray(value) || value.some((item) => !item || !Number.isInteger(item.userId)
    || item.userId <= 0 || !validMessage(item.message)
    || item.message.sender_user_id !== item.userId || !validUpload(item.upload))) {
    throw new Error('Не удалось прочитать очередь сообщений');
  }
  return value;
}

async function writeAll(entries: Entry[]) {
  const raw = JSON.stringify(entries);
  if (raw.length > MAX_CHARACTERS) throw new Error('Очередь сообщений заполнена. Повторите отправку ожидающих сообщений.');
  if (entries.length) await SecureStore.setItemAsync(KEY, raw);
  else await SecureStore.deleteItemAsync(KEY);
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
  const put = (message: ChatMessage, upload?: NativeChatQueuedUpload) => enqueue(async () => {
    assertCurrent();
    assertNotDiscarded(message.client_message_id || '');
    const entries = await readAll();
    assertCurrent();
    if (!validMessage(message) || message.conversation_id !== conversationId || message.sender_user_id !== userId || !validUpload(upload)) throw new Error('Некорректное исходящее сообщение');
    const previous = entries.find((entry) => matches(entry, message.client_message_id!));
    if (previous) {
      if (Boolean(previous.upload) !== Boolean(upload)) throw new Error('Тип повторной отправки изменился');
      if (previous.message.body_text !== message.body_text || previous.message.reply_preview?.id !== message.reply_preview?.id) {
        throw new Error('Содержимое повторной отправки изменилось');
      }
      return previous.upload;
    }
    let durableUpload: NativeChatQueuedUpload | undefined;
    if (upload) {
      // Await every durable copy before writing queue metadata or allowing network upload.
      const durableFiles = await persistNativeChatDraftFiles(userId, upload.files);
      assertCurrent();
      assertNotDiscarded(message.client_message_id || '');
      durableUpload = { ...upload, files: durableFiles };
    }
    const durableMessage = durableUpload ? { ...message, attachments: message.attachments?.map((attachment, index) => ({
      ...attachment, local_uri: durableUpload.files[index]?.uri || attachment.local_uri,
    })) } : message;
    await writeAll([...entries, { userId, message: durableMessage, title: getTitle?.(), ...(durableUpload ? { upload: durableUpload } : {}) }]);
    return durableUpload;
  });
  const remove = (id: string) => enqueue(async () => {
    assertCurrent();
    const entries = await readAll();
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
        const entries = await readAll();
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
    prepareUpload: async (message: ChatMessage, upload: NativeChatQueuedUpload) => {
      const key = operationKey(message.client_message_id || '');
      assertNotDiscarded(message.client_message_id || '');
      if (uploading.has(key)) throw new Error('Файлы уже отправляются');
      uploading.add(key);
      try {
        const persisted = await put(message, upload);
        assertCurrent();
        if (!persisted) throw new Error('Не удалось восстановить файлы исходящего сообщения');
        return persisted;
      } catch (error) { uploading.delete(key); throw error; }
    },
    finishUpload: (id: string) => { uploading.delete(operationKey(id)); notify(); },
    completeUpload: (id: string) => remove(id).finally(() => { uploading.delete(operationKey(id)); notify(); }),
    readUploads: () => enqueue(async () => {
      assertCurrent();
      const entries = await readAll();
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
      const entries = await readAll();
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
      const entries = await readAll();
      assertCurrent();
      return entries.filter((entry) => entry.userId === userId && entry.message.conversation_id === conversationId)
        .map((entry): ChatMessage => ({ ...entry.message, local_status: 'failed' }));
    }),
    send: (message: ChatMessage, sendText: typeof import('../api/chatApi').sendTextMessage, onPersisted?: () => void, options?: { deliver?: boolean }): Promise<ChatMessage> => {
      const key = JSON.stringify([lease, userId, conversationId, message.client_message_id]);
      try { assertNotDiscarded(message.client_message_id || ''); }
      catch (error) { return Promise.reject(error); }
      const existing = sending.get(key);
      if (existing) return existing;
      const operation = (async () => {
        await put(message);
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
  return enqueue(async () => { await SecureStore.deleteItemAsync(KEY); notify(); });
}
