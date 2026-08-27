import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'hubit_native_chat_drafts_v1';
const MAX_DRAFTS = 20;
const MAX_TEXT_LENGTH = 10_000;
const MAX_TOTAL_CHARACTERS = 64_000;
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export type NativeChatDraft = {
  userId: number;
  conversationId: string;
  text: string;
  updatedAt: number;
};

function normalizeDrafts(value: unknown, now = Date.now()): NativeChatDraft[] {
  if (!Array.isArray(value)) return [];
  const byKey = new Map<string, NativeChatDraft>();
  for (const raw of value) {
    const item = raw as Partial<NativeChatDraft>;
    const userId = Number(item.userId || 0);
    const conversationId = String(item.conversationId || '').trim();
    const text = String(item.text || '').slice(0, MAX_TEXT_LENGTH);
    const updatedAt = Number(item.updatedAt || 0);
    if (
      !Number.isInteger(userId)
      || userId <= 0
      || !conversationId
      || !text.trim()
      || !updatedAt
      || now - updatedAt > MAX_AGE_MS
    ) continue;
    const key = `${userId}:${conversationId}`;
    const previous = byKey.get(key);
    if (!previous || updatedAt > previous.updatedAt) {
      byKey.set(key, { userId, conversationId, text, updatedAt });
    }
  }
  const newest = [...byKey.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, MAX_DRAFTS);
  let characters = 0;
  return newest.filter((item) => {
    if (characters + item.text.length > MAX_TOTAL_CHARACTERS) return false;
    characters += item.text.length;
    return true;
  });
}

async function loadDrafts(): Promise<NativeChatDraft[]> {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    return normalizeDrafts(raw ? JSON.parse(raw) : []);
  } catch {
    return [];
  }
}

async function saveDrafts(drafts: NativeChatDraft[]): Promise<void> {
  const normalized = normalizeDrafts(drafts);
  if (normalized.length) {
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(normalized));
  } else {
    await SecureStore.deleteItemAsync(STORAGE_KEY);
  }
}

export async function getNativeChatDraft(userId: number, conversationId: string): Promise<string> {
  const drafts = await loadDrafts();
  return drafts.find((item) => (
    item.userId === Number(userId)
    && item.conversationId === String(conversationId || '').trim()
  ))?.text || '';
}

export async function setNativeChatDraft(
  userId: number,
  conversationId: string,
  text: string,
): Promise<void> {
  const normalizedUserId = Number(userId || 0);
  const normalizedConversationId = String(conversationId || '').trim();
  const normalizedText = String(text || '').slice(0, MAX_TEXT_LENGTH);
  if (!Number.isInteger(normalizedUserId) || normalizedUserId <= 0 || !normalizedConversationId) return;
  const drafts = (await loadDrafts()).filter((item) => (
    item.userId !== normalizedUserId || item.conversationId !== normalizedConversationId
  ));
  if (normalizedText.trim()) {
    drafts.push({
      userId: normalizedUserId,
      conversationId: normalizedConversationId,
      text: normalizedText,
      updatedAt: Date.now(),
    });
  }
  await saveDrafts(drafts);
}

export async function clearNativeChatDraft(userId: number, conversationId: string): Promise<void> {
  await setNativeChatDraft(userId, conversationId, '');
}

export async function clearAllNativeChatDrafts(): Promise<void> {
  await SecureStore.deleteItemAsync(STORAGE_KEY);
}
