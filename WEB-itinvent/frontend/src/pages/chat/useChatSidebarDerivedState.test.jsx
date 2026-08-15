import { renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { buildChatDraftKey } from '../../components/chat/chatHelpers';
import useChatSidebarDerivedState from './useChatSidebarDerivedState';

const conversations = [
  { id: 'conv-1', kind: 'direct', unread_count: 0 },
  { id: 'conv-2', kind: 'direct', unread_count: 0 },
];

const buildProps = ({ activeConversationId = 'conv-1', deferredMessageText = '' } = {}) => ({
  activeConversation: conversations.find((item) => item.id === activeConversationId),
  activeConversationId,
  aiBots: [],
  conversationFilter: 'all',
  conversationIdsByFolder: {},
  conversations,
  customFolders: [],
  deferredMessageText,
  groupSelectedUsers: [],
  groupUsers: [],
  messageReadsItems: [],
  searchChats: [],
  searchPeople: [],
  userId: 7,
});

describe('useChatSidebarDerivedState draft cache', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('does not reread every conversation draft while typing or switching dialogs', () => {
    window.localStorage.setItem(buildChatDraftKey(7, 'conv-2'), 'stored second draft');
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem');

    const { result, rerender } = renderHook(
      (props) => useChatSidebarDerivedState(props),
      { initialProps: buildProps({ deferredMessageText: 'first draft' }) },
    );

    const initialReadCount = getItemSpy.mock.calls.length;
    expect(result.current.draftsByConversation).toMatchObject({
      'conv-1': 'first draft',
      'conv-2': 'stored second draft',
    });

    rerender(buildProps({ deferredMessageText: 'first draft updated' }));
    expect(getItemSpy).toHaveBeenCalledTimes(initialReadCount);
    expect(result.current.draftsByConversation['conv-1']).toBe('first draft updated');

    rerender(buildProps({ activeConversationId: 'conv-2', deferredMessageText: 'second draft updated' }));
    expect(getItemSpy).toHaveBeenCalledTimes(initialReadCount);
    expect(result.current.draftsByConversation).toMatchObject({
      'conv-1': 'first draft updated',
      'conv-2': 'second draft updated',
    });
  });
});
