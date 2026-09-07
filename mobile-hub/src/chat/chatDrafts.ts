import * as SecureStore from 'expo-secure-store';
import type { ChatMessage } from '../api/types';
import type { NativePickedFile } from '../files/nativeFilePicker';
import { persistNativeChatDraftFiles, clearNativeChatDraftFiles, deleteUnreferencedChatFiles } from './nativeChatDraftFiles';

export type NativeChatDraftContext = {
  mode?: { type: 'reply' | 'edit'; message: ChatMessage };
  beforeEditText?: string;
  files?: NativePickedFile[];
};

import { CHAT_DRAFT_STORAGE_KEY as STORAGE_KEY, enqueueNativeChatStorage as mutateDrafts, waitForNativeChatStorage } from './nativeChatStorageQueue';
const MAX_DRAFTS = 20;
const MAX_TEXT_LENGTH = 10_000;
const MAX_TOTAL_CHARACTERS = 64_000;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
let generation = 0;

/** A mounted editor must not recreate drafts after explicit logout cleanup. */
export function createNativeChatDraftWriter(userId: number, conversationId: string) {
  const lease = generation;
  return (text: string, context?: NativeChatDraftContext): Promise<void> => {
    if (lease !== generation) return Promise.reject(new Error('Сеанс сохранения черновика завершён'));
    return setNativeChatDraft(userId, conversationId, text, context);
  };
}

export class NativeChatDraftLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NativeChatDraftLimitError';
  }
}


export type NativeChatDraft = {
  userId: number;
  conversationId: string;
  text: string;
  updatedAt: number;
  context?: NativeChatDraftContext;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function validateContext(value: unknown, conversationId: string): void {
  if (value === undefined) return;
  const invalid = () => { throw new Error('Не удалось прочитать черновики: повреждён контекст сообщения.'); };
  if (!isRecord(value)) return invalid();
  if (value.beforeEditText !== undefined && typeof value.beforeEditText !== 'string') return invalid();
  if (value.mode !== undefined) {
    const mode = value.mode;
    if (!isRecord(mode) || !['reply', 'edit'].includes(String(mode.type)) || !isRecord(mode.message)) return invalid();
    const message = mode.message;
    if (typeof message.id !== 'string' || !message.id.trim()
      || (message.conversation_id !== undefined && message.conversation_id !== conversationId)
      || (message.body_text !== undefined && message.body_text !== null && typeof message.body_text !== 'string')) return invalid();
  }
  if (value.files !== undefined) {
    if (!Array.isArray(value.files)) return invalid();
    for (const file of value.files) {
      if (!isRecord(file) || typeof file.uri !== 'string' || !file.uri.trim()
        || typeof file.name !== 'string' || typeof file.mimeType !== 'string'
        || typeof file.size !== 'number' || !Number.isFinite(file.size) || file.size < 0) return invalid();
    }
  }
}

function normalizeDrafts(value: unknown, now = Date.now()): NativeChatDraft[] {
  if (!Array.isArray(value)) return [];
  const byKey = new Map<string, NativeChatDraft>();
  for (const raw of value) {
    if (!isRecord(raw)) throw new Error('Не удалось прочитать черновики');
    const item = raw as Partial<NativeChatDraft>;
    if (typeof item.userId !== 'number' || !Number.isInteger(item.userId) || item.userId <= 0
      || typeof item.conversationId !== 'string' || !item.conversationId.trim()
      || typeof item.text !== 'string'
      || typeof item.updatedAt !== 'number' || !Number.isFinite(item.updatedAt) || item.updatedAt <= 0) {
      throw new Error('Не удалось прочитать черновики');
    }
    const userId = item.userId;
    const conversationId = item.conversationId.trim();
    const text = item.text;
    const updatedAt = item.updatedAt;
    validateContext(item.context, conversationId);
    if (
      (!text.trim() && !item.context?.mode && !item.context?.files?.length)
      || now - updatedAt > MAX_AGE_MS
    ) continue;
    const key = `${userId}:${conversationId}`;
    const previous = byKey.get(key);
    if (!previous || updatedAt > previous.updatedAt) {
      byKey.set(key, { userId, conversationId, text, updatedAt, ...(item.context ? { context: item.context } : {}) });
    }
  }
  return [...byKey.values()].sort((left, right) => right.updatedAt - left.updatedAt);
}

async function loadDrafts(): Promise<NativeChatDraft[]> {
  const raw = await SecureStore.getItemAsync(STORAGE_KEY);
  let parsed: unknown;
  try { parsed = raw ? JSON.parse(raw) : []; }
  catch { throw new Error('Не удалось прочитать черновики'); }
  if (!Array.isArray(parsed)) throw new Error('Не удалось прочитать черновики');
  return normalizeDrafts(parsed);
}

async function saveDrafts(drafts: NativeChatDraft[]): Promise<void> {
  const normalized = normalizeDrafts(drafts);
  // Quotas must fail the write, never evict or truncate a different draft.
  if (normalized.length > MAX_DRAFTS
    || normalized.reduce((total, item) => total + item.text.length, 0) > MAX_TOTAL_CHARACTERS
    || JSON.stringify(normalized).length > 262_144) {
    throw new NativeChatDraftLimitError('Черновик не сохранён: достигнут лимит черновиков. Отправьте или очистите ненужные черновики в других диалогах.');
  }
  if (normalized.length) {
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(normalized));
  } else {
    await SecureStore.deleteItemAsync(STORAGE_KEY);
  }
}

export async function getNativeChatDraft(userId: number, conversationId: string): Promise<string> {
  return (await getNativeChatDraftState(userId, conversationId))?.text || '';
}

export async function getNativeChatDraftState(userId: number, conversationId: string): Promise<NativeChatDraft | null> {
  await waitForNativeChatStorage();
  const drafts = await loadDrafts();
  return drafts.find((item) => (
    item.userId === Number(userId)
    && item.conversationId === String(conversationId || '').trim()
  )) || null;
}

export async function setNativeChatDraft(
  userId: number,
  conversationId: string,
  text: string,
  context?: NativeChatDraftContext,
): Promise<void> {
  const normalizedUserId = Number(userId || 0);
  const normalizedConversationId = String(conversationId || '').trim();
  const normalizedText = String(text || '');
  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0 || !normalizedConversationId) return;
  validateContext(context, normalizedConversationId);
  if (normalizedText.length > MAX_TEXT_LENGTH) {
    throw new NativeChatDraftLimitError('Черновик не сохранён: текст длиннее 10 000 символов. Сократите текст перед сохранением.');
  }
  return mutateDrafts(async () => {
    const stored = await loadDrafts();
    const candidates = stored.filter((item) => item.userId === normalizedUserId && item.conversationId === normalizedConversationId)
      .flatMap((item) => item.context?.files?.map((file) => file.uri) || []);
    // Keep the previous draft on disk until the replacement copy + metadata write both succeed.
    const nextDrafts = stored.filter((item) => (
      item.userId !== normalizedUserId || item.conversationId !== normalizedConversationId
    ));
    if (normalizedText.trim() || context?.mode || context?.files?.length) {
      const storedContext = context?.files?.length
        ? { ...context, files: await persistNativeChatDraftFiles(normalizedUserId, context.files) }
        : context;
      nextDrafts.push({
        userId: normalizedUserId,
        conversationId: normalizedConversationId,
        text: normalizedText,
        updatedAt: Date.now(),
        ...(storedContext ? { context: storedContext } : {}),
      });
    }
    await saveDrafts(nextDrafts);
    const retained = new Set(nextDrafts.flatMap((item) => item.context?.files?.map((file) => file.uri) || []));
    const removed = candidates.filter((uri) => !retained.has(uri));
    await deleteUnreferencedChatFiles(removed).catch(() => undefined);
  });
}

export async function clearNativeChatDraft(userId: number, conversationId: string): Promise<void> {
  await setNativeChatDraft(userId, conversationId, '');
}

export async function clearAllNativeChatDrafts(): Promise<void> {
  generation += 1;
  return mutateDrafts(async () => {
    await SecureStore.deleteItemAsync(STORAGE_KEY);
    clearNativeChatDraftFiles();
  });
}
