import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import * as chatApi from '../api/chatApi';

const STORAGE_KEY = 'hubit_offline_command_queue_v1';
const MAX_QUEUE_SIZE = 25;
const MAX_QUEUE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const OFFLINE_COMMAND_QUEUE_CHANGED_EVENT = 'hubit.offline-command-queue.changed';

export type OfflineCommand = {
  id: string;
  type: 'chat.mark_read';
  userId: number;
  conversationId: string;
  messageId: string;
  createdAt: number;
  attempts: number;
};

type Listener = (count: number) => void;
const listeners = new Set<Listener>();
let drainPromise: Promise<number> | null = null;

function normalizeQueue(value: unknown, now = Date.now()): OfflineCommand[] {
  if (!Array.isArray(value)) return [];
  const result: OfflineCommand[] = [];
  const ids = new Set<string>();
  for (const raw of value) {
    const item = raw as Partial<OfflineCommand>;
    const userId = Number(item.userId || 0);
    const conversationId = String(item.conversationId || '').trim();
    const messageId = String(item.messageId || '').trim();
    const createdAt = Number(item.createdAt || 0);
    if (
      item.type !== 'chat.mark_read'
      || !Number.isInteger(userId)
      || userId <= 0
      || !conversationId
      || !messageId
      || !createdAt
      || now - createdAt > MAX_QUEUE_AGE_MS
    ) continue;
    const id = `${userId}:${conversationId}:${messageId}`;
    if (ids.has(id)) continue;
    ids.add(id);
    result.push({
      id,
      type: 'chat.mark_read',
      userId,
      conversationId,
      messageId,
      createdAt,
      attempts: Math.max(0, Number(item.attempts || 0)),
    });
  }
  return result.sort((a, b) => a.createdAt - b.createdAt).slice(-MAX_QUEUE_SIZE);
}

async function loadQueue(): Promise<OfflineCommand[]> {
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

async function saveQueue(queue: OfflineCommand[]): Promise<void> {
  const normalized = normalizeQueue(queue);
  if (normalized.length) await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(normalized));
  else await SecureStore.deleteItemAsync(STORAGE_KEY);
  notify(normalized.length);
}

export function isRetryableOfflineError(error: unknown): boolean {
  if (
    error
    && typeof error === 'object'
    && 'code' in error
    && (error as { code?: unknown }).code === 'HUBIT_OFFLINE_READ_ONLY'
  ) return true;
  if (!axios.isAxiosError(error)) return false;
  if (error.code === 'ERR_CANCELED' || error.config?.signal?.aborted) return false;
  const status = Number(error.response?.status || 0);
  return !status || status === 408 || status === 429 || status >= 500;
}

export async function getOfflineCommandCount(userId?: number): Promise<number> {
  const queue = await loadQueue();
  return userId ? queue.filter((item) => item.userId === userId).length : queue.length;
}

export function subscribeOfflineCommandQueue(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function queueConversationRead(
  userId: number,
  conversationId: string,
  messageId: string,
): Promise<number> {
  const normalizedUserId = Number(userId || 0);
  const normalizedConversationId = String(conversationId || '').trim();
  const normalizedMessageId = String(messageId || '').trim();
  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0 || !normalizedConversationId || !normalizedMessageId) {
    throw new Error('Некорректная команда offline-очереди');
  }
  const queue = await loadQueue();
  const id = `${normalizedUserId}:${normalizedConversationId}:${normalizedMessageId}`;
  if (!queue.some((item) => item.id === id)) {
    queue.push({
      id,
      type: 'chat.mark_read',
      userId: normalizedUserId,
      conversationId: normalizedConversationId,
      messageId: normalizedMessageId,
      createdAt: Date.now(),
      attempts: 0,
    });
  }
  await saveQueue(queue);
  return getOfflineCommandCount(normalizedUserId);
}

export async function markConversationReadResilient(
  userId: number,
  conversationId: string,
  messageId: string,
): Promise<'sent' | 'queued'> {
  try {
    await chatApi.markConversationRead(conversationId, messageId);
    return 'sent';
  } catch (error) {
    if (!isRetryableOfflineError(error)) throw error;
    await queueConversationRead(userId, conversationId, messageId);
    return 'queued';
  }
}

export async function drainOfflineCommandQueue(userId: number): Promise<number> {
  if (drainPromise) return drainPromise;
  drainPromise = (async () => {
    const queue = await loadQueue();
    const remaining: OfflineCommand[] = [];
    let networkUnavailable = false;
    for (const command of queue) {
      if (command.userId !== userId || networkUnavailable) {
        remaining.push(command);
        continue;
      }
      try {
        await chatApi.markConversationRead(command.conversationId, command.messageId);
      } catch (error) {
        if (isRetryableOfflineError(error)) {
          networkUnavailable = true;
          remaining.push({ ...command, attempts: command.attempts + 1 });
        }
        // Definitive 4xx means the command is obsolete or forbidden and must not poison the queue.
      }
    }
    await saveQueue(remaining);
    return remaining.filter((item) => item.userId === userId).length;
  })().finally(() => {
    drainPromise = null;
  });
  return drainPromise;
}

export async function clearOfflineCommandQueue(): Promise<void> {
  await SecureStore.deleteItemAsync(STORAGE_KEY);
  notify(0);
}
