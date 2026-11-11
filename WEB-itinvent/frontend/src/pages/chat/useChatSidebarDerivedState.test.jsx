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

describe('useChatSidebarDerivedState folder unread counts (U1/U2)', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('prefers server folder_unread_counts over the loaded-rows sum', () => {
    const { result } = renderHook((props) => useChatSidebarDerivedState(props), {
      initialProps: {
        ...buildProps(),
        conversations: [{ id: 'conv-1', kind: 'direct', unread_count: 1 }],
        folderUnreadCounts: { personal: 42, groups: 5, tasks: 0, archived: 0, ai: 7 },
      },
    });
    expect(result.current.conversationFilterCounts.personal).toBe(42);
    expect(result.current.conversationFilterCounts.ai).toBe(7);
  });

  it('subtracts the optimistic local delta for conversations read after the snapshot', () => {
    const initialProps = {
      ...buildProps(),
      conversations: [
        { id: 'conv-1', kind: 'direct', unread_count: 5 },
        { id: 'conv-2', kind: 'direct', unread_count: 0 },
      ],
      folderUnreadCounts: { personal: 8, groups: 0, tasks: 0, archived: 0, ai: 0 },
    };
    const { result, rerender } = renderHook((props) => useChatSidebarDerivedState(props), {
      initialProps,
    });
    expect(result.current.conversationFilterCounts.personal).toBe(8);

    rerender({
      ...initialProps,
      conversations: [
        { id: 'conv-1', kind: 'direct', unread_count: 0 },
        { id: 'conv-2', kind: 'direct', unread_count: 0 },
      ],
    });
    expect(result.current.conversationFilterCounts.personal).toBe(3);
  });

  it('excludes effectively muted conversations from local folder counts (A3-2)', () => {
    const { result } = renderHook((props) => useChatSidebarDerivedState(props), {
      initialProps: {
        ...buildProps(),
        conversations: [
          { id: 'conv-1', kind: 'direct', unread_count: 2 },
          { id: 'conv-muted', kind: 'direct', unread_count: 5, is_muted: true },
          { id: 'conv-expired', kind: 'direct', unread_count: 3, is_muted: true, muted_until: '2020-01-01T00:00:00Z' },
        ],
        folderUnreadCounts: null,
      },
    });
    expect(result.current.conversationFilterCounts.personal).toBe(5);
  });

  it('falls back to loaded-rows counts and keeps ai out of personal', () => {
    const { result } = renderHook((props) => useChatSidebarDerivedState(props), {
      initialProps: {
        ...buildProps(),
        conversations: [
          { id: 'conv-1', kind: 'direct', unread_count: 2 },
          { id: 'conv-ai', kind: 'ai', unread_count: 4 },
        ],
        folderUnreadCounts: null,
      },
    });
    expect(result.current.conversationFilterCounts.personal).toBe(2);
    expect(result.current.conversationFilterCounts.ai).toBe(4);
  });
});
