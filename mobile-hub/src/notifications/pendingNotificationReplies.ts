import * as SecureStore from 'expo-secure-store';
import * as chatApi from '../api/chatApi';
import { getNativeChatDraft, setNativeChatDraft } from '../chat/chatDrafts';
import { isRetryableOfflineError } from '../offline/offlineCommandQueue';

const STORAGE_KEY = 'hubit_pending_notification_replies_v1';
const MAX_QUEUE_SIZE = 10;
const MAX_QUEUE_AGE_MS = 24 * 60 * 60 * 1000;

export type PendingChatReply = {
  id: string;
  userId: number;
  conversationId: string;
  messageId: string;
  body: string;
  notificationId: string;
  route: string;
  createdAt: number;
  attempts: number;
};

export type PendingReplyResult = {
  status: 'sent' | 'pending' | 'discarded';
  item: PendingChatReply | null;
};

export type PendingReplyDrainResult = {
  remaining: number;
  sent: PendingChatReply[];
  discarded: PendingChatReply[];
};

type Listener = (count: number) => void;
const listeners = new Set<Listener>();
let storageOperations: Promise<unknown> = Promise.resolve();
let generation = 0;
const drains = new Map<number, Promise<PendingReplyDrainResult>>();
const deliveries = new Map<string, Promise<PendingReplyResult>>();

function withStorage<T>(operation: () => Promise<T>): Promise<T> {
  const result = storageOperations.then(operation);
  storageOperations = result.catch(() => undefined);
  return result;
}

function normalizeQueue(value: unknown, now = Date.now()): PendingChatReply[] {
  if (!Array.isArray(value)) return [];
  const result: PendingChatReply[] = [];
  const ids = new Set<string>();
  for (const raw of value) {
    const item = raw as Partial<PendingChatReply>;
    const id = String(item.id || '').trim();
    const userId = Number(item.userId || 0);
    const conversationId = String(item.conversationId || '').trim();
    const body = String(item.body || '').trim();
    const createdAt = Number(item.createdAt || 0);
    if (
      !id
      || ids.has(id)
      || !Number.isInteger(userId)
      || userId <= 0
      || !conversationId
      || !body
      || body.length > 12000
      || !createdAt
      || now - createdAt > MAX_QUEUE_AGE_MS
    ) continue;
    ids.add(id);
    result.push({
      id,
      userId,
      conversationId,
      messageId: String(item.messageId || '').trim().slice(0, 64),
      body,
      notificationId: String(item.notificationId || '').trim(),
      route: String(item.route || '/chat').trim() || '/chat',
      createdAt,
      attempts: Math.max(0, Number(item.attempts || 0)),
    });
  }
  return result.sort((a, b) => a.createdAt - b.createdAt).slice(-MAX_QUEUE_SIZE);
}

async function loadQueue(): Promise<PendingChatReply[]> {
  const raw = await SecureStore.getItemAsync(STORAGE_KEY);
  if (!raw) return [];
  try {
    return normalizeQueue(JSON.parse(raw));
  } catch {
    // A corrupt SecureStore value must not wedge the reply queue until logout:
    // quarantine it like other durable stores do.
    await SecureStore.deleteItemAsync(STORAGE_KEY).catch(() => undefined);
    return [];
  }
}

// normalizeQueue silently drops entries older than MAX_QUEUE_AGE_MS — but a
// quick reply's typed text is user data. Readers that mutate the queue load
// the expired tail too, salvage it into the conversation draft and then let
// the next write drop the row for real.
async function loadQueueWithExpired(): Promise<{ queue: PendingChatReply[]; expired: PendingChatReply[] }> {
  const raw = await SecureStore.getItemAsync(STORAGE_KEY);
  if (!raw) return { queue: [], expired: [] };
  try {
    const parsed = JSON.parse(raw);
    const queue = normalizeQueue(parsed);
    const activeIds = new Set(queue.map((item) => item.id));
    // now=0 disables the age cutoff so only genuinely malformed rows are lost.
    const expired = normalizeQueue(parsed, 0).filter((item) => !activeIds.has(item.id));
    return { queue, expired };
  } catch {
    await SecureStore.deleteItemAsync(STORAGE_KEY).catch(() => undefined);
    return { queue: [], expired: [] };
  }
}

// Expired replies are discarded, but the typed text must not vanish silently:
// it is appended to the conversation draft before the queue row is dropped.
async function salvagePendingChatReply(item: PendingChatReply): Promise<void> {
  try {
    const existing = String(await getNativeChatDraft(item.userId, item.conversationId) || '').trim();
    const merged = existing ? `${existing}\n\n${item.body}` : item.body;
    await setNativeChatDraft(item.userId, item.conversationId, merged);
  } catch {
    // Best-effort: the discarded notification still replaces the dead retry.
  }
}

function notify(count: number): void {
  for (const listener of listeners) {
    try { listener(count); } catch { /* An observer must not interrupt persistence. */ }
  }
}

async function saveQueue(queue: PendingChatReply[]): Promise<void> {
  const normalized = normalizeQueue(queue);
  if (normalized.length) await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(normalized));
  else await SecureStore.deleteItemAsync(STORAGE_KEY);
  notify(normalized.length);
}

async function sendReply(item: PendingChatReply, isCurrent: () => boolean): Promise<void> {
  await chatApi.sendTextMessage(item.conversationId, item.body, {
    clientMessageId: item.id,
    replyToMessageId: item.messageId || undefined,
  });
  if (isCurrent()) {
    await chatApi.markConversationRead(item.conversationId, item.messageId || undefined).catch(() => undefined);
  }
}

export function subscribePendingChatReplies(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function getPendingChatReplyCount(userId?: number): Promise<number> {
  const queue = await withStorage(loadQueue);
  return userId ? queue.filter((item) => item.userId === userId).length : queue.length;
}

export async function queuePendingChatReply(
  item: Omit<PendingChatReply, 'createdAt' | 'attempts'>,
): Promise<PendingChatReply> {
  const normalized = normalizeQueue([{ ...item, createdAt: Date.now(), attempts: 0 }])[0];
  if (!normalized) throw new Error('Некорректный быстрый ответ');
  const lease = generation;
  return withStorage(async () => {
    if (lease !== generation) throw new Error('Очередь ответов очищена');
    const { queue, expired } = await loadQueueWithExpired();
    for (const item of expired) await salvagePendingChatReply(item);
    const existing = queue.find((entry) => entry.id === normalized.id);
    // Refuse instead of pushing an 11th row: normalizeQueue would silently
    // evict the oldest stored reply — typed user text must never disappear
    // without notice. The caller salvages the new body into a draft.
    if (!existing && queue.length >= MAX_QUEUE_SIZE) {
      throw new Error('Очередь быстрых ответов заполнена');
    }
    if (!existing) queue.push(normalized);
    await saveQueue(queue);
    return existing || normalized;
  });
}

export function retryPendingChatReply(id: string, userId: number): Promise<PendingReplyResult> {
  const lease = generation;
  const key = `${lease}:${userId}:${id}`;
  const existing = deliveries.get(key);
  if (existing) return existing;
  const operation = (async (): Promise<PendingReplyResult> => {
    const { queue, expired } = await withStorage(loadQueueWithExpired);
    const item = queue.find((entry) => entry.id === id && entry.userId === userId) || null;
    if (!item || lease !== generation) {
      const expiredItem = lease === generation
        ? expired.find((entry) => entry.id === id && entry.userId === userId) || null
        : null;
      if (expiredItem) {
        // Salvage the text, then purge the row so a «Повторить» tap is replaced
        // by a definitive failure instead of silently doing nothing.
        await withStorage(async () => {
          if (lease !== generation) return;
          await salvagePendingChatReply(expiredItem);
          await saveQueue(await loadQueue());
        });
      }
      return { status: 'discarded', item: expiredItem };
    }
    let status: PendingReplyResult['status'] = 'sent';
    try {
      await sendReply(item, () => lease === generation);
    } catch (error) {
      status = isRetryableOfflineError(error) ? 'pending' : 'discarded';
    }
    await withStorage(async () => {
      if (lease !== generation) return;
      const latest = await loadQueue();
      await saveQueue(latest.flatMap((entry) => {
        if (entry.id !== id || entry.userId !== userId) return [entry];
        return status === 'pending' ? [{ ...entry, attempts: entry.attempts + 1 }] : [];
      }));
    });
    return lease === generation ? { status, item } : { status: 'discarded', item: null };
  })().finally(() => { deliveries.delete(key); });
  deliveries.set(key, operation);
  return operation;
}

export async function drainPendingChatReplies(userId: number): Promise<PendingReplyDrainResult> {
  const existing = drains.get(userId);
  if (existing) return existing;
  const lease = generation;
  const operation = (async () => {
    const { queue, expired } = await withStorage(async () => {
      const loaded = await loadQueueWithExpired();
      for (const item of loaded.expired) await salvagePendingChatReply(item);
      if (loaded.expired.length) await saveQueue(loaded.queue);
      return loaded;
    });
    const sent: PendingChatReply[] = [];
    const discarded: PendingChatReply[] = expired.filter((item) => item.userId === userId);
    for (const item of queue) {
      if (lease !== generation) break;
      if (item.userId !== userId) continue;
      const result = await retryPendingChatReply(item.id, userId);
      if (result.status === 'pending') break;
      if (result.item) (result.status === 'sent' ? sent : discarded).push(result.item);
    }
    return {
      remaining: await getPendingChatReplyCount(userId),
      sent,
      discarded,
    };
  })().finally(() => {
    if (drains.get(userId) === operation) drains.delete(userId);
  });
  drains.set(userId, operation);
  return operation;
}

export async function clearPendingChatReplies(): Promise<void> {
  generation += 1;
  drains.clear();
  await withStorage(async () => {
    await SecureStore.deleteItemAsync(STORAGE_KEY);
    notify(0);
  });
}
