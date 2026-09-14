import * as SecureStore from 'expo-secure-store';
import * as chatApi from '../api/chatApi';
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
  return normalizeQueue(raw ? JSON.parse(raw) : []);
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
    const queue = await loadQueue();
    const existing = queue.find((entry) => entry.id === normalized.id);
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
    const queue = await withStorage(loadQueue);
    const item = queue.find((entry) => entry.id === id && entry.userId === userId) || null;
    if (!item || lease !== generation) return { status: 'discarded', item: null };
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
    const queue = await withStorage(loadQueue);
    const sent: PendingChatReply[] = [];
    const discarded: PendingChatReply[] = [];
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
