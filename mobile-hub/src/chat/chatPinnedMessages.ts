import * as SecureStore from 'expo-secure-store';

const STORAGE_KEY = 'hubit_native_chat_pinned_messages_v1';
const MAX_ITEMS = 40;

type PinnedMessage = {
  userId: number;
  conversationId: string;
  messageId: string;
  updatedAt: number;
};

async function load(): Promise<PinnedMessage[]> {
  try {
    const value = await SecureStore.getItemAsync(STORAGE_KEY);
    const items = value ? JSON.parse(value) : [];
    if (!Array.isArray(items)) return [];
    return items.flatMap((raw): PinnedMessage[] => {
      const item = raw as Partial<PinnedMessage>;
      const userId = Number(item.userId || 0);
      const conversationId = String(item.conversationId || '').trim();
      const messageId = String(item.messageId || '').trim();
      const updatedAt = Number(item.updatedAt || 0);
      return Number.isInteger(userId) && userId > 0 && conversationId && messageId
        ? [{ userId, conversationId, messageId, updatedAt }]
        : [];
    }).sort((left, right) => right.updatedAt - left.updatedAt).slice(0, MAX_ITEMS);
  } catch {
    return [];
  }
}

export async function getPinnedChatMessageId(userId: number, conversationId: string): Promise<string | null> {
  const items = await load();
  return items.find((item) => item.userId === userId && item.conversationId === conversationId)?.messageId || null;
}

export async function setPinnedChatMessageId(
  userId: number,
  conversationId: string,
  messageId: string | null,
): Promise<void> {
  const normalizedConversationId = String(conversationId || '').trim();
  const normalizedMessageId = String(messageId || '').trim();
  if (!Number.isInteger(userId) || userId <= 0 || !normalizedConversationId) return;
  const items = (await load()).filter((item) => !(
    item.userId === userId && item.conversationId === normalizedConversationId
  ));
  if (normalizedMessageId) {
    items.unshift({
      userId,
      conversationId: normalizedConversationId,
      messageId: normalizedMessageId,
      updatedAt: Date.now(),
    });
  }
  const next = items.slice(0, MAX_ITEMS);
  if (next.length) await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(next));
  else await SecureStore.deleteItemAsync(STORAGE_KEY);
}
