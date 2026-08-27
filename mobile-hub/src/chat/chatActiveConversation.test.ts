import {
  getActiveNativeChatConversationId,
  notifyNativeChatConversationRead,
  setActiveNativeChatConversationId,
  subscribeNativeChatConversationRead,
} from './chatActiveConversation';

describe('chatActiveConversation', () => {
  afterEach(() => {
    setActiveNativeChatConversationId(null);
  });

  it('tracks the open thread id for inbox unread suppression', () => {
    expect(getActiveNativeChatConversationId()).toBe('');
    setActiveNativeChatConversationId(' c-1 ');
    expect(getActiveNativeChatConversationId()).toBe('c-1');
    setActiveNativeChatConversationId(null);
    expect(getActiveNativeChatConversationId()).toBe('');
  });

  it('notifies inbox listeners when a thread marks the conversation read', () => {
    const seen: string[] = [];
    const unsubscribe = subscribeNativeChatConversationRead((id) => seen.push(id));
    notifyNativeChatConversationRead('c-2');
    notifyNativeChatConversationRead('  ');
    unsubscribe();
    notifyNativeChatConversationRead('c-3');
    expect(seen).toEqual(['c-2']);
  });
});
