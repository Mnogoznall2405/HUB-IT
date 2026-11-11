import { renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import useMailConversationThreadScroll from './useMailConversationThreadScroll';

describe('useMailConversationThreadScroll', () => {
  it('scrolls the conversation pane to the bottom in conversations view', () => {
    const conversationScrollRef = { current: { scrollTop: 0, scrollHeight: 420 } };

    renderHook(() => useMailConversationThreadScroll({
      viewMode: 'conversations',
      selectedId: 'c-1',
      selectedConversationItemCount: 4,
      conversationScrollRef,
    }));

    expect(conversationScrollRef.current.scrollTop).toBe(420);
  });

  it('does not touch the pane in messages view', () => {
    const conversationScrollRef = { current: { scrollTop: 12, scrollHeight: 420 } };

    renderHook(() => useMailConversationThreadScroll({
      viewMode: 'messages',
      selectedId: 'msg-1',
      selectedConversationItemCount: 4,
      conversationScrollRef,
    }));

    expect(conversationScrollRef.current.scrollTop).toBe(12);
  });
});
