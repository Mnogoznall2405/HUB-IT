import * as SecureStore from 'expo-secure-store';
import type { ChatMessage } from '../api/types';
import * as legacy from './nativeChatOutboxLegacy';
import { CHAT_OUTBOX_STORAGE_KEY, enqueueNativeChatStorage } from './nativeChatStorageQueue';
import { deleteUnreferencedChatFiles } from './nativeChatDraftFiles';
export type { NativeChatQueuedUpload } from './nativeChatOutboxLegacy';
export type NativeChatDeliveryState = 'queued' | 'retry' | 'sending' | 'paused' | 'cancelled' | 'confirmed';
export type NativeChatDelivery = {
  version: 1; state: NativeChatDeliveryState; attempts: number; notBefore: number;
  confirmed?: ChatMessage; replyMissing?: boolean;
};
export type NativeChatOutboxEntry = legacy.NativeChatOutboxEntry & { delivery?: NativeChatDelivery };
type Entry = NativeChatOutboxEntry;
type Projection = ChatMessage & { local_queue_state?: NativeChatDeliveryState };
export type NativeChatDeliveryEvent = { userId: number; message: ChatMessage; loaded?: number; total?: number | null };
export const NATIVE_CHAT_MAX_DELIVERY_ATTEMPTS = 5;
export const NATIVE_CHAT_DELIVERY_RETRY_MS = [2000, 5000, 15000, 30000] as const;
const events = new Set<(event: NativeChatDeliveryEvent) => void>();
const changes = new Set<() => void>();
let generation = 0;
const jobs = new Map<string, Promise<ChatMessage>>();
const preparations = new Map<string, Promise<{ message: ChatMessage; upload?: legacy.NativeChatQueuedUpload }>>();
const controllers = new Map<string, AbortController>();
const cancelled = new Set<string>();
const acknowledgements = new Map<string, ChatMessage>();
function keyFor(user: number, dialog: string, id: string, lease = generation) { return JSON.stringify([lease, user, dialog, id]); }
function notify() { changes.forEach((listener) => { try { listener(); } catch { /* Observer only. */ } }); }
legacy.subscribeNativeChatOutbox(notify);
export function subscribeNativeChatOutbox(listener: () => void) { changes.add(listener); return () => { changes.delete(listener); }; }
export function subscribeNativeChatDelivery(listener: (event: NativeChatDeliveryEvent) => void) { events.add(listener); return () => { events.delete(listener); }; }
function publish(event: NativeChatDeliveryEvent) { events.forEach((listener) => { try { listener(event); } catch { /* Observer only. */ } }); }
export function getNativeChatOutboxGeneration() { return generation; }
export function getNativeChatQueueState(message: ChatMessage) { return (message as Projection).local_queue_state; }
function project(entry: Entry, busy = false): ChatMessage {
  const ack = entry.delivery?.confirmed || acknowledgements.get(keyFor(entry.userId, entry.message.conversation_id, entry.message.client_message_id || ''));
  if (ack) return { ...ack, local_status: undefined };
  if (!entry.delivery) return { ...entry.message, local_status: 'failed' };
  const state = entry.delivery.state;
  return { ...entry.message,
    local_status: busy ? 'sending' : state === 'cancelled' ? 'cancelled' : 'failed',
    local_queue_state: state === 'sending' && !busy
      ? (entry.delivery!.attempts >= NATIVE_CHAT_MAX_DELIVERY_ATTEMPTS ? 'paused' : 'queued') : state,
  } as Projection;
}
export function nativeChatOutboxMessage(entry: Entry) {
  return project(entry, jobs.has(keyFor(entry.userId, entry.message.conversation_id, entry.message.client_message_id || '')));
}
export function publishNativeChatUploadProgress(entry: Entry, loaded: number, total: number | null) {
  const key = keyFor(entry.userId, entry.message.conversation_id, entry.message.client_message_id || '');
  if (!jobs.has(key) || acknowledgements.has(key) || cancelled.has(key)) return;
  publish({ userId: entry.userId, message: project(entry, true), loaded, total });
}
function validDelivery(entry: Entry) {
  const d = entry.delivery;
  if (d === undefined) return true;
  return d && d.version === 1 && ['queued','retry','sending','paused','cancelled','confirmed'].includes(d.state)
    && Number.isInteger(d.attempts) && d.attempts >= 0 && Number.isFinite(d.notBefore) && d.notBefore >= 0
    && (!d.confirmed || (typeof d.confirmed.id === 'string' && !d.confirmed.id.startsWith('pending:')
      && !d.confirmed.local_status && d.confirmed.sender_user_id === entry.userId
      && d.confirmed.conversation_id === entry.message.conversation_id
      && d.confirmed.client_message_id === entry.message.client_message_id));
}
export async function readNativeChatOutbox(userId: number) {
  const rows = await legacy.readNativeChatOutbox(userId);
  return rows.map((raw) => {
    const entry = raw as Entry & { busy: boolean };
    if (!validDelivery(entry)) throw new Error('Не удалось прочитать состояние доставки');
    const key = keyFor(userId, entry.message.conversation_id, entry.message.client_message_id || '');
    const ack = entry.delivery?.confirmed || acknowledgements.get(key);
    return { ...entry,
      ...(ack && entry.delivery ? { delivery: { ...entry.delivery, state: 'confirmed' as const, confirmed: ack } } : {}),
      busy: entry.busy || jobs.has(key) || preparations.has(key),
    };
  });
}
// Run only inside the existing shared metadata queue. The legacy public reader
// validates the original schema before callers enter this function.
async function readStored(): Promise<Entry[]> {
  const raw = await SecureStore.getItemAsync(CHAT_OUTBOX_STORAGE_KEY);
  const rows: unknown = raw ? JSON.parse(raw) : [];
  if (!Array.isArray(rows) || rows.some((row) => !row || !row.message || !validDelivery(row))) {
    throw new Error('Не удалось прочитать очередь сообщений');
  }
  return rows;
}
async function writeStored(rows: Entry[]) {
  const value = JSON.stringify(rows);
  if (value.length > 262144) throw new Error('Очередь сообщений заполнена');
  if (rows.length) await SecureStore.setItemAsync(CHAT_OUTBOX_STORAGE_KEY, value);
  else await SecureStore.deleteItemAsync(CHAT_OUTBOX_STORAGE_KEY);
  notify();
}
function noWork() { return Object.assign(new Error('Нет доступной операции доставки'), { code: 'HUBIT_NO_DELIVERY' }); }
function transient(error: unknown) {
  const e = error as { code?: string; isAxiosError?: boolean; response?: { status?: number } } | null;
  return [408,429,500,502,503,504].includes(e?.response?.status || 0) || e?.code === 'HUBIT_OFFLINE_READ_ONLY'
    || (!e?.response && (e?.isAxiosError === true || ['ERR_NETWORK','ECONNABORTED','ETIMEDOUT'].includes(e?.code || '')));
}
export function createNativeChatOutbox(userId: number, conversationId: string, getTitle?: () => string) {
  const old = legacy.createNativeChatOutbox(userId, conversationId, getTitle);
  const lease = generation;
  const key = (id: string) => keyFor(userId, conversationId, id, lease);
  const current = () => { if (generation !== lease || !Number.isInteger(userId) || userId <= 0 || !conversationId) throw new Error('Сеанс очереди сообщений завершён'); };
  const match = (row: Entry, id: string) => row.userId === userId && row.message.conversation_id === conversationId && row.message.client_message_id === id;
  const update = (id: string, fn: (row: Entry) => Entry) => enqueueNativeChatStorage(async () => {
    current(); const rows = await readStored(); current();
    const row = rows.find((item) => match(item, id));
    if (!row) throw noWork();
    const next = fn(row);
    await writeStored(rows.map((item) => item === row ? next : item));
    return next;
  });
  const removeConfirmed = (id: string) => enqueueNativeChatStorage(async () => {
    current(); const rows = await readStored(); current();
    const removed = rows.filter((item) => match(item, id));
    await writeStored(rows.filter((item) => !match(item, id)));
    await deleteUnreferencedChatFiles(removed.flatMap((item) => item.upload?.files.map((file) => file.uri) || [])).catch(() => undefined);
    acknowledgements.delete(key(id));
  });
  return {
    ...old,
    read: async () => {
      current(); const rows = await readNativeChatOutbox(userId); current();
      return rows.filter((row) => row.message.conversation_id === conversationId).map((row) => project(row, row.busy));
    },
    queue: (message: ChatMessage, upload?: legacy.NativeChatQueuedUpload): Promise<{ message: ChatMessage; upload?: legacy.NativeChatQueuedUpload }> => {
      const id = message.client_message_id || '', operationKey = key(id);
      try { current(); if (jobs.has(operationKey)) throw noWork(); } catch (error) { return Promise.reject(error); }
      const existing = preparations.get(operationKey);
      if (existing) return existing;
      cancelled.delete(operationKey);
      const operation = (async () => {
        if (upload) { await old.prepareUpload(message, upload); old.finishUpload(id); }
        else await old.send(message, async () => { throw noWork(); }, undefined, { deliver: false });
        current();
        const entry = await update(id, (row) => row.delivery?.confirmed || acknowledgements.has(operationKey) ? row : {
          ...row, delivery: { version: 1, state: cancelled.has(operationKey) ? 'cancelled' : 'queued', attempts: 0, notBefore: 0 },
        });
        current(); return { message: project(entry), upload: entry.upload };
      })().finally(() => { preparations.delete(operationKey); notify(); });
      preparations.set(operationKey, operation); return operation;
    },
    retryDelivery: async (id: string) => {
      current(); if (jobs.has(key(id)) || preparations.has(key(id))) throw noWork();
      const rows = await readNativeChatOutbox(userId); current();
      if (rows.find((row) => match(row, id))?.busy) throw noWork();
      cancelled.delete(key(id));
      await update(id, (row) => {
        if (jobs.has(key(id)) || preparations.has(key(id))) throw noWork();
        return row.delivery?.confirmed ? row : { ...row, delivery: { version: 1, state: 'queued', attempts: 0, notBefore: 0 } };
      });
    },
    cancelDelivery: async (id: string) => {
      current(); cancelled.add(key(id)); controllers.get(key(id))?.abort();
      await update(id, (row) => row.delivery?.confirmed ? row : { ...row, delivery: {
        version: 1, state: 'cancelled', attempts: row.delivery?.attempts || 0, notBefore: 0,
      } });
    },
    discard: async (id: string) => {
      current(); if (jobs.has(key(id)) || preparations.has(key(id))) throw noWork();
      const rows = await readNativeChatOutbox(userId); current();
      if (jobs.has(key(id)) || preparations.has(key(id)) || rows.find((row) => match(row, id))?.delivery?.confirmed) throw noWork();
      cancelled.add(key(id)); await old.discard(id);
    },
    send: (message: ChatMessage, sendText: typeof import('../api/chatApi').sendTextMessage, onPersisted?: () => void, options?: { deliver?: boolean }) => {
      const id = message.client_message_id || '';
      const running = jobs.get(key(id));
      if (running) return running;
      if (preparations.has(key(id))) return Promise.reject(noWork());
      return old.send(message, sendText, onPersisted, options);
    },
    prepareUpload: async (message: ChatMessage, upload: legacy.NativeChatQueuedUpload) => {
      if (jobs.has(key(message.client_message_id || ''))) throw noWork();
      return old.prepareUpload(message, upload);
    },
    detachReply: async (id: string, replacement: string, canProceed: () => boolean = () => true) => {
      current(); if (jobs.has(key(id)) || preparations.has(key(id))) throw noWork();
      cancelled.add(key(replacement));
      try {
        const changed = await old.detachReply(id, replacement, canProceed);
        await update(replacement, (row) => ({ ...row, delivery: undefined }));
        return changed;
      } finally { cancelled.delete(key(replacement)); }
    },
    acknowledge: async (messages: ChatMessage[]) => {
      current(); await legacy.readNativeChatOutbox(userId); current();
      await enqueueNativeChatStorage(async () => {
        const rows = await readStored(); current();
        const next: Entry[] = [], removed: Entry[] = [];
        for (const row of rows) {
          const ack = messages.find((message) => !message.local_status && message.sender_user_id === userId
            && message.conversation_id === conversationId && message.client_message_id && match(row, message.client_message_id));
          if (!ack) { next.push(row); continue; }
          if (!row.delivery) { removed.push(row); continue; }
          acknowledgements.set(key(row.message.client_message_id!), ack);
          next.push({ ...row, delivery: { ...row.delivery, state: 'confirmed', confirmed: ack } });
        }
        await writeStored(next);
        await deleteUnreferencedChatFiles(removed.flatMap((row) => row.upload?.files.map((file) => file.uri) || [])).catch(() => undefined);
      });
    },
    deliverQueued: (id: string, transport: (row: Entry, signal: AbortSignal) => Promise<ChatMessage>, canSend: () => boolean,
      persistConfirmed: (row: Entry, saved: ChatMessage) => Promise<boolean>, signal?: AbortSignal): Promise<ChatMessage> => {
      const operationKey = key(id), pending = jobs.get(operationKey);
      if (pending) return pending;
      if (preparations.has(operationKey)) return Promise.reject(noWork());
      const controller = new AbortController(), stop = () => controller.abort();
      if (signal?.aborted) stop();
      signal?.addEventListener('abort', stop, { once: true });
      controllers.set(operationKey, controller);
      let claimed: Entry | null = null;
      const operation = (async () => {
        current();
        const legacyRows = await legacy.readNativeChatOutbox(userId); current();
        if (legacyRows.find((row) => match(row, id))?.busy) throw noWork();
        claimed = await enqueueNativeChatStorage(async () => {
          current(); const rows = await readStored(); current();
          const index = rows.findIndex((row) => match(row, id)), row = rows[index];
          const d = row?.delivery;
          if (!row || !d) throw noWork();
          const ack = d.confirmed || acknowledgements.get(operationKey);
          if (ack) return { ...row, delivery: { ...d, state: 'confirmed' as const, confirmed: ack } };
          if (!canSend() || controller.signal.aborted || cancelled.has(operationKey)
            || !['queued','retry','sending'].includes(d.state) || d.attempts >= NATIVE_CHAT_MAX_DELIVERY_ATTEMPTS || d.notBefore > Date.now()) throw noWork();
          if (rows.slice(0,index).some((before) => before.userId === userId && before.message.conversation_id === conversationId
            && before.delivery && !['confirmed','cancelled'].includes(before.delivery.state))) throw noWork();
          const next: Entry = { ...row, delivery: { ...d, state: 'sending', attempts: d.attempts + 1 } };
          await writeStored(rows.map((item,i) => i === index ? next : item)); return next;
        });
        let saved = claimed.delivery!.confirmed;
        if (!saved) {
          current(); if (!canSend() || controller.signal.aborted || cancelled.has(operationKey)) throw noWork();
          saved = await transport(claimed, controller.signal); current();
          if (!saved?.id || saved.id.startsWith('pending:') || saved.local_status || saved.sender_user_id !== userId
            || saved.conversation_id !== conversationId || (saved.client_message_id && saved.client_message_id !== id)) throw new Error('Некорректное подтверждение отправки');
          saved = { ...saved, client_message_id: id, local_status: undefined };
          acknowledgements.set(operationKey, saved);
        }
        const confirmed: Entry = { ...claimed, delivery: { ...claimed.delivery!, state: 'confirmed', confirmed: saved } };
        await update(id, () => confirmed).catch(() => undefined); current();
        publish({ userId, message: saved });
        let stored = false;
        try { stored = await persistConfirmed(confirmed, saved); } catch { /* Keep the ACK. */ }
        current(); if (stored) await removeConfirmed(id).catch(() => undefined);
        return saved;
      })().catch(async (error: unknown) => {
        if (claimed && generation === lease && !claimed.delivery?.confirmed && !acknowledgements.has(operationKey)) {
          await update(id, (row) => {
            if (row.delivery?.confirmed) return row;
            const attempts = row.delivery?.attempts || 0;
            const isCancelled = cancelled.has(operationKey) || row.delivery?.state === 'cancelled';
            const retry = !isCancelled && attempts < NATIVE_CHAT_MAX_DELIVERY_ATTEMPTS
              && (controller.signal.aborted || (error as {code?: string})?.code === 'HUBIT_NO_DELIVERY' || transient(error));
            const response = (error as {response?: {status?: number;data?: {detail?: unknown}}})?.response;
            return { ...row, delivery: { version: 1, state: isCancelled ? 'cancelled' : retry ? 'retry' : 'paused', attempts,
              notBefore: retry ? Date.now() + NATIVE_CHAT_DELIVERY_RETRY_MS[Math.min(Math.max(attempts-1,0),3)] : 0,
              ...(response?.status === 404 && response.data?.detail === 'Quoted message not found' ? {replyMissing:true} : {}),
            } };
          }).catch(() => undefined);
        }
        throw error;
      }).finally(() => {
        signal?.removeEventListener('abort', stop); controllers.delete(operationKey); jobs.delete(operationKey); notify();
      });
      jobs.set(operationKey, operation); return operation;
    },
  };
}
export function clearNativeChatOutbox() {
  generation += 1;
  controllers.forEach((controller) => controller.abort()); controllers.clear();
  acknowledgements.clear(); cancelled.clear();
  return legacy.clearNativeChatOutbox();
}
