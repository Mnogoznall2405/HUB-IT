import { describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';

import useChatMessageActionsController from './useChatMessageActionsController';

const menuActionsMock = {
  clearSelectedMessages: vi.fn(),
  closeMessageMenu: vi.fn(),
  handleCopyMessage: vi.fn(),
  handleCopyMessageLink: vi.fn(),
  handleEditFromMessageMenu: vi.fn(),
  handleOpenAttachmentFromMessageMenu: vi.fn(),
  handleOpenReadsFromMessageMenu: vi.fn(),
  handleOpenTaskFromMessageMenu: vi.fn(),
  handleReplyFromMessageMenu: vi.fn(),
  handleReplyMessage: vi.fn(),
  handleReportMessageFromMenu: vi.fn(),
  handleSelectMessageFromMenu: vi.fn(),
  handleTogglePinMessageFromMenu: vi.fn(),
  openMessageMenu: vi.fn(),
  startMessageSelection: vi.fn(),
  toggleMessageSelection: vi.fn(),
};

const selectedActionsMock = {
  copySelectedMessages: vi.fn(),
  openForwardSelectedMessages: vi.fn(),
  replyToSelectedMessage: vi.fn(),
};

const forwardMessagesMock = {
  handleForwardMessageFromMenu: vi.fn(),
  handleForwardMessageToConversation: vi.fn(),
};

vi.mock('../../components/chat/useChatMessageMenuActions', () => ({
  default: vi.fn(() => menuActionsMock),
}));

vi.mock('../../components/chat/useChatSelectedMessageActions', () => ({
  default: vi.fn(() => selectedActionsMock),
}));

vi.mock('../../components/chat/useChatForwardMessages', () => ({
  default: vi.fn(() => forwardMessagesMock),
}));

describe('useChatMessageActionsController', () => {
  const baseArgs = {
    activeConversationId: 'c1',
    activeConversationIdRef: { current: 'c1' },
    buildPinnedMessagePayload: vi.fn(),
    conversations: [{ id: 'c2', title: 'Other chat' }],
    focusComposer: vi.fn(),
    loadChatDialogsModule: vi.fn(),
    loadConversations: vi.fn(),
    mergeMessageIntoThread: vi.fn(),
    messages: [],
    notifyApiError: vi.fn(),
    notifyInfo: vi.fn(),
    notifyWarning: vi.fn(),
    openMediaViewer: vi.fn(),
    openMessageReads: vi.fn(),
    openTaskFromChat: vi.fn(),
    openConversation: vi.fn(),
    patchThreadMessage: vi.fn(),
    persistPinnedMessage: vi.fn(),
    pinnedMessage: null,
    promoteConversationToTop: vi.fn(),
    queueAutoScroll: vi.fn(),
    selectedMessages: [],
    setComposerMenuAnchor: vi.fn(),
    setEditingMessage: vi.fn(),
    setMessageMenuAnchor: vi.fn(),
    setMessageMenuMessage: vi.fn(),
    setMessageText: vi.fn(),
    setReplyMessage: vi.fn(),
    setSelectedMessageIds: vi.fn(),
    setThreadMenuAnchor: vi.fn(),
    syncConversationPreview: vi.fn(),
    upsertThreadMessages: vi.fn(),
  };

  it('initializes forward state and exposes menu handlers', () => {
    const { result } = renderHook(() => useChatMessageActionsController(baseArgs));

    expect(result.current.forwardOpen).toBe(false);
    expect(result.current.forwardMessages).toEqual([]);
    expect(result.current.handleReplyMessage).toBe(menuActionsMock.handleReplyMessage);
    expect(result.current.selectedCopySelectedMessages).toBe(selectedActionsMock.copySelectedMessages);
    expect(result.current.forwardHookMessageFromMenu).toBe(forwardMessagesMock.handleForwardMessageFromMenu);
  });

  it('filters forward targets by query and excludes active conversation', () => {
    const { result } = renderHook(() => useChatMessageActionsController({
      ...baseArgs,
      conversations: [
        { id: 'c1', title: 'Active chat' },
        { id: 'c2', title: 'Support desk' },
        { id: 'c3', title: 'Archive', is_archived: true },
      ],
    }));

    expect(result.current.forwardTargets.map((item) => item.id)).toEqual(['c2']);

    act(() => {
      result.current.setForwardConversationQuery('support');
    });

    expect(result.current.forwardTargets.map((item) => item.id)).toEqual(['c2']);
  });
});
