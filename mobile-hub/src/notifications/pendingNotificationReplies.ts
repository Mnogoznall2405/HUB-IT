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
let drainPromise: Promise<PendingReplyDrainResult> | null = null;

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
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    return normalizeQueue(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

function notify(count: number): void {
  for (const listener of listeners) listener(count);
}

async function saveQueue(queue: PendingChatReply[]): Promise<void> {
  const normalized = normalizeQueue(queue);
  if (normalized.length) await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(normalized));
  else await SecureStore.deleteItemAsync(STORAGE_KEY);
  notify(normalized.length);
}

async function sendReply(item: PendingChatReply): Promise<void> {
  await chatApi.sendTextMessage(item.conversationId, item.body, {
    clientMessageId: item.id,
    replyToMessageId: item.messageId || undefined,
  });
  await chatApi.markConversationRead(item.conversationId, item.messageId || undefined).catch(() => undefined);
}

export function subscribePendingChatReplies(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function getPendingChatReplyCount(userId?: number): Promise<number> {
  const queue = await loadQueue();
  return userId ? queue.filter((item) => item.userId === userId).length : queue.length;
}

export async function queuePendingChatReply(
  item: Omit<PendingChatReply, 'createdAt' | 'attempts'>,
): Promise<PendingChatReply> {
  const normalized = normalizeQueue([{ ...item, createdAt: Date.now(), attempts: 0 }])[0];
  if (!normalized) throw new Error('Некорректный быстрый ответ');
  const queue = await loadQueue();
  const existing = queue.find((entry) => entry.id === normalized.id);
  if (!existing) queue.push(normalized);
  await saveQueue(queue);
  return existing || normalized;
}

export async function retryPendingChatReply(id: string, userId: number): Promise<PendingReplyResult> {
  const queue = await loadQueue();
  const item = queue.find((entry) => entry.id === id && entry.userId === userId) || null;
  if (!item) return { status: 'discarded', item: null };
  try {
    await sendReply(item);
    await saveQueue(queue.filter((entry) => entry.id !== item.id));
    return { status: 'sent', item };
  } catch (error) {
    if (isRetryableOfflineError(error)) {
      await saveQueue(queue.map((entry) => (
        entry.id === item.id ? { ...entry, attempts: entry.attempts + 1 } : entry
      )));
      return { status: 'pending', item };
    }
    await saveQueue(queue.filter((entry) => entry.id !== item.id));
    return { status: 'discarded', item };
  }
}

export async function drainPendingChatReplies(userId: number): Promise<PendingReplyDrainResult> {
  if (drainPromise) return drainPromise;
  drainPromise = (async () => {
    const queue = await loadQueue();
    const remaining: PendingChatReply[] = [];
    const sent: PendingChatReply[] = [];
    const discarded: PendingChatReply[] = [];
    let networkUnavailable = false;
    for (const item of queue) {
      if (item.userId !== userId || networkUnavailable) {
        remaining.push(item);
        continue;
      }
      try {
        await sendReply(item);
        sent.push(item);
      } catch (error) {
        if (isRetryableOfflineError(error)) {
          networkUnavailable = true;
          remaining.push({ ...item, attempts: item.attempts + 1 });
        } else {
          discarded.push(item);
        }
      }
    }
    await saveQueue(remaining);
    return {
      remaining: remaining.filter((item) => item.userId === userId).length,
      sent,
      discarded,
    };
  })().finally(() => {
    drainPromise = null;
  });
  return drainPromise;
}

export async function clearPendingChatReplies(): Promise<void> {
  await SecureStore.deleteItemAsync(STORAGE_KEY);
  notify(0);
}
