type ConversationReadListener = (conversationId: string) => void;

let activeConversationId = '';
const readListeners = new Set<ConversationReadListener>();

export function getActiveNativeChatConversationId(): string {
  return activeConversationId;
}

export function setActiveNativeChatConversationId(conversationId?: string | null): void {
  activeConversationId = String(conversationId || '').trim();
}

export function subscribeNativeChatConversationRead(
  listener: ConversationReadListener,
): () => void {
  readListeners.add(listener);
  return () => {
    readListeners.delete(listener);
  };
}

export function notifyNativeChatConversationRead(conversationId?: string | null): void {
  const id = String(conversationId || '').trim();
  if (!id) return;
  readListeners.forEach((listener) => {
    try {
      listener(id);
    } catch {
      // Keep other inbox listeners alive if one throws.
    }
  });
}
