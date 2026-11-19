import axios from 'axios';
import * as SecureStore from 'expo-secure-store';
import * as chatApi from '../api/chatApi';
import * as mailApi from '../api/mailApi';

const STORAGE_KEY = 'hubit_offline_command_queue_v1';
const MAX_QUEUE_SIZE = 25;
const MAX_QUEUE_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export const OFFLINE_COMMAND_QUEUE_CHANGED_EVENT = 'hubit.offline-command-queue.changed';

export type OfflineCommandType = 'chat.mark_read' | 'mail.mark_read';

export type OfflineCommand = {
  id: string;
  type: OfflineCommandType;
  userId: number;
  conversationId: string;
  mailboxId: string;
  messageId: string;
  createdAt: number;
  attempts: number;
};

type Listener = (count: number) => void;
const listeners = new Set<Listener>();
const drainPromises = new Map<number, Promise<number>>();
let storageMutation: Promise<unknown> = Promise.resolve();
let generation = 0;

function mutate<T>(operation: () => Promise<T>): Promise<T> {
  const pending = storageMutation.catch(() => undefined).then(operation);
  storageMutation = pending;
  return pending;
}

function normalizeQueue(value: unknown, now = Date.now()): OfflineCommand[] {
  if (!Array.isArray(value)) return [];
  const result: OfflineCommand[] = [];
  const ids = new Set<string>();
  for (const raw of value) {
    const item = raw as Partial<OfflineCommand>;
    const type = item.type === 'mail.mark_read' ? 'mail.mark_read' : 'chat.mark_read';
    const userId = Number(item.userId || 0);
    const conversationId = String(item.conversationId || '').trim();
    const mailboxId = String(item.mailboxId || '').trim();
    const messageId = String(item.messageId || '').trim();
    const createdAt = Number(item.createdAt || 0);
    const targetId = type === 'mail.mark_read' ? mailboxId : conversationId;
    if (
      !Number.isInteger(userId)
      || userId <= 0
      || (type !== 'mail.mark_read' && !targetId)
      || !messageId
      || !createdAt
      || now - createdAt > MAX_QUEUE_AGE_MS
    ) continue;
    const id = `${type}:${userId}:${targetId}:${messageId}`;
    if (ids.has(id)) continue;
    ids.add(id);
    result.push({
      id,
      type,
      userId,
      conversationId: type === 'mail.mark_read' ? '' : conversationId,
      mailboxId: type === 'mail.mark_read' ? mailboxId : '',
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
  await storageMutation.catch(() => undefined);
  const queue = await loadQueue();
  return userId ? queue.filter((item) => item.userId === userId).length : queue.length;
}

export function subscribeOfflineCommandQueue(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function queueMarkRead(
  type: OfflineCommandType,
  userId: number,
  targetId: string,
  messageId: string,
): Promise<number> {
  const normalizedUserId = Number(userId || 0);
  const normalizedTargetId = String(targetId || '').trim();
  const normalizedMessageId = String(messageId || '').trim();
  if (
    !Number.isInteger(normalizedUserId)
    || normalizedUserId <= 0
    || (type !== 'mail.mark_read' && !normalizedTargetId)
    || !normalizedMessageId
  ) {
    throw new Error('Некорректная команда offline-очереди');
  }
  const lease = generation;
  return mutate(async () => {
    if (lease !== generation) return 0;
    const queue = await loadQueue();
    const id = `${type}:${normalizedUserId}:${normalizedTargetId}:${normalizedMessageId}`;
    if (!queue.some((item) => item.id === id)) {
      queue.push({
        id,
        type,
        userId: normalizedUserId,
        conversationId: type === 'mail.mark_read' ? '' : normalizedTargetId,
        mailboxId: type === 'mail.mark_read' ? normalizedTargetId : '',
        messageId: normalizedMessageId,
        createdAt: Date.now(),
        attempts: 0,
      });
    }
    await saveQueue(queue);
    return normalizeQueue(queue).filter(item => item.userId === normalizedUserId).length;
  });
}

export async function queueConversationRead(
  userId: number,
  conversationId: string,
  messageId: string,
): Promise<number> {
  return queueMarkRead('chat.mark_read', userId, conversationId, messageId);
}

export async function queueMailMessageRead(
  userId: number,
  mailboxId: string,
  messageId: string,
): Promise<number> {
  return queueMarkRead('mail.mark_read', userId, mailboxId, messageId);
}

export async function markConversationReadResilient(
  userId: number,
  conversationId: string,
  messageId: string,
): Promise<'sent' | 'queued'> {
  const lease = generation;
  try {
    await chatApi.markConversationRead(conversationId, messageId);
    return 'sent';
  } catch (error) {
    if (lease !== generation) throw error;
    if (!isRetryableOfflineError(error)) throw error;
    await queueConversationRead(userId, conversationId, messageId);
    return 'queued';
  }
}

export async function markMailMessageReadResilient(
  userId: number,
  mailboxId: string,
  messageId: string,
): Promise<'sent' | 'queued'> {
  const lease = generation;
  try {
    await mailApi.markMailMessageRead(messageId, mailboxId);
    return 'sent';
  } catch (error) {
    if (lease !== generation) throw error;
    if (!isRetryableOfflineError(error)) throw error;
    await queueMailMessageRead(userId, mailboxId, messageId);
    return 'queued';
  }
}

function dispatchOfflineCommand(command: OfflineCommand): Promise<unknown> {
  return command.type === 'mail.mark_read'
    ? mailApi.markMailMessageRead(command.messageId, command.mailboxId)
    : chatApi.markConversationRead(command.conversationId, command.messageId);
}

const MAX_COMMAND_ATTEMPTS = 10;

// A failure that never reached the server (the offline read-only gate, a
// request aborted before flight or any transport error without a response)
// must not burn retry attempts: a dozen foreground flips without connectivity
// would otherwise silently drop every queued command.
function isConnectivityFailure(error: unknown): boolean {
  if (
    error
    && typeof error === 'object'
    && 'code' in error
    && (error as { code?: unknown }).code === 'HUBIT_OFFLINE_READ_ONLY'
  ) return true;
  if (!axios.isAxiosError(error)) return false;
  if (error.code === 'ERR_CANCELED' || error.config?.signal?.aborted) return false;
  return !error.response;
}

export async function drainOfflineCommandQueue(userId: number): Promise<number> {
  const existing = drainPromises.get(userId);
  if (existing) return existing;
  const lease = generation;
  const pending = (async () => {
    const queue = await mutate(loadQueue);
    for (const command of queue) {
      if (lease !== generation) return 0;
      if (command.userId !== userId) continue;
      let retry = false;
      let consumeAttempt = true;
      try {
        await dispatchOfflineCommand(command);
      } catch (error) {
        retry = isRetryableOfflineError(error);
        consumeAttempt = !isConnectivityFailure(error);
        // Definitive 4xx means the command is obsolete or forbidden and must not poison the queue.
      }
      if (retry && consumeAttempt && command.attempts + 1 >= MAX_COMMAND_ATTEMPTS) {
        // A permanently retryable failure would block this drain and every
        // later one (the queue is FIFO): give the entry up like a definitive
        // failure instead of starving all commands queued after it.
        retry = false;
      }
      await mutate(async () => {
        if (lease !== generation) return;
        const current = await loadQueue();
        await saveQueue(retry
          ? current.map(item => item.id === command.id
            ? { ...item, attempts: item.attempts + (consumeAttempt ? 1 : 0) }
            : item)
          : current.filter(item => item.id !== command.id));
      });
      if (retry) break;
    }
    return getOfflineCommandCount(userId);
  })().finally(() => {
    if (drainPromises.get(userId) === pending) drainPromises.delete(userId);
  });
  drainPromises.set(userId, pending);
  return pending;
}

export async function clearOfflineCommandQueue(): Promise<void> {
  generation += 1;
  drainPromises.clear();
  await mutate(async () => {
    await SecureStore.deleteItemAsync(STORAGE_KEY);
    notify(0);
  });
}
