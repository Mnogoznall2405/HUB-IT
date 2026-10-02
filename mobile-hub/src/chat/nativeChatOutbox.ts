import * as SecureStore from 'expo-secure-store';
import type { ChatMessage } from '../api/types';
import { markChatSend, recordChatQueueStorageOp, resetChatSendTiming, settleChatSend } from '../diagnostics/chatSendTiming';
import { recordDiagnosticEvent } from '../diagnostics/diagnostics';
import { noteChatSendHttpStartInflight, resetApiInflight } from '../diagnostics/apiInflight';
import * as legacy from './nativeChatOutboxLegacy';
import { CHAT_OUTBOX_STORAGE_KEY, enqueueNativeChatStorage,
  getNativeChatOutboxRowsCache, setNativeChatOutboxRowsCache } from './nativeChatStorageQueue';
import { deleteUnreferencedChatFiles } from './nativeChatDraftFiles';
export type { NativeChatQueuedUpload, NativeChatOutboxCommand } from './nativeChatOutboxLegacy';
export type NativeChatDeliveryState = 'queued' | 'retry' | 'sending' | 'paused' | 'cancelled' | 'confirmed';
export type NativeChatDelivery = {
  version: 1; state: NativeChatDeliveryState; attempts: number; notBefore: number;
  confirmed?: ChatMessage; replyMissing?: boolean;
};
export type NativeChatOutboxEntry = legacy.NativeChatOutboxEntry & { delivery?: NativeChatDelivery };
type Entry = NativeChatOutboxEntry;
export type NativeChatDeliveryHelpers = {
  // Durable in-place patch of the queued upload metadata (e.g. the resumable
  // session id). Written through the serialized storage queue, so the handle
  // survives a process death between chunks.
  patchUpload: (patch: Partial<legacy.NativeChatQueuedUpload>) => Promise<unknown>;
};
type Projection = ChatMessage & { local_queue_state?: NativeChatDeliveryState };
export type NativeChatDeliveryEvent = { userId: number; message: ChatMessage; loaded?: number; total?: number | null };
export const NATIVE_CHAT_MAX_DELIVERY_ATTEMPTS = 5;
export const NATIVE_CHAT_DELIVERY_RETRY_MS = [2000, 5000, 15000, 30000] as const;
const events = new Set<(event: NativeChatDeliveryEvent) => void>();
const changes = new Set<() => void>();
let generation = 0;
const jobs = new Map<string, Promise<ChatMessage>>();
const preparations = new Map<string, Promise<{ message: ChatMessage; upload?: legacy.NativeChatQueuedUpload }>>();
const preparationTails = new Map<string, Promise<unknown>>();
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
  // An entry without delivery metadata is still in-flight while a preparation
  // or legacy send owns it; only an idle orphan is a real failure.
  if (!entry.delivery) return { ...entry.message, local_status: busy ? 'sending' : 'failed' };
  const state = entry.delivery.state;
  return { ...entry.message,
    local_status: state === 'cancelled' ? 'cancelled' : busy ? 'sending' : 'failed',
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
    // Delivery metadata that fails validation is dropped from the projection
    // instead of failing the whole queue; the row stays manually retryable.
    const sane: Entry & { busy: boolean } = validDelivery(entry) ? entry : { ...entry, delivery: undefined };
    const key = keyFor(userId, sane.message.conversation_id, sane.message.client_message_id || '');
    const ack = sane.delivery?.confirmed || acknowledgements.get(key);
    return { ...sane,
      ...(ack && sane.delivery ? { delivery: { ...sane.delivery, state: 'confirmed' as const, confirmed: ack } } : {}),
      busy: sane.busy || jobs.has(key) || preparations.has(key),
    };
  });
}
// Run only inside the existing shared metadata queue. The blob is repaired
// in place when rows are damaged, carry another account, or hold unreadable
// delivery metadata — a single bad row must never dead-lock the queue.
async function readStored(ownerId: number): Promise<Entry[]> {
  const cached = getNativeChatOutboxRowsCache();
  let parsed: unknown = cached;
  if (parsed === null || parsed === undefined) {
    const startedAt = Date.now();
    let raw: string | null = null;
    try { raw = await SecureStore.getItemAsync(CHAT_OUTBOX_STORAGE_KEY); }
    finally { recordChatQueueStorageOp('read', Date.now() - startedAt, raw?.length || 0); }
    try { parsed = raw ? JSON.parse(raw) : []; }
    catch { parsed = null; }
    if (!Array.isArray(parsed)) {
      if (raw) await legacy.quarantineNativeChatOutboxBlob(raw);
      void recordDiagnosticEvent('native_file_error');
      setNativeChatOutboxRowsCache([]);
      return [];
    }
  }
  const { rows, dropped } = legacy.partitionNativeChatOutboxEntries(parsed, ownerId);
  let stripped = false;
  const sanitized = rows.map((row) => {
    if (validDelivery(row)) return row as Entry;
    stripped = true;
    return { ...row, delivery: undefined } as Entry;
  });
  if (dropped.length || stripped) {
    await writeStored(sanitized);
    void recordDiagnosticEvent('native_file_error');
    await deleteUnreferencedChatFiles(legacy.nativeChatOutboxUploadUris(dropped)).catch(() => undefined);
    return sanitized;
  }
  if (!cached) setNativeChatOutboxRowsCache(sanitized);
  return sanitized;
}
async function writeStored(rows: Entry[]) {
  const value = JSON.stringify(rows);
  if (value.length > 262144) throw new Error('Очередь сообщений заполнена');
  const startedAt = Date.now();
  try {
    if (rows.length) await SecureStore.setItemAsync(CHAT_OUTBOX_STORAGE_KEY, value);
    else await SecureStore.deleteItemAsync(CHAT_OUTBOX_STORAGE_KEY);
  } finally {
    recordChatQueueStorageOp(rows.length ? 'write' : 'delete', Date.now() - startedAt, rows.length ? value.length : 0);
  }
  setNativeChatOutboxRowsCache(rows);
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
    current(); const rows = await readStored(userId); current();
    const row = rows.find((item) => match(item, id));
    if (!row) throw noWork();
    const next = fn(row);
    // Reconciliations that end up unchanged must not pay a SecureStore write.
    if (next !== row) await writeStored(rows.map((item) => item === row ? next : item));
    return next;
  });
  const removeConfirmed = (id: string) => enqueueNativeChatStorage(async () => {
    current(); const rows = await readStored(userId); current();
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
    queue: (message: ChatMessage, upload?: legacy.NativeChatQueuedUpload,
      command?: legacy.NativeChatOutboxCommand): Promise<{ message: ChatMessage; upload?: legacy.NativeChatQueuedUpload }> => {
      const id = message.client_message_id || '', operationKey = key(id);
      try { current(); if (jobs.has(operationKey)) throw noWork(); } catch (error) { return Promise.reject(error); }
      const existing = preparations.get(operationKey);
      if (existing) return existing;
      const dialogKey = JSON.stringify([lease, userId, conversationId]);
      const previousPreparation = preparationTails.get(dialogKey);
      cancelled.delete(operationKey);
      const operation = (async () => {
        // Preserve enqueue order before durable metadata exists: a text send
        // must not overtake an earlier photo still being copied in this dialog.
        if (previousPreparation) await previousPreparation.catch(() => undefined);
        current();
        // Stamp the delivery metadata into the same durable write that creates
        // the row — one storage write per queued message, not two.
        const state = cancelled.has(operationKey) ? 'cancelled' as const : 'queued' as const;
        const stamp = (entry: legacy.NativeChatOutboxEntry): legacy.NativeChatOutboxEntry => (
          { ...entry, delivery: { version: 1, state, attempts: 0, notBefore: 0 } } as legacy.NativeChatOutboxEntry
        );
        if (upload) { await old.prepareUpload(message, upload, stamp); old.finishUpload(id); }
        else await old.send(message, async () => { throw noWork(); }, undefined,
          { deliver: false, decorate: stamp, command });
        current();
        const entry = await update(id, (row) => {
          if (row.delivery?.confirmed || acknowledgements.has(operationKey)) return row;
          const nextState = cancelled.has(operationKey) ? 'cancelled' as const : 'queued' as const;
          if (row.delivery?.state === nextState && row.delivery.attempts === 0 && !row.delivery.notBefore) return row;
          return { ...row, delivery: { version: 1, state: nextState, attempts: 0, notBefore: 0 } };
        });
        markChatSend(id, 'outbox_persisted');
        current(); return { message: project(entry), upload: entry.upload };
      })().finally(() => {
        preparations.delete(operationKey);
        if (preparationTails.get(dialogKey) === operation) preparationTails.delete(dialogKey);
        notify();
      });
      preparationTails.set(dialogKey, operation);
      preparations.set(operationKey, operation); return operation;
    },
    retryDelivery: async (id: string, canProceed: () => boolean = () => true) => {
      current(); if (!canProceed() || jobs.has(key(id)) || preparations.has(key(id))) throw noWork();
      const rows = await readNativeChatOutbox(userId); current();
      if (!canProceed() || rows.find((row) => match(row, id))?.busy) throw noWork();
      cancelled.delete(key(id));
      await update(id, (row) => {
        if (!canProceed() || jobs.has(key(id)) || preparations.has(key(id))) throw noWork();
        return row.delivery?.confirmed ? row : { ...row, delivery: { version: 1, state: 'queued', attempts: 0, notBefore: 0 } };
      });
    },
    cancelDelivery: async (id: string) => {
      current(); cancelled.add(key(id)); controllers.get(key(id))?.abort();
      // The durable row does not exist until attachment copying finishes.
      // Mark intent first so preparation cannot expose an eligible queued row.
      const preparation = preparations.get(key(id));
      if (preparation) {
        await preparation;
        current();
        // The preparation stamped the durable 'cancelled' state; the in-memory
        // flag only covered the transition window and must not linger.
        cancelled.delete(key(id));
        return;
      }
      await update(id, (row) => row.delivery?.confirmed ? row : { ...row, delivery: {
        version: 1, state: 'cancelled', attempts: row.delivery?.attempts || 0, notBefore: 0,
      } });
      cancelled.delete(key(id));
    },
    discard: async (id: string) => {
      current(); if (jobs.has(key(id)) || preparations.has(key(id))) throw noWork();
      const rows = await readNativeChatOutbox(userId); current();
      if (jobs.has(key(id)) || preparations.has(key(id)) || rows.find((row) => match(row, id))?.delivery?.confirmed) throw noWork();
      cancelled.add(key(id));
      try { await old.discard(id); }
      finally { cancelled.delete(key(id)); }
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
        // The replacement must stay deliverable: stamp a fresh queue position
        // instead of wiping the metadata — a delivery-less row is skipped by
        // the runner forever.
        await update(replacement, (row) => (row.delivery?.confirmed ? row
          : { ...row, delivery: { version: 1, state: 'queued', attempts: 0, notBefore: 0 } }));
        return changed;
      } finally { cancelled.delete(key(replacement)); }
    },
    acknowledge: async (messages: ChatMessage[]) => {
      current(); await legacy.readNativeChatOutbox(userId); current();
      await enqueueNativeChatStorage(async () => {
        const rows = await readStored(userId); current();
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
    deliverQueued: (id: string, transport: (row: Entry, signal: AbortSignal, helpers: NativeChatDeliveryHelpers) => Promise<ChatMessage>, canSend: () => boolean,
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
          current(); const rows = await readStored(userId); current();
          const index = rows.findIndex((row) => match(row, id)), row = rows[index];
          const d = row?.delivery;
          if (!row || !d) throw noWork();
          const ack = d.confirmed || acknowledgements.get(operationKey);
          if (ack) return { ...row, delivery: { ...d, state: 'confirmed' as const, confirmed: ack } };
          if (!canSend() || controller.signal.aborted || cancelled.has(operationKey)
            || !['queued','retry','sending'].includes(d.state) || d.attempts >= NATIVE_CHAT_MAX_DELIVERY_ATTEMPTS || d.notBefore > Date.now()) throw noWork();
          const fifoNow = Date.now();
          if (rows.slice(0,index).some((before) => {
            if (before.userId !== userId || before.message.conversation_id !== conversationId || !before.delivery) return false;
            const beforeState = before.delivery.state;
            // FIFO is held only by entries that can actually send now: paused,
            // cancelled, far-future retry and exhausted rows step aside so a
            // stuck message never stalls the rest of the dialog.
            if (beforeState === 'cancelled' || beforeState === 'paused') return false;
            if ((before.delivery.attempts || 0) >= NATIVE_CHAT_MAX_DELIVERY_ATTEMPTS) return false;
            return beforeState !== 'retry' || (before.delivery.notBefore || 0) <= fifoNow;
          })) throw noWork();
          const next: Entry = { ...row, delivery: { ...d, state: 'sending', attempts: d.attempts + 1 } };
          await writeStored(rows.map((item,i) => i === index ? next : item)); return next;
        });
        let saved = claimed.delivery!.confirmed;
        if (!saved) {
          current(); if (!canSend() || controller.signal.aborted || cancelled.has(operationKey)) throw noWork();
          markChatSend(id, 'http_start');
          noteChatSendHttpStartInflight();
          const helpers: NativeChatDeliveryHelpers = {
            patchUpload: (patch) => update(id, (row) => row.upload
              ? { ...row, upload: { ...row.upload, ...patch } }
              : row),
          };
          saved = await transport(claimed, controller.signal, helpers); current();
          if (!saved?.id || saved.id.startsWith('pending:') || saved.local_status || saved.sender_user_id !== userId
            || saved.conversation_id !== conversationId || (saved.client_message_id && saved.client_message_id !== id)) throw new Error('Некорректное подтверждение отправки');
          saved = { ...saved, client_message_id: id, local_status: undefined };
          // Realtime/history can confirm (and enrich or edit) the message while
          // its original HTTP response is still in flight. That older lean ACK
          // must not replace the authoritative message already observed.
          const observed = acknowledgements.get(operationKey);
          if (observed?.id === saved.id) saved = { ...saved, ...observed, local_status: undefined };
          // Lean ACK skips preview enrichment; keep the client-side quote so the
          // bubble does not drop it until the full WS payload arrives.
          if (saved.reply_preview == null && claimed.message.reply_preview) {
            saved = { ...saved, reply_preview: claimed.message.reply_preview };
          }
          acknowledgements.set(operationKey, saved);
          markChatSend(id, 'http_ack');
        }
        // Flip the UI as soon as the server ACKs: the in-memory acknowledgement
        // already covers future projections, the confirmed write can follow.
        publish({ userId, message: saved });
        markChatSend(id, 'ui_confirmed');
        const confirmed: Entry = { ...claimed, delivery: { ...claimed.delivery!, state: 'confirmed', confirmed: saved } };
        // Persist first, then a single outbox write: remove the row when the
        // history store accepted the message, otherwise mark it confirmed so a
        // later cleanup pass can finish the job without a second transport.
        let stored = false;
        try { stored = await persistConfirmed(confirmed, saved); } catch { /* Keep the ACK. */ }
        current();
        if (stored) await removeConfirmed(id).catch(() => undefined);
        // Merge delivery onto the current row: transport may have persisted a
        // resumable session id on row.upload after the claim snapshot was taken.
        // A row already confirmed with the same acknowledgement needs no
        // rewrite — each failed confirm-commit would otherwise write the blob
        // and re-notify listeners on every retry.
        else {
          const merged = await update(id, (row) => (row.delivery?.state === 'confirmed'
            && row.delivery.confirmed?.id === saved.id ? row
            : { ...row, delivery: confirmed.delivery })).catch(() => null);
          // The acknowledgement now lives on the durable row; the in-memory
          // copy is only needed while the confirmed write has not landed.
          if (merged) acknowledgements.delete(operationKey);
        }
        return saved;
      })().catch(async (error: unknown) => {
        settleChatSend(id);
        if (claimed && generation === lease && !claimed.delivery?.confirmed && !acknowledgements.has(operationKey)) {
          await update(id, (row) => {
            if (row.delivery?.confirmed) return row;
            const isCancelled = cancelled.has(operationKey) || row.delivery?.state === 'cancelled';
            const suspended = !isCancelled && (signal?.aborted
              || (error as {code?: string})?.code === 'HUBIT_NO_DELIVERY');
            const attempts = Math.max(0, (row.delivery?.attempts || 0) - (suspended ? 1 : 0));
            const retry = !isCancelled && attempts < NATIVE_CHAT_MAX_DELIVERY_ATTEMPTS
              && (controller.signal.aborted || (error as {code?: string})?.code === 'HUBIT_NO_DELIVERY' || transient(error));
            const response = (error as {response?: {status?: number;data?: {detail?: unknown}}})?.response;
            return { ...row, delivery: { version: 1, state: isCancelled ? 'cancelled' : retry ? 'retry' : 'paused', attempts,
              notBefore: retry && !suspended ? Date.now() + NATIVE_CHAT_DELIVERY_RETRY_MS[Math.min(Math.max(attempts-1,0),3)] : 0,
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
/** Diagnostics/tests only: in-flight bookkeeping maps that must stay bounded. */
export function getNativeChatOutboxRuntimeState() {
  return {
    jobs: jobs.size,
    preparations: preparations.size,
    cancelled: cancelled.size,
    acknowledgements: acknowledgements.size,
  };
}
export function clearNativeChatOutbox() {
  generation += 1;
  controllers.forEach((controller) => controller.abort()); controllers.clear();
  acknowledgements.clear(); cancelled.clear();
  resetChatSendTiming();
  resetApiInflight();
  return legacy.clearNativeChatOutbox();
}
